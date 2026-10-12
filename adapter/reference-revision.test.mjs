import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { compareReferenceRevisions } from './reference-revision.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { canonicalJson } from './protocol.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const before = JSON.parse(await readFile(fixture('reference-drawing.layout.json'), 'utf8'));
const after = JSON.parse(await readFile(fixture('reference-revision.layout.json'), 'utf8'));
const compare = (a = before, b = after) => compareReferenceRevisions({ before: a, after: b, same_world_frame: true });
const clone = value => structuredClone(value);
const workdir = () => mkdtemp(path.join(tmpdir(), 'moonmold-revision-'));
const unxml = text => text.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const metadata = svg => JSON.parse(unxml(svg.match(/<metadata>([\s\S]*?)<\/metadata>/)[1]));
const triangle = { contract_id: 'moonmold.reference-layout.v1', name: 'triangle', instances: [{ id: 'face', source: { name: 'face.obj', input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 4 0 0\nv 0 3 0\nf 1 2 3\n' } }] };

test('review distinguishes comment-only source edit, moved placement and explicit rename', () => {
  const a = clone(before), b = clone(after), report = compare(a, b);
  assert.deepEqual(report.summary, { added: 1, removed: 1, changed: 2, unchanged: 0 });
  assert.deepEqual(report.changes[0].changed_fields, ['source-bytes']);
  assert.equal(report.changes[0].before.placed_geometry_sha256, report.changes[0].after.placed_geometry_sha256);
  assert.deepEqual(report.changes[1].changed_fields, ['placement', 'indexed-placed-geometry']);
  assert.deepEqual(report.changes[1].bounds_delta_mm, { min: [0,45,0], max: [0,45,0], size: [0,0,0] });
  assert.equal(report.changes[2].status, 'removed'); assert.equal(report.changes[3].status, 'added');
  assert.equal(report.changes[2].bounds_delta_mm, null); assert.equal(report.changes[3].bounds_delta_mm, null);
  assert.deepEqual(report.bounds_delta_mm.size, [0,45,0]);
  assert.equal(report.name_changed, true); assert.equal(report.physical_authority, false);
  assert.deepEqual(a, before); assert.deepEqual(b, after);
});

test('unchanged saved/reopened layout yields identical deterministic observation', () => {
  const normalized = JSON.parse(composeReferenceLayout(before).exports.layout);
  assert.deepEqual(compare(before, normalized), compare(normalized, before));
  assert.deepEqual(compare(before, normalized).summary, { added: 0, removed: 0, changed: 0, unchanged: 3 });
  assert.equal(compare(before, normalized).before.layout_sha256, compare(before, normalized).after.layout_sha256);
  assert.equal(compare().exports.svg, compare().exports.svg);
});

test('name and export ordering are visible without claiming placed geometry change', () => {
  const renamed = clone(before); renamed.name = 'new-name';
  const nameReport = compare(before, renamed); assert.equal(nameReport.name_changed, true);
  assert.equal(nameReport.summary.unchanged, 3); assert.equal(nameReport.instance_order_changed, false);
  const reordered = clone(before); reordered.instances.reverse();
  const orderReport = compare(before, reordered); assert.equal(orderReport.instance_order_changed, true);
  assert.deepEqual(orderReport.changes[0].changed_fields, ['export-index']);
  assert.deepEqual(orderReport.changes[1].changed_fields, []);
  assert.equal(orderReport.changes[0].before.placed_geometry_sha256, orderReport.changes[0].after.placed_geometry_sha256);
});

test('reversing revisions reverses signs and additions while retaining exact identities', () => {
  const forward = compare(), reverse = compare(after, before);
  assert.deepEqual(reverse.before, forward.after); assert.deepEqual(reverse.after, forward.before);
  assert.deepEqual(reverse.bounds_delta_mm.size, [0,-45,0]);
  for (const item of forward.changes) {
    const back = reverse.changes.find(c => c.id === item.id);
    assert.deepEqual(back.before, item.after); assert.deepEqual(back.after, item.before);
  }
  assert.notEqual(reverse.comparison_sha256, forward.comparison_sha256);
});

test('explicit units can change while physical coordinate numbers remain equal after conversion', () => {
  const cm = clone(triangle); cm.instances[0].source.units = 'cm';
  cm.instances[0].source.text = 'v 0 0 0\nv 0.4 0 0\nv 0 0.3 0\nf 1 2 3\n';
  const report = compare(triangle, cm), row = report.changes[0];
  assert.deepEqual(row.changed_fields, ['source-bytes', 'source-units']);
  assert.equal(row.before.placed_geometry_sha256, row.after.placed_geometry_sha256);
  assert.deepEqual(row.bounds_delta_mm.size, [0,0,0]);
});

test('part selections and binary retained sources use the same source-aware composer', async () => {
  const obj = { input_format: 'obj', name: 'parts', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'), 'utf8'), part_ids: ['object-2'] };
  const a = clone(triangle); a.instances[0].source = obj;
  a.instances.push({ id: 'binary', source: { input_format: 'stl', units: 'in', data_base64: (await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') } });
  const b = clone(a); b.instances[0].source.part_ids = ['object-1']; b.instances[1].transform = { rotation_deg: [0,0,90], translation_mm: [12,0,0] };
  const report = compare(a,b);
  assert.equal(report.changes[0].before.source_sha256, report.changes[0].after.source_sha256);
  assert.deepEqual(report.changes[0].changed_fields, ['source-part_ids', 'indexed-placed-geometry']);
  assert.deepEqual(report.changes[1].changed_fields, ['placement', 'indexed-placed-geometry']);
  assert.ok(report.changes[1].before.source_losses.length);
});

test('index topology changes are exact data changes even with equal vertex bounds', () => {
  const changed = clone(triangle); changed.instances[0].source.text = changed.instances[0].source.text.replace('f 1 2 3', 'f 1 3 2');
  const row = compare(triangle, changed).changes[0];
  assert.deepEqual(row.changed_fields, ['source-bytes', 'indexed-placed-geometry']);
  assert.deepEqual(row.bounds_delta_mm.size, [0,0,0]);
  assert.match(compare(triangle, changed).comparison_policy, /surface is equivalent/);
});

test('SVG uses literal common-coordinate overlay and embeds complete independently hashed report', () => {
  const moved = clone(triangle); moved.instances[0].transform = { translation_mm: [4,0,0] };
  const report = compare(triangle, moved), { exports, comparison_sha256, ...unhashed } = report;
  assert.equal(comparison_sha256, createHash('sha256').update(canonicalJson(unhashed)).digest('hex'));
  assert.deepEqual(metadata(exports.svg), { ...unhashed, comparison_sha256 });
  assert.deepEqual(report.overlay_bounds_mm, { min: [0,0,0], max: [8,3,0], size: [8,3,0] });
  assert.equal(report.views[0].sheet_units_per_mm, 35);
  const paths = [...exports.svg.matchAll(/<path data-edge-count="3" d="([^"]*)"/g)].map(m => m[1]);
  assert.equal(paths.length, 6);
  assert.equal(paths[0], 'M100 412.5L240 412.5M240 412.5L100 307.5M100 307.5L100 412.5');
  assert.equal(paths[1], 'M240 412.5L380 412.5M380 412.5L240 307.5M240 307.5L240 412.5');
  assert.match(exports.svg, /stroke-dasharray="5 3"/);
  assert.doesNotMatch(exports.svg, /<script|<image|<foreignObject|\bhref=|\bonload=|data_base64|"text":/);
});

test('removed and added unused vertices remain visible; sixteen disjoint IDs per revision are supported', () => {
  const old = clone(triangle); old.instances[0].source.text += 'v 9 9 9\n';
  const report = compare(old, triangle);
  assert.equal((report.exports.svg.match(/<circle /g) ?? []).length, 3);
  assert.deepEqual(report.changes[0].bounds_delta_mm.size, [-5,-6,-9]);
  const many = clone(triangle); many.instances = Array.from({length:16}, (_,i) => ({ ...clone(triangle.instances[0]), id: `a${i}` }));
  const manyNew = clone(many); manyNew.instances.forEach((p,i)=>p.id=`b${i}`);
  assert.deepEqual(compare(many,manyNew).summary, { added:16, removed:16, changed:0, unchanged:0 });
});

test('input and frame declarations are required before comparison', () => {
  for (const input of [null, {}, { before, after }, { before, after, same_world_frame:false }, { before, after, same_world_frame:true, tolerance:1 }]) {
    assert.throws(()=>compareReferenceRevisions(input), { code:'invalid-reference-revision' });
  }
  const bad = clone(before); bad.instances[0].source.units='unknown';
  assert.throws(()=>compare(bad,after), { code:'invalid-reference-layout' });
});

test('actual CLI writes reusable report/SVG and refuses existing output or unconfirmed frame', async () => {
  const dir=await workdir(), output=path.join(dir,'revision.svg');
  const cli=new URL('../bin/moonmold-reference-compare.mjs',import.meta.url).pathname;
  const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
  const args=['--before',fixture('reference-drawing.layout.json').pathname,'--after',fixture('reference-revision.layout.json').pathname,'--same-world-frame','yes'];
  assert.equal(run([...args,'--output',output]).status,0);
  assert.equal(await readFile(output,'utf8'),compare().exports.svg);
  assert.equal(run([...args,'--output',output]).status,1);
  assert.equal(await readFile(output,'utf8'),compare().exports.svg);
  const result=run([...args,'--format','json']);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),metadata(compare().exports.svg));
  assert.equal(run(args.slice(0,4)).status,1);
  for (const bad of [['--format','obj'],['--format'],['--before','duplicate']]) assert.equal(run([...args,...bad]).status,1);
  const broken=path.join(dir,'bad.json'), absent=path.join(dir,'absent.svg');await writeFile(broken,'{broken');
  assert.equal(run(['--before',broken,'--after',args[3],'--same-world-frame','yes','--output',absent]).status,1);
  await assert.rejects(access(absent));
});

test('actual HTTP returns identical comparison and serves complete operator entry', async t => {
  const server=createOperatorServer({workspaceRoot:await workdir()});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${base}/api/reference-layout/compare-revisions`,{method:'POST',body:JSON.stringify({before,after,same_world_frame:true})});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),compare());
  const bad=await fetch(`${base}/api/reference-layout/compare-revisions`,{method:'POST',body:JSON.stringify({before,after})});assert.equal(bad.status,400);
  const html=await(await fetch(`${base}/reference-layout`)).text();assert.match(html,/Compare saved revision/);
  const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8'});assert.equal(check.status,0,check.stderr);
});

async function uiHarness() {
  const html=await readFile(new URL('../ui/reference-layout/index.html',import.meta.url),'utf8');
  const elements=new Map(), blobs=new Map(), revoked=[], calls=[];
  const state={ serial:0, failure:false, mismatch:false, hold:null };
  function el(id) {
    if(!elements.has(id)) elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},files:[],
      addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},removeAttribute(name){delete this[name];}});
    return elements.get(id);
  }
  el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
  el('preview').width=1000;el('preview').height=400;
  el('layout-file').files=[{size:1000,text:async()=>JSON.stringify(after)}];
  el('revision-file').files=[{size:1000,text:async()=>JSON.stringify(before)}];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,
    URL:{createObjectURL(blob){const url=`blob:${++state.serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async(url,options)=>{
      const input=JSON.parse(options.body);calls.push({url,input});
      if(url.endsWith('/compare-revisions')){
        if(state.hold) await new Promise(resolve=>{state.hold=resolve;});
        if(state.failure) return {ok:false,json:async()=>({message:'Comparison unavailable'})};
        const report=compareReferenceRevisions(input);
        if(state.mismatch) report.before.layout_sha256='0'.repeat(64);
        return {ok:true,json:async()=>report};
      }
      return {ok:true,json:async()=>composeReferenceLayout(input)};
    }
  });
  const event={preventDefault(){}};
  return {el,state,blobs,revoked,calls,event,load:()=>el('load-form').handlers.submit(event),click:()=>el('revision-compare').handlers.click(),links:()=>el('revision-download').children.filter(c=>c.href)};
}

test('production operator compares saved baseline without replacing current applied layout', async()=>{
  const h=await uiHarness();await h.click();assert.equal(h.calls.length,0);
  await h.load();const originalDownloads=h.el('downloads').children.map(a=>a.href);
  await h.click();assert.match(h.el('status').textContent,/same intended world origin/);assert.equal(h.links().length,0);
  h.el('revision-frame').checked=true;await h.click();
  assert.equal(h.links().length,2);assert.equal(h.el('revision-preview').hidden,false);
  assert.equal(await h.blobs.get(h.links()[0].href).text(),compare().exports.svg);
  assert.deepEqual(JSON.parse(await h.blobs.get(h.links()[1].href).text()),metadata(compare().exports.svg));
  assert.deepEqual(h.el('downloads').children.map(a=>a.href),originalDownloads);
  assert.match(h.el('revision-status').textContent,/Added 1; removed 1; changed 2; unchanged 0/);
  const previous=h.links()[0].href;
  for(const mode of ['failure','mismatch']){
    h.state.failure=mode==='failure';h.state.mismatch=mode==='mismatch';await h.click();
    assert.equal(h.links()[0].href,previous);assert.match(h.el('status').textContent,/Comparison unavailable|does not match/);
  }
  h.state.failure=false;h.state.mismatch=false;
  h.el('revision-file').files=[{size:12,text:async()=>'{broken'}];await h.click();assert.equal(h.links()[0].href,previous);
  h.el('revision-file').handlers.change();assert.equal(h.links().length,0);assert.ok(h.revoked.includes(previous));
  assert.equal(h.el('revision-preview').hidden,true);
});

test('production operator invalidates comparison after pending or applied edits and history restore', async()=>{
  const h=await uiHarness();await h.load();h.el('revision-frame').checked=true;await h.click();
  const previous=h.links()[0].href;h.el('tx').value='500';h.el('tx').handlers.input();
  assert.equal(h.links().length,0);assert.ok(h.revoked.includes(previous));assert.equal(h.el('revision-controls').disabled,true);
  const calls=h.calls.length;await h.click();assert.equal(h.calls.length,calls);
  await h.el('edit-form').handlers.submit(h.event);await h.click();
  const report=JSON.parse(await h.blobs.get(h.links()[1].href).text());assert.equal(report.changes[0].after.transform.translation_mm[0],500);
  await h.el('layout-undo').handlers.click();assert.equal(h.links().length,0);await h.click();
  assert.equal(JSON.parse(await h.blobs.get(h.links()[1].href).text()).after.layout_sha256,composeReferenceLayout(after).layout_sha256);
  while(!h.el('revision-controls').disabled) await h.el('remove').handlers.click();
  assert.equal(h.links().length,0);assert.equal(h.el('revision-preview').hidden,true);
  assert.match(h.el('status').textContent,/Layout is empty/);
});

test('production operator ignores repeated clicks and stale responses after baseline or frame changes', async()=>{
  const h=await uiHarness();await h.load();h.el('revision-frame').checked=true;
  for(const changed of ['revision-file','revision-frame']){
    h.state.hold=true;const pending=h.click();
    while(typeof h.state.hold!=='function') await new Promise(resolve=>setTimeout(resolve,0));
    const calls=h.calls.length;await h.click();assert.equal(h.calls.length,calls);
    assert.equal(h.el('revision-controls').disabled,true);
    h.el(changed).handlers.change();const release=h.state.hold;h.state.hold=null;release();await pending;
    assert.equal(h.links().length,0);assert.equal(h.el('revision-controls').disabled,false);
  }
  await h.click();assert.equal(h.links().length,2);
});
