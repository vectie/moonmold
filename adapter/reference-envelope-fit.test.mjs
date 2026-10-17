import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeReferenceLayout } from './reference-layout.mjs';
import { fitReferenceEnvelope } from './reference-envelope-fit.mjs';
import { createOperatorServer } from './operator-server.mjs';
const example = JSON.parse(await readFile(new URL('../fixtures/reference-layout.json', import.meta.url), 'utf8'));
const near = (a,b) => a.forEach((n,i) => assert.ok(Math.abs(n-b[i]) < 1e-8, `${a} != ${b}`));
const center = b => b.min.map((n,i)=>(n+b.max[i])/2);
function request(layout=example, extra={}) {
 const before=composeReferenceLayout(layout);
 return { layout, instance_id:layout.instances[0].id, size_mm:[1,1,1], allow_enlarge:false, expected_layout_sha256:before.layout_sha256, expected_geometry_sha256:before.geometry_sha256, ...extra };
}
test('fits rotated mixed-unit geometry uniformly in world XYZ, retaining center, sources and other placements', () => {
 for (const ground of [false,true]) {
  const layout=structuredClone(example); layout.instances[0].source.units='in';
  layout.instances[0].transform={scale:2,rotation_deg:[23,17,61],translation_mm:[80,-23,12],center_and_ground:ground};
  const frozen=JSON.stringify(layout), before=composeReferenceLayout(layout), next=fitReferenceEnvelope(request(layout,{size_mm:[19,11,7]}));
  assert.equal(JSON.stringify(layout),frozen); near(center(next.parts[0].bounds),center(before.parts[0].bounds));
  const factor=Math.min(...before.parts[0].bounds.size.map((n,i)=>[19,11,7][i]/n));
  near(next.parts[0].bounds.size,before.parts[0].bounds.size.map(n=>n*factor));
  assert.deepEqual(next.layout.instances[0].source,before.layout.instances[0].source);
  assert.deepEqual(next.layout.instances.slice(1),before.layout.instances.slice(1));
  assert.deepEqual(next.parts.slice(1),before.parts.slice(1));
  assert.deepEqual(next.layout.instances[0].transform.rotation_deg,[23,17,61]);
  assert.equal(next.layout.instances[0].transform.center_and_ground,ground);
  assert.equal(next.envelope_fit.physical_authority,false); assert.equal(next.physical_authority,false);
  assert.equal(composeReferenceLayout(JSON.parse(next.exports.layout)).geometry_sha256,next.geometry_sha256);
 }
});
test('planar references ignore zero-size axis; enlargement is opt-in and repeated fit is stable', () => {
 const before=composeReferenceLayout(example);
 const stay=fitReferenceEnvelope(request(example,{size_mm:[100,100,100]}));
 assert.equal(stay.layout_sha256,before.layout_sha256);
 const next=fitReferenceEnvelope(request(example,{size_mm:[4,6,1],allow_enlarge:true}));
 near(next.parts[0].bounds.size,[4,6,0]); assert.equal(next.envelope_fit.scale_factor,2);
 const repeat=fitReferenceEnvelope(request(next.layout,{size_mm:[4,6,1],allow_enlarge:true}));
 assert.equal(repeat.geometry_sha256,next.geometry_sha256);
});
test('rejects invalid dimensions, stale identity, unknown selection, arbitrary fields and unsupported scales', () => {
 for (const size of [[0,1,1],[-1,1,1],[Infinity,1,1],[NaN,1,1],['1',1,1],[1,1],[1e10,1,1]]) assert.throws(()=>fitReferenceEnvelope(request(example,{size_mm:size})),/finite positive/);
 for (const extra of [{expected_layout_sha256:'bad'},{expected_geometry_sha256:'bad'},{instance_id:'missing'},{allow_enlarge:'yes'},{script:'x'}]) assert.throws(()=>fitReferenceEnvelope(request(example,extra)));
 assert.throws(()=>fitReferenceEnvelope(request(example,{size_mm:[1e-20,1e-20,1e-20]})),/scale must/);
});
test('actual operator HTTP route returns editable geometry and rejects stale requests without provider execution', async t => {
 const workspace=await mkdtemp(path.join(os.tmpdir(),'moonmold-envelope-'));
 const server=createOperatorServer({workspaceRoot:workspace});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(workspace,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(base+'/api/reference-layout/fit-envelope',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await post(request()); assert.equal(response.status,200);
 const actual=await response.json(); assert.deepEqual(actual,fitReferenceEnvelope(request()));
 const stale=await post(request(example,{expected_layout_sha256:'bad'})); assert.ok(stale.status>=400);
 assert.match((await stale.json()).message,/current layout/);
 const page=await (await fetch(base+'/reference-layout')).text(); assert.match(page,/Fit selected reference inside a size envelope/);
});
