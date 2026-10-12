import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { snapReferenceLayout } from './reference-snap.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const fixture = name => new URL('../fixtures/' + name, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-calibration.layout.json'), 'utf8'));
function request(layout = seed, offset = [5,-10,2]) {
  const before = composeReferenceLayout(layout);
  return { layout, endpoint_a: { instance_id: 'panel', vertex_index: 0 }, endpoint_b: { instance_id:'stand', vertex_index:3 }, offset_mm:offset,
    expected_layout_sha256:before.layout_sha256, expected_geometry_sha256:before.geometry_sha256 };
}
const vector = (a,b) => a.forEach((n,i) => assert.ok(Math.abs(n-b[i]) < 1e-7, `${a} != ${b}`));

test('R420 places a rotated grounded cm panel on a PLY vertex plus signed world offset', () => {
  const input = request(), saved = structuredClone(input), before = composeReferenceLayout(seed);
  const result = snapReferenceLayout(input), op = result.snap;
  assert.deepEqual(input,saved);
  vector(op.endpoint_a.coordinates_mm,[130,-25,5]); vector(op.endpoint_b.coordinates_mm,[10,20,40]);
  vector(op.translation_delta_mm,[-115,35,37]); vector(op.after_transform.translation_mm,[-15,55,42]);
  [[15,10,42],[15,100,42],[-45,100,42],[-45,10,42]].forEach((p,i)=>vector(result.vertices[i],p));
  vector(op.actual_offset_mm,[5,-10,2]); vector(op.residual_mm,[0,0,0]);
  assert.deepEqual(result.parts[1],before.parts[1]);
  assert.deepEqual(result.layout.instances[1],before.layout.instances[1]);
  assert.deepEqual(result.layout.instances[0].source,before.layout.instances[0].source);
  for (const field of ['scale','rotation_deg','center_and_ground']) assert.deepEqual(op.after_transform[field],op.before_transform[field]);
  assert.equal(op.endpoint_a.source_sha256,before.parts[0].source_sha256);
  assert.equal(op.parent_layout_sha256,before.layout_sha256); assert.equal(op.parent_geometry_sha256,before.geometry_sha256);
  assert.equal(op.layout_sha256,result.layout_sha256); assert.equal(op.geometry_sha256,result.geometry_sha256); assert.equal(op.physical_authority,false);
});

test('R420 binary STL, selected GLB and binary PLY preserve exact embedded sources', async () => {
  const sources = [
    { input_format:'stl',units:'in',data_base64:(await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') },
    { input_format:'glb',units:'m',node_ids:[1],data_base64:(await readFile(fixture('reference-scene.glb'))).toString('base64') },
    JSON.parse(await readFile(fixture('reference-binary-ply.layout.json'),'utf8')).instances[0].source,
  ];
  for (const source of sources) {
    const layout=structuredClone(seed); layout.instances[0].source=source;
    layout.instances[0].transform={scale:0.75,rotation_deg:[23,-41,67],center_and_ground:false,translation_mm:[-18,9,37]};
    const before=composeReferenceLayout(layout), result=snapReferenceLayout(request(layout,[0,0,0]));
    vector(result.vertices[0],[10,20,40]); assert.deepEqual(result.parts[1],before.parts[1]);
    assert.deepEqual(result.layout.instances[0].source,before.layout.instances[0].source);
    const delta=result.snap.translation_delta_mm;
    before.vertices.slice(0,before.parts[0].vertex_range.count).forEach((p,i)=>vector(result.vertices[i],p.map((n,a)=>n+delta[a])));
  }
});

test('R420 saved layout reopens, repeat snap is idempotent and reverse direction moves only B', () => {
  const result=snapReferenceLayout(request()), reopened=composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256,result.layout_sha256); assert.equal(reopened.geometry_sha256,result.geometry_sha256);
  const repeat=snapReferenceLayout(request(reopened.layout)); assert.equal(repeat.layout_sha256,result.layout_sha256);
  const input=request(reopened.layout,[0,0,0]); [input.endpoint_a,input.endpoint_b]=[input.endpoint_b,input.endpoint_a];
  const reverse=snapReferenceLayout(input); assert.deepEqual(reverse.parts[0],result.parts[0]);
  vector(reverse.snap.endpoint_a_after_mm,reverse.snap.endpoint_b_after_mm);
});

test('R420 rejects malformed, same-instance, stale, invalid-index and out-of-bounds requests without mutation', () => {
  const invalid=[null,[],{}, {...request(),extra:true}];
  for(const offset_mm of [undefined,[],[1,2],[1,2,3,4],[0,NaN,0],[0,Infinity,0],['1',0,0],[1e10,0,0]]) invalid.push({...request(),offset_mm});
  for(const endpoint_b of [null,{instance_id:'panel',vertex_index:1},{instance_id:'missing',vertex_index:0},{instance_id:'stand',vertex_index:4},{instance_id:'stand',vertex_index:0.5}]) invalid.push({...request(),endpoint_b});
  invalid.push({...request(),expected_layout_sha256:'0'.repeat(64)}, {...request(),expected_geometry_sha256:'0'.repeat(64)});
  invalid.push(request(seed,[1e9,0,0]));
  for(const input of invalid) { const saved=structuredClone(input); assert.throws(()=>snapReferenceLayout(input)); assert.deepEqual(input,saved); }
  const stale=request(structuredClone(seed)); stale.layout.instances[0].source.text+='# revision\n'; assert.throws(()=>snapReferenceLayout(stale),/Stale endpoint/);
});

test('R420 CLI exports, reopens, refuses overwrite and retains every error/fixture', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-snap-cli-'));
  const cli=new URL('../bin/moonmold-reference-snap.mjs',import.meta.url).pathname;
  const argv=['--input',fixture('reference-calibration.layout.json').pathname,'--moving','panel','--reference','stand','--a-vertex','0','--b-vertex','3','--offset-mm','5,-10,2'];
  let count=0;
  async function run(args) {
    const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'}), id=String(++count).padStart(2,'0');
    await writeFile(path.join(dir,id+'.json'),JSON.stringify({argv:[process.execPath,cli,...args],status:result.status,stdout:result.stdout,stderr:result.stderr},null,2),{flag:'wx'});
    return result;
  }
  const expected=snapReferenceLayout(request());
  for(const format of ['layout','json','obj','stl']) {
    const output=path.join(dir,'result.'+format), result=await run([...argv,'--format',format,'--output',output]); assert.equal(result.status,0,result.stderr);
    const bytes=await readFile(output,'utf8'); assert.equal(bytes,format==='json'?JSON.stringify(expected,null,2)+'\n':expected.exports[format]);
    assert.equal((await run([...argv,'--format',format,'--output',output])).status,1);
    assert.equal(await readFile(output,'utf8'),bytes);
  }
  const reopened=await run(['--input',path.join(dir,'result.layout'),...argv.slice(2),'--format','json']); assert.equal(reopened.status,0); assert.equal(JSON.parse(reopened.stdout).layout_sha256,expected.layout_sha256);
  for(const extra of [['--expect-layout-sha256','0'.repeat(64)],['--format','wat'],['--expect-layout-sha256','0'.repeat(64),'--expect-geometry-sha256','0'.repeat(64)]]) assert.equal((await run([...argv,...extra])).status,1);
  for(const bad of ['', '1,2','1,,3','1,2,NaN','0x10,0,0','1e309,0,0']) assert.equal((await run([...argv.slice(0,-1),bad])).status,1);
  const invalid=path.join(dir,'invalid.json'); await writeFile(invalid,'{broken',{flag:'wx'});
  assert.equal((await run(['--input',invalid,...argv.slice(2)])).status,1);
});
