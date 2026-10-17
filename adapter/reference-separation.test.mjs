import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceSeparation, SEPARATION_MAX_TRIANGLE_PAIRS } from './reference-separation.mjs';
import { createOperatorServer } from './operator-server.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';

const fixture = new URL('../fixtures/reference-separation.layout.json',import.meta.url);
const layout = JSON.parse(await readFile(fixture,'utf8'));
function request(value=layout,a='base',b='raised') {
  const composed = composeReferenceLayout(value);
  return { layout:value, instance_a:a, instance_b:b, expected_layout_sha256:composed.layout_sha256, expected_geometry_sha256:composed.geometry_sha256 };
}
const measure = (value=layout,a='base',b='raised') => measureReferenceSeparation(request(value,a,b));
const near = (a,b,tolerance=1e-9) => assert.ok(Math.abs(a-b) <= tolerance,`${a} != ${b}`);
function pair(a,b) {
  const source = vertices => ({ input_format:'obj', units:'mm', text:vertices.map(p => `v ${p.join(' ')}`).join('\n')+'\nf 1 2 3\n' });
  return { contract_id:'moonmold.reference-layout.v1',name:'triangle-pair',instances:[{ id:'base',source:source(a) },{ id:'raised',source:source(b) }] };
}

test('nearest witnesses use triangle interiors, preserve exact source, and reproduce after save/reopen', () => {
  const original = JSON.stringify(layout), result = measure();
  assert.equal(result.distance_mm,5);
  assert.deepEqual(result.witness_a.coordinates_mm,[10,10,0]);
  assert.deepEqual(result.witness_b.coordinates_mm,[10,10,5]);
  assert.equal(result.witness_a.source_units,'cm');
  assert.equal(result.triangle_pair_count,1);
  assert.equal(result.physical_authority,false);
  assert.deepEqual(measure(JSON.parse(composeReferenceLayout(layout).exports.layout)),result);
  assert.equal(JSON.stringify(layout),original);
  assert.deepEqual(measure(),result);
  const swapped = measure(layout,'raised','base');
  assert.equal(swapped.distance_mm,5);
  assert.deepEqual(swapped.delta_b_minus_a_mm,[0,0,-5]);
});

test('an edge crossing the interior of another triangle gives zero without coincident source vertices', () => {
  const result = measure(layout,'base','crossing');
  assert.equal(result.distance_mm,0);
  assert.deepEqual(result.witness_a.coordinates_mm,[12,12,0]);
  assert.deepEqual(result.witness_b.coordinates_mm,[12,12,0]);
});

test('coplanar overlapping, separated, vertex touching and edge touching triangles', () => {
  const a = [[0,0,0],[4,0,0],[0,4,0]];
  assert.equal(measure(pair(a,[[1,1,0],[2,1,0],[1,2,0]])).distance_mm,0);
  assert.equal(measure(pair(a,[[5,0,0],[6,0,0],[5,1,0]])).distance_mm,1);
  assert.equal(measure(pair(a,[[4,0,0],[5,0,0],[4,1,0]])).distance_mm,0);
  assert.equal(measure(pair(a,[[0,0,0],[4,0,0],[2,-1,0]])).distance_mm,0);
});

test('skew closest edges and existing degenerate-input rejection', () => {
  const a = [[-2,0,0],[2,0,0],[0,-2,0]], b = [[0,-1,3],[0,1,3],[0,0,5]];
  assert.equal(measure(pair(a,b)).distance_mm,3);
  const degenerate = pair([[-2,0,0],[2,0,0],[0,0,0]],[[0,-2,3],[0,2,3],[0,0,3]]);
  assert.throws(() => measure(degenerate),/degenerate face/);
  assert.throws(() => measure(pair([[1,2,3],[1,2,3],[1,2,3]],[[1,2,7],[1,2,7],[1,2,7]])),/degenerate face/);
});

test('mixed units, common rigid motion, uniform scaling and a tiny positive gap', () => {
  const value = structuredClone(layout);
  value.instances = value.instances.slice(0,2);
  // Bake the original 5 mm rise into the second source, then apply a common rigid transform.
  value.instances[1].source.text = 'v 10 10 5\nv 20 10 5\nv 10 20 5\nf 1 2 3\n';
  for (const item of value.instances) item.transform = { scale:2, rotation_deg:[20,-33,61], translation_mm:[1e6,-2e6,3e6] };
  near(measure(value).distance_mm,10,1e-8);
  const tiny = structuredClone(layout); tiny.instances[1].transform.translation_mm[2] = 1e-10;
  assert.equal(measure(tiny).distance_mm,1e-10);
});

test('valid source triangles collapsed by placement precision retain the composer rejection', () => {
  const value = pair([[0,0,0],[0.01,0,0],[0,0.01,0]],[[0,0,1],[1,0,1],[0,1,1]]);
  value.instances[0].transform = { scale:1e-6, translation_mm:[1e9,1e9,0] };
  assert.throws(() => measure(value), {
    code:'invalid-reference-layout',
    message:/Transform collapses a triangle at this coordinate precision/,
  });
});

test('unreferenced vertices do not win; source-only edits stale the earlier selection', () => {
  const value = structuredClone(layout);
  value.instances[0].source.text += 'v 10 10 5\n';
  assert.equal(measure(value).distance_mm,5);
  const stale = request(); stale.layout = structuredClone(layout); stale.layout.instances[0].source.text += '# changed source\n';
  assert.throws(() => measureReferenceSeparation(stale),/Stale/);
  assert.notEqual(measure(value).layout_sha256,measure().layout_sha256);
});

test('contained closed tetrahedra have a positive surface distance, not a solid nonoverlap verdict', () => {
  const source = { input_format:'obj',units:'mm',text:'v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4\n' };
  const value = { contract_id:layout.contract_id,name:'nested',instances:[{ id:'base',source },{ id:'raised',source,transform:{ scale:0.1,translation_mm:[2,2,2] } }] };
  near(measure(value).distance_mm,Math.sqrt(3));
  assert.match(measure(value).limitations[0],/positive surface separation despite overlapping solid interiors/);
});

test('STL, binary PLY and GLB imports use the existing placement and loss pipeline', async () => {
  for (const [filename,format] of [['reference-tetrahedron-binary.stl','stl'],['reference-tetrahedron-be.ply','ply']]) {
    const source = { input_format:format,units:'mm',data_base64:(await readFile(new URL('../fixtures/'+filename,import.meta.url))).toString('base64') };
    const value = { contract_id:layout.contract_id,name:'imported',instances:[{ id:'base',source },{ id:'raised',source,transform:{ translation_mm:[0,0,10] } }] };
    const result = measure(value); assert.ok(result.distance_mm > 0); assert.equal(result.witness_a.source_format,format);
  }
  const data_base64 = exportReferenceLayoutGlb(layout).toString('base64');
  const value = { contract_id:layout.contract_id,name:'glb-gap',instances:[
    { id:'base',source:{ input_format:'glb',units:'m',data_base64,node_ids:[0] } },
    { id:'raised',source:{ input_format:'glb',units:'m',data_base64,node_ids:[1] } },
  ] };
  const result = measure(value); near(result.distance_mm,5,1e-6);
  assert.equal(result.witness_a.source_format,'glb'); assert.ok(result.witness_a.glb_nodes.length);
});

test('strict selection and immutable identity boundary; deterministic earliest equal triangle', () => {
  for (const change of [{ instance_a:'missing' },{ instance_b:'base' },{ unexpected:true },{ expected_geometry_sha256:'0'.repeat(64) },{ expected_layout_sha256:null }]) assert.throws(() => measureReferenceSeparation({ ...request(),...change }),{ code:'invalid-reference-separation' });
  const duplicate = structuredClone(layout); duplicate.instances[0].source.text += 'f 1 2 3\n';
  const result = measure(duplicate); assert.equal(result.witness_a.triangle_index,0); assert.equal(result.triangle_pairs_examined,2);
});

test('pair budget rejects before unbounded cross-product enumeration', () => {
  const value = structuredClone(layout); value.instances = value.instances.slice(0,2);
  for (const part of value.instances) part.source.text += 'f 1 2 3\n'.repeat(500);
  assert.equal(SEPARATION_MAX_TRIANGLE_PAIRS,250000);
  assert.throws(() => measure(value),/requested 251001/);
});

test('real CLI saves a source-bound observation, refuses overwrite, and rejects invalid flags and UTF-8', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'moonmold-separation-'));
  const cli = new URL('../bin/moonmold-reference-separation.mjs',import.meta.url).pathname;
  const base = [cli,'--input',fixture.pathname,'--a-instance','base','--b-instance','raised'];
  const output = path.join(directory,'separation.json');
  assert.equal(spawnSync(process.execPath,[...base,'--output',output],{ encoding:'utf8' }).status,0);
  assert.deepEqual(JSON.parse(await readFile(output,'utf8')),measure());
  assert.notEqual(spawnSync(process.execPath,[...base,'--output',output]).status,0);
  assert.notEqual(spawnSync(process.execPath,[...base,'--a-instance','base']).status,0);
  assert.notEqual(spawnSync(process.execPath,[...base,'--expect-layout-sha256','0'.repeat(64)]).status,0);
  const invalid = path.join(directory,'invalid.json'); await writeFile(invalid,Buffer.from([0xff]));
  assert.notEqual(spawnSync(process.execPath,[cli,'--input',invalid,'--a-instance','base','--b-instance','raised']).status,0);
});

test('real loopback operator endpoint serves the journey and rejects stale selection', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(),'moonmold-separation-http-'));
  const server = createOperatorServer({ workspaceRoot:workspace });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(base+'/reference-layout')).text(); assert.match(page,/Find the nearest gap/);
  const post = input => fetch(base+'/api/reference-layout/separation',{ method:'POST',headers:{ 'content-type':'application/json' },body:JSON.stringify(input) });
  const good = await post(request()); assert.equal(good.status,200); assert.deepEqual(await good.json(),measure());
  const stale = await post({ ...request(),expected_geometry_sha256:'0'.repeat(64) }); assert.equal(stale.status,400);
});
