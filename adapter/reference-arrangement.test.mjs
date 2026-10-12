import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { moveReferenceArrangement } from './reference-arrangement.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const layout = JSON.parse(await readFile(fixture('reference-arrangement.layout.json'), 'utf8'));
const request = { layout, instance_ids: ['panel', 'rear'], pivot_mm: [10,20,5], rotation_deg: [0,0,90], translation_mm: [100,-10,2] };
const move = (options = {}) => moveReferenceArrangement({ ...request, ...options });
const near = (actual, expected, tolerance = 1e-8) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= tolerance, `${actual} != ${expected}`));
const root = process.env.MOONMOLD_ARRANGEMENT_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-arrangement-tests');
await mkdir(root, { recursive: true });
const workdir = () => mkdtemp(path.join(root, 'case-'));
const cli = new URL('../bin/moonmold-reference-arrange.mjs', import.meta.url).pathname;
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const args = ['--input', fixture('reference-arrangement.layout.json').pathname, '--instances', 'panel,rear', '--pivot-mm', '10,20,5', '--rotation-deg', '0,0,90', '--translation-mm', '100,-10,2'];
const expected = [[160,25,7], [100,25,7], [100,-5,7], [160,-5,7], [80,40,10], [80,20,10], [90,20,10], [90,40,10]];

// Independent world-space oracle: Rodrigues rotations, one axis at a time.
function worldMove(point, input) {
  let p = point.map((n, i) => n - input.pivot_mm[i]);
  for (let axis = 0; axis < 3; axis++) {
    const v = [0,0,0]; v[axis] = 1;
    const a = (input.rotation_deg[axis] % 360) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const cross = [v[1]*p[2]-v[2]*p[1], v[2]*p[0]-v[0]*p[2], v[0]*p[1]-v[1]*p[0]], dot = p[axis];
    p = p.map((n, i) => n*c + cross[i]*s + v[i]*dot*(1-c));
  }
  return p.map((n, i) => n + input.pivot_mm[i] + input.translation_mm[i]);
}

function checkWorld(input, tolerance = 1e-8) {
  const before = composeReferenceLayout(input.layout), result = moveReferenceArrangement(input);
  for (let i = 0; i < before.parts.length; i++) {
    const part = before.parts[i];
    for (let n = part.vertex_range.start; n < part.vertex_range.start + part.vertex_range.count; n++) {
      if (input.instance_ids.includes(part.id)) near(result.vertices[n], worldMove(before.vertices[n], input), tolerance);
      else assert.deepEqual(result.vertices[n], before.vertices[n]);
    }
    assert.deepEqual(result.layout.instances[i].source, before.layout.instances[i].source);
    assert.equal(result.parts[i].source_sha256, before.parts[i].source_sha256);
  }
  return result;
}

test('turn a mixed-unit two-instance arrangement about a shared pivot while fixed geometry and original sources stay unchanged', () => {
  const untouched = structuredClone(request), before = composeReferenceLayout(layout), result = move();
  assert.deepEqual(request, untouched);
  assert.deepEqual(result.vertices.slice(0,4), before.vertices.slice(0,4));
  result.vertices.slice(4).forEach((p, i) => near(p, expected[i]));
  assert.deepEqual(result.triangles, before.triangles);
  assert.deepEqual(result.layout.instances[0], before.layout.instances[0]);
  for (let i = 1; i < 3; i++) {
    assert.deepEqual(result.layout.instances[i].source, before.layout.instances[i].source);
    assert.equal(result.parts[i].source_sha256, createHash('sha256').update(layout.instances[i].source.text).digest('hex'));
    assert.equal(result.parts[i].transform.scale, before.parts[i].transform.scale);
    assert.equal(result.parts[i].transform.center_and_ground, before.parts[i].transform.center_and_ground);
  }
  assert.equal(result.arrangement.parent_layout_sha256, before.layout_sha256);
  assert.equal(result.arrangement.parent_geometry_sha256, before.geometry_sha256);
  assert.equal(result.arrangement.layout_sha256, result.layout_sha256);
  assert.equal(result.arrangement.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(result.arrangement.instance_ids, ['panel','rear']);
  assert.equal(result.physical_authority, false); assert.equal(result.arrangement.physical_authority, false);
  checkWorld(request);
});

test('world XYZ rotation composes with prior rotation instead of adding Euler angles, including positive/negative gimbal lock', () => {
  const source = { input_format: 'obj', units: 'mm', text: 'v 3 1 -2\nv 7 1 -2\nv 3 6 -2\nv 3 1 5\nf 1 2 3\nf 1 4 2\nf 1 3 4\nf 2 4 3\n' };
  const cases = [
    [[0,0,0],[90,0,0]], [[0,0,0],[0,90,0]], [[0,0,0],[0,-90,0]],
    [[23,90,47],[0,0,90]], [[23,-90,47],[0,0,-90]], [[0,0,0],[0,89.999999,0]],
    [[13,27,-41],[19,-38,67]], [[720,-90,360],[-450,720,810]],
    [[37,89.9999999999999,-73],[0,0,19]], [[37,-89.9999999999999,-73],[0,0,19]],
  ];
  for (const [prior, rotation_deg] of cases) for (const ground of [false,true]) {
    const one = { contract_id: layout.contract_id, name: 'rotations', instances: [{ id: 'part', source,
      transform: { scale: 2.5, rotation_deg: prior, center_and_ground: ground, translation_mm: [13,-19,29] } }] };
    checkWorld({ layout: one, instance_ids: ['part'], pivot_mm: [7,-11,17], rotation_deg, translation_mm: [-31,41,-53] });
  }
});

test('all 16 independent placements move coherently and arbitrary compound turns retain distances and source recipes', () => {
  const many = { contract_id: layout.contract_id, name: 'sixteen', instances: Array.from({ length: 16 }, (_, i) => ({
    ...structuredClone(layout.instances[i % 3]), id: `part-${i}`, transform: { scale: (i+1)/7, rotation_deg: [i*11-73,i*17-89,i*29-157], center_and_ground: i%2 === 0, translation_mm: [i*43-100,i*-17,7*i] },
  })) };
  const before = composeReferenceLayout(many), result = checkWorld({ layout: many, instance_ids: many.instances.map(i => i.id), pivot_mm: [-33,29,-11], rotation_deg: [29,-47,113], translation_mm: [5,7,-9] });
  const distance = (a,b) => Math.hypot(...a.map((n,i) => n-b[i]));
  for (let i = 1; i < before.vertices.length; i++) assert.ok(Math.abs(distance(before.vertices[0],before.vertices[i]) - distance(result.vertices[0],result.vertices[i])) < 1e-8);
});

test('pure translation preserves Euler and grounding recipes; zero or full-turn edit preserves exact layout identity', () => {
  const before = composeReferenceLayout(layout);
  for (const rotation_deg of [[0,0,0],[360,-720,1080]]) {
    const result = move({ rotation_deg, translation_mm: [0,0,0] });
    assert.equal(result.layout_sha256, before.layout_sha256); assert.equal(result.geometry_sha256, before.geometry_sha256);
    assert.equal(result.exports.layout, before.exports.layout);
  }
  const result = checkWorld({ ...request, rotation_deg: [0,0,0] });
  for (let i = 1; i < 3; i++) assert.deepEqual(result.parts[i].transform.rotation_deg, before.parts[i].transform.rotation_deg);
});

test('binary originals, selected OBJ parts and GLB nodes remain byte-exact through move, save/reopen and derived exports', async () => {
  const sources = [{ input_format: 'obj', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'), 'utf8'), part_ids: ['object-2'] }];
  for (const [file, input_format, units] of [['reference-tetrahedron-binary.stl','stl','in'],['reference-tetrahedron-be.ply','ply','cm'],['reference-scene.glb','glb','m']]) {
    const source = { input_format, units, data_base64: (await readFile(fixture(file))).toString('base64') };
    if (input_format === 'glb') source.node_ids = [importReferenceMesh(source).glb_nodes[0].node_index];
    sources.push(source);
  }
  const mixed = { contract_id: layout.contract_id, name: 'mixed', instances: sources.map((source,i) => ({ id: `part-${i}`, source, transform: { center_and_ground: i%2===0, translation_mm: [13*i,7*i,-3*i] } })) };
  const result = checkWorld({ ...request, layout: mixed, instance_ids: ['part-0','part-1','part-2','part-3'], rotation_deg: [37,-49,61] });
  const reopened = composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256, result.layout_sha256); assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(reopened.exports, result.exports);
  const obj = importReferenceMesh({ input_format: 'obj', units: 'mm', text: result.exports.obj });
  assert.deepEqual(obj.vertices, result.vertices); assert.deepEqual(obj.triangles, result.triangles);
  assert.equal(importReferenceMesh({ input_format: 'stl', units: 'mm', text: result.exports.stl }).triangle_count, result.triangle_count);
  assert.equal(drawReferenceLayout(reopened.layout).exports.svg, drawReferenceLayout(result.layout).exports.svg);
  assert.deepEqual(exportReferenceLayoutGlb(reopened.layout), exportReferenceLayoutGlb(result.layout));
});

test('a moved arrangement remains editable independently and a second operation uses its saved world placement', () => {
  const once = move(), twice = checkWorld({ ...request, layout: JSON.parse(once.exports.layout) });
  assert.notEqual(twice.geometry_sha256, once.geometry_sha256);
  const edited = structuredClone(once.layout); edited.instances[1].transform.translation_mm[2] += 10;
  const result = composeReferenceLayout(edited);
  result.vertices.slice(4,8).forEach((point,i) => near(point, expected[i].map((n,a) => n+(a===2 ? 10 : 0))));
  assert.deepEqual(result.vertices.slice(8), once.vertices.slice(8));
});

test('invalid selections, vectors, unsupported fields and out-of-range results fail without changing the input', () => {
  const untouched = structuredClone(request);
  for (const instance_ids of [[],['panel','panel'],['missing'],[''],[1],null,Array(17).fill('panel')]) assert.throws(() => move({ instance_ids }), { code: 'invalid-reference-arrangement' });
  for (const key of ['pivot_mm','rotation_deg','translation_mm']) for (const value of [null,[],[1,2],[1,2,3,4],[NaN,0,0],[Infinity,0,0],['1',0,0]]) assert.throws(() => move({ [key]: value }), { code: 'invalid-reference-arrangement' });
  for (const key of ['pivot_mm','translation_mm']) assert.throws(() => move({ [key]: [1e9+1,0,0] }), { code: 'invalid-reference-arrangement' });
  for (const input of [null,[],{}, { ...request, script: 'unavailable' }]) assert.throws(() => moveReferenceArrangement(input));
  assert.throws(() => move({ translation_mm: [1e9,0,0] }), /coordinate|range/i);
  assert.deepEqual(request, untouched);
});

test('real CLI saves editable layouts, JSON observations and meshes with strict numeric input and no-clobber output', async () => {
  const dir = await workdir(), output = path.join(dir,'turned.layout.json');
  let response = run([...args,'--output',output]); assert.equal(response.status,0,response.stderr);
  assert.equal(await readFile(output,'utf8'),move().exports.layout);
  response = run([...args,'--output',output]); assert.equal(response.status,1); assert.match(response.stderr,/EEXIST/);
  assert.equal(await readFile(output,'utf8'),move().exports.layout);
  for (const format of ['layout','json','obj','stl']) {
    response = run([...args,'--format',format]); assert.equal(response.status,0,response.stderr);
    assert.equal(response.stdout,format==='json' ? JSON.stringify(move(),null,2)+'\n' : move().exports[format]);
  }
  assert.equal(run(args.slice(0,8)).stdout, move({ translation_mm: [0,0,0] }).exports.layout);
  for (const extra of [['--format','svg'],['--instances','panel'],['--script','bad'],['--output']]) assert.equal(run([...args,...extra]).status,1);
  for (const value of ['0x10,0,0','1,,2','NaN,0,0','1,2','1e999,0,0']) assert.equal(run([...args.slice(0,6),'--rotation-deg',value]).status,1);
  assert.equal(run([...args.slice(0,6),'--rotation-deg','-3e1,+4.0e1,.5']).status,0);
  for (const [name,data] of [['utf8',Buffer.from([255])],['syntax','{broken'],['huge',Buffer.alloc(3000001,32)]]) {
    const file = path.join(dir,name), out = `${file}.out`; await writeFile(file,data);
    assert.equal(run(['--input',file,...args.slice(2),'--output',out]).status,1); await assert.rejects(access(out));
  }
});

test('real loopback API composes the same move and serves syntactically valid arrangement controls', async t => {
  const server = createOperatorServer({ workspaceRoot: await workdir() });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(`${url}/api/reference-layout/arrange`,{ method:'POST', body });
  let response = await send(JSON.stringify(request)); assert.equal(response.status,200); assert.deepEqual(await response.json(),move());
  for (const body of ['{}','{broken',' '.repeat(3000001),JSON.stringify({ ...request,instance_ids:['missing'] })]) assert.equal((await send(body)).status,400);
  const html = await (await fetch(`${url}/reference-layout`)).text(); assert.match(html,/Move chosen arrangement/);
  const syntax = spawnSync(process.execPath,['--input-type=module','--check'],{ input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8' });
  assert.equal(syntax.status,0,syntax.stderr);
});

test('production UI handlers move selected instances, protect pending edits, clear derived results and keep editable reopen', async () => {
  const html = await readFile(new URL('../ui/reference-layout/index.html',import.meta.url),'utf8');
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [];
  let serial=0, fail=false, mismatch=false, hold=null;
  function el(id) {
    if (!elements.has(id)) elements.set(id,{ value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},
      addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},
      get selectedOptions(){return this.children.filter(c=>c.selected);} });
    return elements.get(id);
  }
  el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
  el('preview').width=1000; el('preview').height=400;
  el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(layout)}];
  ['pivot-x','pivot-y','pivot-z'].forEach((id,i)=>el(id).value=String(request.pivot_mm[i]));
  ['arrange-rx','arrange-ry','arrange-rz'].forEach((id,i)=>el(id).value=String(request.rotation_deg[i]));
  ['arrange-tx','arrange-ty','arrange-tz'].forEach((id,i)=>el(id).value=String(request.translation_mm[i]));
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,TextDecoder,
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async(url,options)=>{
      const input=JSON.parse(options.body);calls.push({url,input});
      if(url.endsWith('/arrange')){
        if(hold)await new Promise(resolve=>{hold=resolve;});
        if(fail)return {ok:false,json:async()=>({message:'Arrangement unavailable'})};
        try { const next=moveReferenceArrangement(input);if(mismatch)next.arrangement.parent_geometry_sha256='0'.repeat(64);return {ok:true,json:async()=>next}; }
        catch(error){return {ok:false,json:async()=>({message:error.message})};}
      }
      if(url.endsWith('/drawing'))return {ok:true,json:async()=>drawReferenceLayout(input)};
      if(url.endsWith('/glb'))return {ok:true,arrayBuffer:async()=>exportReferenceLayoutGlb(input)};
      return {ok:true,json:async()=>composeReferenceLayout(input)};
    },
  });
  const event={preventDefault(){}},submit=()=>el('arrange-form').handlers.submit(event);
  const choose=()=>el('arrange-targets').children.forEach(option=>option.selected=['panel','rear'].includes(option.value));
  await submit(); assert.equal(calls.length,0);
  await el('load-form').handlers.submit(event); assert.equal(el('arrange-controls').disabled,false);choose();
  await el('drawing-export').handlers.click();await el('glb-export').handlers.click();
  const links=el('downloads').children,drawingUrl=el('drawing-download').children[0].href,glbUrl=el('glb-download').children[0].href;
  for(const mode of ['failure','mismatch']){
    fail=mode==='failure';mismatch=mode==='mismatch';await submit();
    assert.equal(el('downloads').children,links);assert.equal(el('drawing-download').children[0].href,drawingUrl);
    assert.match(el('status').textContent,/unavailable|does not match/);
  }
  fail=false;mismatch=false;
  el('tx').value='7';el('tx').handlers.input();const count=calls.length;
  assert.equal(el('arrange-controls').disabled,true);await submit();assert.equal(calls.length,count);
  await el('edit-form').handlers.submit(event);choose();
  hold=true;const pending=submit();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el('arrange-controls').disabled,true);const pendingCount=calls.length;
  await submit();assert.equal(calls.length,pendingCount);const release=hold;hold=null;release();await pending;
  const savedLink=el('downloads').children.find(c=>c.download.endsWith('.layout.json'));
  const saved=JSON.parse(await blobs.get(savedLink.href).text());
  assert.equal(saved.instances[0].transform.translation_mm[0],7);
  composeReferenceLayout(saved).vertices.slice(4).forEach((p,i)=>near(p,expected[i]));
  assert.deepEqual(saved.instances[1].source,layout.instances[1].source);
  assert.match(el('status').textContent,/Moved together: panel, rear/);
  assert.deepEqual(el('arrange-targets').selectedOptions.map(c=>c.value),['panel','rear']);
  assert.equal(el('drawing-download').children.length,0);assert.equal(el('glb-download').children.length,0);
  assert.ok(revoked.includes(drawingUrl));assert.ok(revoked.includes(glbUrl));
  assert.equal(el('measure-a-instance').value,'');assert.equal(el('measure-a-vertex').value,'');
  const report=el('downloads').children.find(c=>c.download.endsWith('.report.json'));
  assert.deepEqual(JSON.parse(await blobs.get(report.href).text()).arrangement.instance_ids,['panel','rear']);
  const lastGood=el('downloads').children;el('arrange-targets').children.forEach(c=>c.selected=false);
  const beforeEmpty=calls.length;await submit();assert.equal(calls.length,beforeEmpty);assert.equal(el('downloads').children,lastGood);
  choose();await submit();assert.notEqual(el('downloads').children,lastGood);
  el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(saved)}];await el('load-form').handlers.submit(event);
  await el('drawing-export').handlers.click();assert.equal(await blobs.get(el('drawing-download').children[0].href).text(),drawReferenceLayout(saved).exports.svg);
  while(el('arrange-controls').disabled===false)await el('remove').handlers.click();
  assert.equal(el('arrange-controls').disabled,true);assert.equal(el('arrange-targets').children.length,0);
});
