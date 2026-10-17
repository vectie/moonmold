import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeReferenceLayout } from './reference-layout.mjs';
import { placeReferenceFace } from './reference-face-placement.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/reference-layout.json', import.meta.url), 'utf8'));
const tetra = await readFile(new URL('../fixtures/reference-tetrahedron.obj', import.meta.url), 'utf8');
const near = (a,b,tolerance=1e-8) => a.forEach((n,i) => assert.ok(Math.abs(n-b[i]) <= tolerance, `${a} != ${b}`));
const length = (a,b) => Math.hypot(...a.map((n,i)=>n-b[i]));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub = (a,b) => a.map((n,i)=>n-b[i]);
function example() {
 const layout = structuredClone(fixture);
 layout.instances[1].source = { name:'chosen-tetra', input_format:'obj', units:'cm', text:tetra };
 layout.instances[1].transform = { scale:1.7, rotation_deg:[34,-57,113], center_and_ground:true, translation_mm:[21,-11,47] };
 return layout;
}
function request(layout=example(), extra={}) {
 const before = composeReferenceLayout(layout);
 return { layout, instance_id:layout.instances[1].id, triangle_index:0, height_mm:7,
  expected_layout_sha256:before.layout_sha256, expected_geometry_sha256:before.geometry_sha256, ...extra };
}
function verify(layout, triangle, height) {
 const original = JSON.stringify(layout), before = composeReferenceLayout(layout);
 const next = placeReferenceFace(request(layout,{triangle_index:triangle,height_mm:height}));
 const part = before.parts[1], indices = before.triangles[part.triangle_range.start+triangle];
 const [a,b,c] = indices.map(i=>next.vertices[i]), old = indices.map(i=>before.vertices[i]);
 near(a,[old[0][0],old[0][1],height]); near([a[2],b[2],c[2]],[height,height,height]);
 near([b[1]],[a[1]]); assert.ok(b[0]>a[0]); assert.ok(cross(sub(b,a),sub(c,a))[2]>0);
 for(let i=part.vertex_range.start;i<part.vertex_range.start+part.vertex_range.count;i++) {
  near([length(next.vertices[i],a)],[length(before.vertices[i],old[0])]);
  const expected=next.face_placement.world_to_face_rotation.map((axis,k)=>[old[0][0],old[0][1],height][k]+axis.reduce((v,n,j)=>v+n*(before.vertices[i][j]-old[0][j]),0));
  near(next.vertices[i],expected);
 }
 assert.equal(JSON.stringify(layout),original);
 assert.deepEqual(next.layout.instances[1].source,before.layout.instances[1].source);
 assert.equal(next.layout.instances[1].transform.scale,before.layout.instances[1].transform.scale);
 assert.equal(next.layout.instances[1].transform.center_and_ground,before.layout.instances[1].transform.center_and_ground);
 assert.deepEqual(next.layout.instances.filter((_,i)=>i!==1),before.layout.instances.filter((_,i)=>i!==1));
 assert.deepEqual(next.parts.filter((_,i)=>i!==1),before.parts.filter((_,i)=>i!==1));
 for(let i=0;i<before.vertices.length;i++) if(i<part.vertex_range.start||i>=part.vertex_range.start+part.vertex_range.count) assert.deepEqual(next.vertices[i],before.vertices[i]);
 assert.deepEqual(next.triangles,before.triangles);
 assert.equal(next.face_placement.physical_authority,false); assert.equal(next.physical_authority,false);
 assert.deepEqual(next.face_placement.vertex_indices,indices.map(i=>i-part.vertex_range.start));
 const reopened = composeReferenceLayout(JSON.parse(next.exports.layout));
 assert.equal(reopened.layout_sha256,next.layout_sha256); assert.equal(reopened.geometry_sha256,next.geometry_sha256);
 assert.equal(reopened.exports.obj,next.exports.obj); assert.equal(reopened.exports.stl,next.exports.stl);
 return next;
}

test('all picked faces flatten rigidly from current placements, preserving winding, anchors, other instances and editable round trips', () => {
 for(const ground of [false,true]) for(const rotation of [[34,-57,113],[0,90,17],[28,-90,63],[3,89.999999999,141],[360,720,-360]]) {
  const layout=example(); layout.instances[1].transform.center_and_ground=ground;layout.instances[1].transform.rotation_deg=rotation;
  const count=composeReferenceLayout(layout).parts[1].triangle_range.count;
  for(let triangle=0;triangle<count;triangle++) verify(layout,triangle,triangle%2 ? -22 : 7);
 }
});
test('binary, selected OBJ parts and GLB nodes retain exact source fields and scale', async () => {
 const layouts=['reference-binary-ply.layout.json','reference-ply-layout.json','reference-arrangement.layout.json'];
 for(const file of layouts) {
  const input=JSON.parse(await readFile(new URL('../fixtures/'+file,import.meta.url),'utf8'));
  for(const sourceItem of input.instances) {
   const layout=example();layout.instances[1].source=sourceItem.source;verify(layout,0,3);
  }
 }
 for(const [file,format] of [['reference-tetrahedron-binary.stl','stl'],['reference-scene.glb','glb']]) {
  const layout=example();layout.instances[1].source={input_format:format,name:'binary',units:'mm',data_base64:(await readFile(new URL('../fixtures/'+file,import.meta.url))).toString('base64')};
  if(format==='glb') { layout.instances[1].source.units='m'; layout.instances[1].source.node_ids=[2]; }
  verify(layout,0,0);
 }
});
test('triangle on a negative normal flips right-handed, tiny well-resolved geometry works, repeated placement stays flat', () => {
 const layout=example();layout.instances[1].source={input_format:'obj',units:'mm',name:'negative',text:'v 2 3 8\nv 2 5 8\nv 5 3 8\nv 4 4 10\nf 1 2 3\nf 1 4 2\n'};
 const first=verify(layout,0,0);verify(first.layout,0,0);
 layout.instances[1].source.text='v 0 0 0\nv 0.00001 0 0\nv 0 0.00001 0\nf 1 2 3\n';layout.instances[1].transform={};verify(layout,0,0);
});
test('rejects stale selection, malformed semantic requests, near-collinearity and unresolved tiny edges', () => {
 for(const extra of [{triangle_index:-1},{triangle_index:0.1},{triangle_index:'0'},{triangle_index:999},{height_mm:Infinity},{height_mm:NaN},{height_mm:'0'},{height_mm:1e10},{instance_id:'absent'},{expected_layout_sha256:'old'},{expected_geometry_sha256:'old'},{script:'x'}]) assert.throws(()=>placeReferenceFace(request(example(),extra)));
 for(const input of [null,[],{},request()]) { if(input?.layout) delete input.height_mm;assert.throws(()=>placeReferenceFace(input)); }
 const thin=example();thin.instances[1].source={input_format:'obj',units:'mm',name:'thin',text:'v 0 0 0\nv 1 0 0\nv 1 0.000000000001 0\nf 1 2 3\n'};thin.instances[1].transform={};
 assert.throws(()=>placeReferenceFace(request(thin)),/nearly collinear/);
 thin.instances[1].source.text='v 0 0 0\nv 0.0000001 0 0\nv 0 0.0000001 0\nf 1 2 3\n';thin.instances[1].transform={translation_mm:[1e8,1e8,0]};
 assert.throws(()=>placeReferenceFace(request(thin)),/coordinate precision/);
 thin.instances[1].source.text='v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\n';assert.throws(()=>request(thin),/degenerate/);
});
test('height can cross the full supported coordinate interval without a spurious delta bound', () => {
 const layout=example();layout.instances[1].source={input_format:'obj',units:'mm',name:'far',text:'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'};
 layout.instances[1].transform={translation_mm:[0,0,-900000000]};
 const next=placeReferenceFace(request(layout,{height_mm:900000000}));
 near(next.face_placement.after_vertices_mm.map(p=>p[2]),[900000000,900000000,900000000]);
});
test('real HTTP route validates requests and serves the connected workflow without provider execution', async t => {
 const root=process.env.MOONMOLD_TEST_OUTPUT_ROOT || os.tmpdir();await mkdir(root,{recursive:true});
 const workspace=await mkdtemp(path.join(root,'face-placement-http-'));
 const server=createOperatorServer({workspaceRoot:workspace});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=input=>fetch(base+'/api/reference-layout/place-face',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const valid=await post(request());assert.equal(valid.status,200);assert.deepEqual(await valid.json(),placeReferenceFace(request()));
 for(const extra of [{expected_layout_sha256:'stale'},{triangle_index:999},{height_mm:'1'},{command:'print'}]) {
  const response=await post(request(example(),extra));assert.equal(response.status,400);assert.match((await response.json()).message,/current|triangle|height|exactly/);
 }
 const html=await(await fetch(base+'/reference-layout')).text();assert.match(html,/Lay a picked face flat/);assert.match(html,/\/api\/reference-layout\/place-face/);
});
