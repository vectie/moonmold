import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { composeReferenceLayout } from './reference-layout.mjs';
import { exportReferencePlacements, applyReferencePlacements, PLACEMENT_COLUMNS } from './reference-placements.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-layout.json'), 'utf8'));
const workedCsv = await readFile(fixture('reference-placement-edits.csv'), 'utf8');
const rows = csv => csv.trimEnd().split(/\r?\n/).map(line => line.split(','));
function changedCsv(layout = seed) {
  const [header, ...data] = rows(exportReferencePlacements(layout).csv);
  Object.assign(data[0], { 6: '2', 9: '90', 11: '50', 12: '60', 13: '7' });
  Object.assign(data[2], { 6: '1', 7: '0', 10: 'FALSE', 11: '-30', 12: '4', 13: '8' });
  return [header, ...data.reverse()].map(row => row.join(',')).join('\n') + '\n';
}
const expected = () => {
  const layout = composeReferenceLayout(seed).layout;
  layout.instances[0].transform = { scale: 2, rotation_deg: [0,0,90], center_and_ground: false, translation_mm: [50,60,7] };
  layout.instances[2].transform = { scale: 1, rotation_deg: [0,0,0], center_and_ground: false, translation_mm: [-30,4,8] };
  return composeReferenceLayout(layout);
};

test('R478 exports one source-bound row per placement and unchanged table reopens without geometry or source loss', async () => {
  const selected = structuredClone(seed);
  selected.instances[0].source = { name: 'selected', input_format: 'obj', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'),'utf8'), part_ids: ['object-2','object-4'] };
  selected.instances[1].source = { name: 'binary', input_format: 'ply', units: 'in', data_base64: (await readFile(fixture('reference-tetrahedron-le.ply'))).toString('base64') };
  selected.instances[2].source = { name: 'node', input_format: 'glb', units: 'm', data_base64: (await readFile(fixture('reference-scene.glb'))).toString('base64'), node_ids: [1] };
  for (const input of [seed, selected]) {
    const before = composeReferenceLayout(input), table = exportReferencePlacements(input);
    assert.deepEqual(rows(table.csv)[0], [...PLACEMENT_COLUMNS]);
    assert.equal(rows(table.csv).length, input.instances.length + 1);
    const result = applyReferencePlacements({ layout: input, csv: table.csv });
    assert.equal(result.layout_sha256, before.layout_sha256); assert.equal(result.geometry_sha256, before.geometry_sha256);
    assert.deepEqual(result.layout, before.layout); assert.deepEqual(result.placement_table.changed_instances, []);
    assert.equal(result.placement_table.physical_authority, false);
  }
});

test('R478 edits multiple absolute placements by ID, preserves other instances and source bytes, and saves exact reusable layout', () => {
  assert.equal(workedCsv, changedCsv());
  const original = structuredClone(seed), before = composeReferenceLayout(seed);
  const result = applyReferencePlacements({ layout: seed, csv: changedCsv() });
  assert.deepEqual(seed, original); assert.deepEqual(result.layout, expected().layout);
  assert.equal(result.geometry_sha256, expected().geometry_sha256);
  assert.deepEqual(result.vertices[0], [50,60,7]); assert.deepEqual(result.vertices[1], [50,64,7]); assert.deepEqual(result.vertices[2], [44,60,7]);
  assert.deepEqual(result.vertices[6], [-30,4,8]);
  assert.deepEqual(result.parts[1], before.parts[1]);
  assert.deepEqual(result.layout.instances.map(i => i.source), before.layout.instances.map(i => i.source));
  assert.deepEqual(result.layout.instances.map(i => i.id), seed.instances.map(i => i.id));
  assert.deepEqual(result.placement_table.changed_instances.map(i => i.instance_id), ['base-triangle','scaled-copy']);
  assert.equal(result.placement_table.csv_sha256, createHash('sha256').update(changedCsv()).digest('hex'));
  assert.equal(composeReferenceLayout(JSON.parse(result.exports.layout)).layout_sha256, result.layout_sha256);
});

test('R478 spreadsheet quoting, UTF-8 BOM, CRLF, scientific decimals and boolean casing keep exact placement meaning', () => {
  const data = rows(changedCsv()); data[1][11] = ' -3e1 '; data[1][10] = ' false ';
  const csv = '\uFEFF' + data.map(row => row.map(cell => '"' + cell.replaceAll('"','""') + '"').join(',')).join('\r\n') + '\r\n';
  const result = applyReferencePlacements({ layout: seed, csv });
  assert.equal(result.layout_sha256, expected().layout_sha256);
});

test('R478 source edits, changed placements and altered identity rows cannot silently rebind a saved table; invalid batch is atomic', () => {
  const csv = changedCsv();
  for (const modify of [layout => layout.instances[0].source.text += '# revision\n', layout => layout.instances[1].transform.translation_mm[0]++]) {
    const layout = structuredClone(seed); modify(layout); const retained = structuredClone(layout);
    assert.throws(() => applyReferencePlacements({ layout, csv }), /Stale placement table/); assert.deepEqual(layout, retained);
  }
  for (const mutate of [data => data.pop(), data => data[1][2] = 'renamed', data => data[1][5] = 'cm', data => data[2][2] = data[1][2], data => data[1][11] = '=20+10', data => data[1][6] = '0']) {
    const data = rows(csv); mutate(data); const retained = structuredClone(seed);
    assert.throws(() => applyReferencePlacements({ layout: seed, csv: data.map(row => row.join(',')).join('\n') })); assert.deepEqual(seed, retained);
  }
});

test('R478 existing CLI supports actual CSV edit to saved source, report and OBJ/STL/GLB output without overwrites', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moonmold-r478-cli-'));
  const cli = new URL('../bin/moonmold-reference-layout.mjs',import.meta.url).pathname;
  const original = fixture('reference-layout.json').pathname, table = path.join(dir,'placements.csv');
  const run = args => spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
  assert.equal(run(['--input',original,'--format','placements-csv','--output',table]).status,0);
  assert.equal(await readFile(table,'utf8'),exportReferencePlacements(seed).csv);
  const edited = path.join(dir,'edited.csv'); await writeFile(edited,changedCsv(),{flag:'wx'});
  for (const format of ['layout','json','obj','stl','glb']) {
    const output = path.join(dir,`edited.${format}`), args = ['--input',original,'--placements',edited,'--format',format,'--output',output];
    const child = run(args); assert.equal(child.status,0,child.stderr);
    const bytes = await readFile(output);
    if (format === 'glb') { assert.equal(bytes.toString('utf8',0,4),'glTF'); assert.equal(bytes.readUInt32LE(8),bytes.length); }
    else if (format === 'json') assert.equal(JSON.parse(bytes).placement_table.changed_instances.length,2);
    else assert.equal(bytes.toString(),expected().exports[format]);
    assert.equal(run(args).status,1); assert.deepEqual(await readFile(output),bytes);
  }
  const saved = path.join(dir,'edited.layout');
  assert.equal(JSON.parse(run(['--input',saved]).stdout).geometry_sha256,expected().geometry_sha256);
  const bad = path.join(dir,'stale-output.json');
  assert.equal(run(['--input',saved,'--placements',edited,'--output',bad]).status,1);
  await assert.rejects(readFile(bad),{code:'ENOENT'});
  const malformed = path.join(dir,'invalid.csv'); await writeFile(malformed,Buffer.from([255]));
  assert.equal(run(['--input',original,'--placements',malformed,'--output',bad]).status,1);
  await assert.rejects(readFile(bad),{code:'ENOENT'});
});

async function serverFor(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(),'moonmold-r478-http-'));
  const server = createOperatorServer({workspaceRoot});
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('R478 operator HTTP exports source-bound CSV and computes editable preview consumed by existing compose route', async t => {
  const base = await serverFor(t);
  const post = (route,body) => fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const exported = await post('/api/reference-layout/placements/export',seed); assert.equal(exported.status,200);
  assert.deepEqual(await exported.json(),exportReferencePlacements(seed));
  const edited = await post('/api/reference-layout/placements/apply',{layout:seed,csv:changedCsv()}); assert.equal(edited.status,200);
  const result = await edited.json(); assert.equal(result.geometry_sha256,expected().geometry_sha256);
  const reopened = await post('/api/reference-layout/compose',result.layout); assert.equal(reopened.status,200);
  assert.equal((await reopened.json()).layout_sha256,result.layout_sha256);
  const stale = await post('/api/reference-layout/placements/apply',{layout:result.layout,csv:changedCsv()}); assert.equal(stale.status,400);
  assert.match((await stale.json()).message,/Stale placement table/);
});

test('R478 production UI previews without changing downloads, applies one undoable batch, and handles cancellation, dirty fields and failed/stale previews', async t => {
  const base = await serverFor(t), html = await (await fetch(base+'/reference-layout')).text();
  const elements = new Map(), blobs = new Map(), calls = []; let serial = 0, hold = null, mode = 'normal';
  function el(id) { if (!elements.has(id)) elements.set(id,{value:'0',textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}}); return elements.get(id); }
  el('preview').getContext = () => ({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}}); el('preview').width = 1000; el('preview').height = 400;
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,Uint8Array,TextDecoder,btoa,
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(){}},
    fetch:async(route,options)=>{
      calls.push(route); if (hold && route.endsWith('/placements/apply')) await new Promise(resolve=>{hold=resolve;});
      if (mode==='fail' && route.endsWith('/placements/apply')) return {ok:false,json:async()=>({message:'Invalid synthetic CSV'})};
      const response=await fetch(base+route,options);
      if (mode==='mismatch' && route.endsWith('/placements/apply')) {const body=await response.json();body.placement_table.parent_layout_sha256='0'.repeat(64);return{ok:true,json:async()=>body};}
      return response;
    },
  });
  const fire=(id,type='click')=>el(id).handlers[type]({preventDefault(){}});
  const saved=async()=>JSON.parse(await blobs.get(el('downloads').children[0].href).text());
  const load=async layout=>{el('layout-file').files=[{size:3000,text:async()=>JSON.stringify(layout)}];await fire('load-form','submit');};
  const choose=csv=>{const bytes=Buffer.from(csv);el('placements-file').files=[{size:bytes.length,arrayBuffer:async()=>bytes}];fire('placements-file','change');};
  await load(seed); const originalLink=el('downloads').children[0].href;
  await fire('placements-export');assert.equal(await blobs.get(el('placements-download').children[0].href).text(),exportReferencePlacements(seed).csv);
  choose(changedCsv());await fire('placements-form','submit');assert.equal(el('downloads').children[0].href,originalLink);assert.equal(el('placements-apply').disabled,false);assert.match(el('placements-status').textContent,/2 changed placements/);
  fire('placements-cancel');assert.equal(el('placements-apply').disabled,true);await fire('placements-apply');assert.equal(el('downloads').children[0].href,originalLink);
  for (const failure of ['fail','mismatch']) {mode=failure;await fire('placements-form','submit');assert.equal(el('placements-apply').disabled,true);assert.equal(el('downloads').children[0].href,originalLink);}
  mode='normal';hold=true;const pending=fire('placements-form','submit');await new Promise(resolve=>setTimeout(resolve,20));const callCount=calls.length;await fire('placements-form','submit');assert.equal(calls.length,callCount);choose(exportReferencePlacements(seed).csv);hold();hold=null;await pending;assert.equal(el('placements-apply').disabled,true);
  choose(changedCsv());await fire('placements-form','submit');fire('placements-apply');assert.deepEqual(await saved(),expected().layout);assert.equal(el('placements-download').children.length,0);
  assert.equal(el('layout-undo').disabled,false);await fire('layout-undo');assert.equal(composeReferenceLayout(await saved()).layout_sha256,composeReferenceLayout(seed).layout_sha256);
  await fire('layout-redo');assert.deepEqual(await saved(),expected().layout);
  await load(seed);choose(changedCsv());await fire('placements-form','submit');el('scale').value='3';fire('scale','input');assert.equal(el('placements-controls').disabled,true);assert.equal(el('placements-apply').disabled,true);
  const count=calls.length;await fire('placements-form','submit');assert.equal(calls.length,count);fire('discard-placement');assert.equal(el('placements-controls').disabled,false);
  await fire('placements-form','submit');fire('placements-apply');const edited=await saved();await load(edited);assert.equal(composeReferenceLayout(await saved()).geometry_sha256,expected().geometry_sha256);
});
