import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeReferenceLayout } from './reference-layout.mjs';
import { registerReferenceVertices } from './reference-registration.mjs';
import { rotateReferencePoint } from './reference-rotation.mjs';
import { createOperatorServer } from './operator-server.mjs';

const text='v 0 0 0\nv 2 0 0\nv 0 3 0\nv 0 0 4\nf 1 2 3\nf 1 4 2\nf 1 3 4\nf 2 4 3\n';
const near=(a,b,tolerance=1e-8)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<=tolerance,`${a} != ${b}`));
const sub=(a,b)=>a.map((n,i)=>n-b[i]);
const distance=(a,b)=>Math.hypot(...sub(a,b));
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function example() {
 const source={name:'tetra',input_format:'obj',units:'cm',text};
 return {contract_id:'moonmold.reference-layout.v1',name:'three-pairs',instances:[
  {id:'moving',source:structuredClone(source),transform:{scale:1.7,rotation_deg:[34,-57,113],center_and_ground:true,translation_mm:[21,-11,47]}},
  {id:'fixed',source:structuredClone(source),transform:{scale:1.7,rotation_deg:[-71,23,10],center_and_ground:false,translation_mm:[-31,90,15]}},
  {id:'untouched',source:structuredClone(source),transform:{scale:0.3,translation_mm:[99,87,66]}}
 ]};
}
function request(layout=example(),extra={}) {
 const before=composeReferenceLayout(layout);
 return {layout,moving:{instance_id:'moving',vertex_indices:[0,1,2]},fixed:{instance_id:'fixed',vertex_indices:[0,1,2]},expected_layout_sha256:before.layout_sha256,expected_geometry_sha256:before.geometry_sha256,...extra};
}
function verify(layout,extra={},congruent=true) {
 const original=JSON.stringify(layout),before=composeReferenceLayout(layout),next=registerReferenceVertices(request(layout,extra)),r=next.registration;
 const moving=before.parts.find(p=>p.id===r.moving.instance_id),fixed=before.parts.find(p=>p.id===r.fixed.instance_id);
 assert.equal(JSON.stringify(layout),original);assert.deepEqual(next.layout.instances[0].source,before.layout.instances[0].source);
 assert.equal(next.layout.instances[0].transform.scale,before.layout.instances[0].transform.scale);
 assert.equal(next.layout.instances[0].transform.center_and_ground,before.layout.instances[0].transform.center_and_ground);
 assert.deepEqual(next.layout.instances.slice(1),before.layout.instances.slice(1));assert.deepEqual(next.parts.slice(1),before.parts.slice(1));assert.deepEqual(next.triangles,before.triangles);
 for(let i=moving.vertex_range.count;i<before.vertices.length;i++)assert.deepEqual(next.vertices[i],before.vertices[i]);
 const matrix=r.world_rotation;
 near([dot(matrix[0],cross(matrix[1],matrix[2]))],[1]);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)near([dot(matrix[i],matrix[j])],[i===j?1:0]);
 for(let i=0;i<moving.vertex_range.count;i++) {
  near([distance(next.vertices[i],next.vertices[0])],[distance(before.vertices[i],before.vertices[0])]);
  const wanted=matrix.map((row,k)=>r.target_centroid_mm[k]+dot(row,sub(before.vertices[i],r.source_centroid_mm)));
  near(next.vertices[i],wanted,Math.max(1e-8,r.numerical_tolerance_mm));
 }
 r.residuals.forEach((pair,i)=>{
  assert.deepEqual(pair.before_mm,before.vertices[moving.vertex_range.start+r.moving.vertex_indices[i]]);
  assert.deepEqual(pair.target_mm,before.vertices[fixed.vertex_range.start+r.fixed.vertex_indices[i]]);
  assert.deepEqual(pair.after_mm,next.vertices[moving.vertex_range.start+r.moving.vertex_indices[i]]);
  assert.deepEqual(pair.delta_mm,sub(pair.after_mm,pair.target_mm));assert.equal(pair.distance_mm,distance(pair.after_mm,pair.target_mm));
  if(congruent)near(pair.after_mm,pair.target_mm);
 });
 near([r.rms_residual_mm],[Math.hypot(...r.residuals.map(p=>p.distance_mm))/Math.sqrt(3)]);
 assert.equal(r.max_residual_mm,Math.max(...r.residuals.map(p=>p.distance_mm)));
 assert.equal(r.physical_authority,false);assert.equal(next.physical_authority,false);assert.match(r.qualification,/Unequal triangles/);
 const reopened=composeReferenceLayout(JSON.parse(next.exports.layout));
 assert.equal(reopened.layout_sha256,next.layout_sha256);assert.equal(reopened.geometry_sha256,next.geometry_sha256);assert.equal(reopened.exports.obj,next.exports.obj);assert.equal(reopened.exports.stl,next.exports.stl);
 return next;
}

test('proper rigid matching respects arbitrary current rotations, scale, ground, source bytes and saved editable placement',()=>{
 for(const ground of [false,true])for(const rotation of [[34,-57,113],[0,90,17],[28,-90,63],[3,89.999999999,141],[360,720,-360]]) {
  const layout=example();layout.instances[0].transform.center_and_ground=ground;layout.instances[0].transform.rotation_deg=rotation;
  const next=verify(layout);assert.ok(next.registration.max_residual_mm<1e-10);
  for(let i=0;i<4;i++)near(next.vertices[i],next.vertices[i+4]);
  verify(next.layout);
 }
});
test('pair order is honored even across different local vertex orders and planes',()=>{
 const layout=example();layout.instances[1].source.text='v 0 3 0\nv 0 0 0\nv 2 0 0\nv 0 0 4\nf 2 3 1\nf 2 4 3\nf 2 1 4\nf 3 4 1\n';
 verify(layout,{moving:{instance_id:'moving',vertex_indices:[2,0,1]},fixed:{instance_id:'fixed',vertex_indices:[0,1,2]}});
});
test('unequal triangle retains scale, minimizes summed squared residuals and does not pretend exact alignment',()=>{
 const layout=example();for(const item of layout.instances.slice(0,2)){item.transform={};item.source.units='mm';item.source.text='v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n';}
 layout.instances[1].transform.scale=2;
 const next=verify(layout,{},false),r=next.registration;
 near(next.layout.instances[0].transform.rotation_deg,[0,0,0]);near(next.layout.instances[0].transform.translation_mm,[2/3,2/3,0]);
 near([r.rms_residual_mm],[4/3]);assert.ok(r.max_residual_mm>1);near(r.moving_edge_lengths_mm,[2,Math.sqrt(8),2]);near(r.fixed_edge_lengths_mm,[4,Math.sqrt(32),4]);
 const score=points=>points.reduce((sum,p,i)=>sum+distance(p,r.residuals[i].target_mm)**2,0),best=score(r.residuals.map(r=>r.after_mm));
 for(const angle of [-10,-0.01,0.01,10])for(let axis=0;axis<3;axis++){
  const rotation=[0,0,0];rotation[axis]=angle;
  const moved=r.residuals.map(pair=>rotateReferencePoint(sub(pair.after_mm,r.target_centroid_mm),rotation).map((n,i)=>n+r.target_centroid_mm[i]));
  assert.ok(score(moved)>=best-1e-12);
 }
 // Unequal shapes, not merely a uniformly scaled copy.
 layout.instances[1].source.text='v 1 0 0\nv 4 1 2\nv 0 3 1\nf 1 2 3\n';
 const unequal=verify(layout,{},false).registration;
 const objective=points=>points.reduce((sum,p,i)=>sum+distance(p,unequal.residuals[i].target_mm)**2,0),minimum=objective(unequal.residuals.map(r=>r.after_mm));
 for(let axis=0;axis<3;axis++)for(const angle of [-0.1,0.1]){const rotation=[0,0,0];rotation[axis]=angle;assert.ok(objective(unequal.residuals.map(pair=>rotateReferencePoint(sub(pair.after_mm,unequal.target_centroid_mm),rotation).map((n,i)=>n+unequal.target_centroid_mm[i])))>=minimum-1e-10);}
});
test('mirrored tetrahedron is never reflected: chosen plane aligns but fourth vertex retains handedness',()=>{
 const layout=example();for(const item of layout.instances.slice(0,2)){item.transform={};item.source.units='mm';}
 layout.instances[1].source.text=text.replace('v 0 3 0','v 0 -3 0');
 const next=verify(layout);near(next.vertices[3],[0,0,-4]);near(next.vertices[7],[0,0,4]);assert.ok(distance(next.vertices[3],next.vertices[7])>7.9);
});
test('binary source, selected OBJ parts and GLB node selections remain editable without rewriting originals',async()=>{
 for(const file of ['reference-binary-ply.layout.json','reference-arrangement.layout.json']) {
  const fixture=JSON.parse(await readFile(new URL('../fixtures/'+file,import.meta.url),'utf8'));
  for(const item of fixture.instances){const layout=example();layout.instances[0].source=structuredClone(item.source);layout.instances[1].source=structuredClone(item.source);const before=composeReferenceLayout(layout),vertices=before.triangles[0].map(i=>i-before.parts[0].vertex_range.start);verify(layout,{moving:{instance_id:'moving',vertex_indices:vertices},fixed:{instance_id:'fixed',vertex_indices:vertices}});}
 }
 for(const [file,format] of [['reference-tetrahedron-binary.stl','stl'],['reference-scene.glb','glb']]) {
  const source={input_format:format,name:'binary',units:format==='glb'?'m':'mm',data_base64:(await readFile(new URL('../fixtures/'+file,import.meta.url))).toString('base64'),...(format==='glb'?{node_ids:[2]}:{})};
  const layout=example();layout.instances[0].source=structuredClone(source);layout.instances[1].source=structuredClone(source);verify(layout);
 }
});
test('rejects malformed, stale, duplicate, missing, collinear and precision-degenerate selections',()=>{
 for(const extra of [{moving:null},{moving:{instance_id:'moving',vertex_indices:[0,0,2]}},{fixed:{instance_id:'moving',vertex_indices:[0,1,2]}},{moving:{instance_id:'moving',vertex_indices:[0,'1',2]}},{moving:{instance_id:'moving',vertex_indices:[-1,1,2]}},{moving:{instance_id:'moving',vertex_indices:[0,1,99]}},{moving:{instance_id:'absent',vertex_indices:[0,1,2]}},{moving:{instance_id:'moving',vertex_indices:[0,1,2],script:'x'}},{expected_layout_sha256:'old'},{expected_geometry_sha256:'old'},{script:'x'}])assert.throws(()=>registerReferenceVertices(request(example(),extra)));
 for(const value of [null,[],{},request()]){if(value?.layout)delete value.fixed;assert.throws(()=>registerReferenceVertices(value));}
 for(const side of [0,1])for(const [vertices,transform,pattern] of [
  ['v 0 0 0\nv 1 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 4\n',{},/collinear/],
  ['v 0 0 0\nv 1 0 0\nv 1 0.000000000001 0\nf 1 2 3\n',{},/collinear/],
  ['v 0 0 0\nv 0.0000001 0 0\nv 0 0.0000001 0\nf 1 2 3\n',{translation_mm:[1e8,1e8,0]},/coordinate precision/],
  ['v 0 0 0\nv 10 0 0\nv 10 0.0000001 0\nf 1 2 3\n',{translation_mm:[1e8,0,0]},/coordinate precision/],
 ]){const layout=example();layout.instances[side].source={name:'thin',input_format:'obj',units:'mm',text:vertices};layout.instances[side].transform=transform;assert.throws(()=>registerReferenceVertices(request(layout)),pattern);}
});
test('tiny well-resolved triangles and large opposite translations retain proper matching',()=>{
 const layout=example();for(const item of layout.instances.slice(0,2)){item.transform={};item.source.units='mm';item.source.text='v 0 0 0\nv 0.00001 0 0\nv 0 0.00001 0\nf 1 2 3\n';}verify(layout);
 for(const item of layout.instances.slice(0,2))item.source.text='v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n';
 layout.instances[0].transform.translation_mm=[0,0,-9e8];layout.instances[1].transform.translation_mm=[0,0,9e8];verify(layout);
});
test('real operator endpoint serves and validates registration without native or provider execution',async t=>{
 const root=process.env.MOONMOLD_TEST_OUTPUT_ROOT||os.tmpdir();await mkdir(root,{recursive:true});const workspace=await mkdtemp(path.join(root,'registration-http-'));
 const server=createOperatorServer({workspaceRoot:workspace});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,post=input=>fetch(base+'/api/reference-layout/register-vertices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const response=await post(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),registerReferenceVertices(request()));
 for(const extra of [{expected_layout_sha256:'stale'},{moving:{instance_id:'moving',vertex_indices:[0,0,2]}},{script:'print'}]){const rejected=await post(request(example(),extra));assert.equal(rejected.status,400);}
 const page=await(await fetch(base+'/reference-layout')).text();assert.match(page,/Register two references with three vertex pairs/);assert.match(page,/\/api\/reference-layout\/register-vertices/);
});
