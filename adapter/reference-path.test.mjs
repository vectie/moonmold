import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { measureReferencePath, PATH_MAX_ENDPOINTS, PATH_MAX_OBSERVATION_BYTES } from './reference-path.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const seed = { contract_id:'moonmold.reference-layout.v1', name:'ordered-review', instances:[
 { id:'panel', source:{input_format:'obj',units:'mm',name:'path-points',text:'v 0 0 0\nv 3 0 0\nv 3 4 0\nv 0 4 0\nv 0 4 12\nv 0 0 12\nf 1 2 3 4\n'},transform:{} },
 { id:'other', source:{input_format:'obj',units:'mm',text:'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'},transform:{translation_mm:[0,0,5]} },
] };
const ep = (vertex_index,instance_id='panel') => ({instance_id,vertex_index});
const request = (layout=seed, endpoints=[0,1,2,3].map(i=>ep(i)), closed=false) => {
 const composed=composeReferenceLayout(layout);return {layout:structuredClone(layout),endpoints,closed,expected_layout_sha256:composed.layout_sha256,expected_geometry_sha256:composed.geometry_sha256};
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('three, four and five segments preserve order, literal lengths and cumulative totals without mutation',()=>{
 for (const [indices,lengths,cumulative] of [ [[0,1,2,3],[3,4,3],[3,7,10]], [[0,1,2,3,4],[3,4,3,12],[3,7,10,22]], [[0,1,2,3,4,5],[3,4,3,12,4],[3,7,10,22,26]] ]) {
  const input=request(seed,indices.map(i=>ep(i))),before=structuredClone(input),report=measureReferencePath(input);
  assert.deepEqual(input,before);assert.equal(report.segment_count,lengths.length);assert.equal(report.endpoint_count,indices.length);
  assert.deepEqual(report.endpoints.map(e=>e.vertex_index),indices);assert.deepEqual(report.segments.map(s=>s.length_mm),lengths);assert.deepEqual(report.segments.map(s=>s.cumulative_length_mm),cumulative);assert.equal(report.total_length_mm,cumulative.at(-1));
  assert.deepEqual(report.segments.map(s=>[s.index,s.from_endpoint_index,s.to_endpoint_index,s.closing]),lengths.map((_,i)=>[i,i,i+1,false]));
  assert.equal(report.physical_authority,false);assert.match(report.qualification,/Not a surface or geodesic/);assert.equal(report.units,'mm');assert.deepEqual(JSON.parse(JSON.stringify(report)),report);
 }
});
test('optional closure, arbitrary order, repeated selectors and coincident points remain explicit',()=>{
 const open=request();delete open.closed;assert.equal(measureReferencePath(open).closed,false);
 const closed=measureReferencePath(request(seed,[0,1,2,3].map(i=>ep(i)),true));assert.equal(closed.total_length_mm,14);assert.deepEqual(closed.segments[3],{index:3,from_endpoint_index:3,to_endpoint_index:0,closing:true,delta_mm:[0,-4,0],length_mm:4,cumulative_length_mm:14});
 const reordered=measureReferencePath(request(seed,[0,2,1,3].map(i=>ep(i))));assert.deepEqual(reordered.segments.map(s=>s.length_mm),[5,4,5]);
 const repeated=measureReferencePath(request(seed,[0,0,1,0].map(i=>ep(i)),true));assert.deepEqual(repeated.segments.map(s=>s.length_mm),[0,3,3,0]);assert.deepEqual(repeated.segments.map(s=>s.cumulative_length_mm),[0,3,6,6]);assert.equal(repeated.endpoints.length,4);
 const zero=measureReferencePath(request(seed,[ep(0),ep(0)],true));assert.equal(zero.total_length_mm,0);assert.equal(zero.segment_count,2);
 const cross=measureReferencePath(request(seed,[ep(0),ep(0,'other'),ep(3)]));assert.deepEqual(cross.endpoints.map(e=>e.layout_vertex_index),[0,6,3]);assert.equal(cross.segments[0].length_mm,5);near(cross.total_length_mm,5+Math.sqrt(41));
 const max=measureReferencePath(request(seed,Array.from({length:PATH_MAX_ENDPOINTS},()=>ep(0)),true));assert.equal(max.segment_count,64);
});
test('unit conversion, scale, rotation, grounding and translation use true placed coordinates',()=>{
 for(const [units,factor] of [['mm',1],['cm',10],['m',1000],['in',25.4]]) {
  const layout=structuredClone(seed);layout.instances[0].source.units=units;layout.instances[0].transform={scale:2,rotation_deg:[35,20,91],center_and_ground:true,translation_mm:[100,-30,4]};
  const report=measureReferencePath(request(layout,[0,1,2,3,4,5].map(i=>ep(i))));near(report.total_length_mm,26*2*factor);assert.deepEqual(report.endpoints[4].coordinates_mm,composeReferenceLayout(layout).vertices[4]);assert.deepEqual(report.endpoints[0].transform,composeReferenceLayout(layout).parts[0].transform);
 }
 const layout=structuredClone(seed);layout.instances[0].source.units='cm';layout.instances[0].transform={scale:2,rotation_deg:[0,0,90],center_and_ground:true,translation_mm:[100,-30,4]};
 const report=measureReferencePath(request(layout));report.endpoints[0].coordinates_mm.forEach((n,i)=>near(n,[140,-60,4][i]));near(report.total_length_mm,200);
});
test('part-selected local order carries original source indices and saved layouts reopen identically',async()=>{
 const layout=JSON.parse(await readFile(new URL('../fixtures/reference-alignment.layout.json',import.meta.url),'utf8'));
 layout.instances[0].source.part_ids=['object-2'];
 const input=request(layout,[ep(0),ep(1),ep(2),ep(0)]),report=measureReferencePath(input);
 assert.deepEqual(report.endpoints.map(e=>e.source_vertex_index),[0,1,4,0]);assert.deepEqual(report.endpoints[2].selection.part_ids,['object-2']);assert.equal(report.endpoints[2].vertex_index,2);
 const reopened=JSON.parse(composeReferenceLayout(layout).exports.layout),saved=JSON.parse(JSON.stringify(report));
 assert.deepEqual(measureReferencePath(request(reopened,saved.endpoints.map(({instance_id,vertex_index})=>({instance_id,vertex_index})),saved.closed)),report);
 assert.throws(()=>measureReferencePath(request(layout,[ep(0),ep(4)])),/zero-based/);
});
test('strict bounds, invalid indices and stale layout or geometry identities reject without changing input',()=>{
 for(const input of [null,[],{}, {...request(),execute:'shell'}, {...request(),endpoints:[]}, {...request(),endpoints:[ep(0)]}, {...request(),endpoints:Array.from({length:65},()=>ep(0))}, {...request(),endpoints:{}}, {...request(),closed:null}, {...request(),closed:'false'}, {...request(),closed:1}]) assert.throws(()=>measureReferencePath(input));
 for(const value of [ep(-1),ep(6),ep(.5),ep('0'),ep(Number.MAX_SAFE_INTEGER+1),ep(0,'absent'),{...ep(0),triangle_index:0},null,[]]) assert.throws(()=>measureReferencePath({...request(),endpoints:[ep(0),value]}));
 for(const key of ['expected_layout_sha256','expected_geometry_sha256']) for(const value of [undefined,'wrong','0'.repeat(64)]) assert.throws(()=>measureReferencePath({...request(),[key]:value}));
 for(const mutate of [i=>i.layout.instances[0].source.text+='# revised\n',i=>i.layout.instances[0].source.text=i.layout.instances[0].source.text.replace('v 3 0 0','v 6 0 0'),i=>i.layout.instances[0].transform={translation_mm:[1,2,3]},i=>i.layout.instances[0].source.units='cm',i=>i.layout.instances.reverse(),i=>i.layout.name='renamed']) {
  const input=request();mutate(input);const before=structuredClone(input);assert.throws(()=>measureReferencePath(input),/Stale path/);assert.deepEqual(input,before);
 }
 const comment=request();comment.layout.instances[0].source.text+='# identity only\n';assert.equal(composeReferenceLayout(comment.layout).geometry_sha256,comment.expected_geometry_sha256);assert.throws(()=>measureReferencePath(comment),/Stale path/);
});
test('production HTTP route returns exact source-bound observation, strict errors and bounded JSON',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'path-http-')),server=createOperatorServer({workspaceRoot:dir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,post=body=>fetch(base+'/api/reference-layout/path',{method:'POST',body:JSON.stringify(body)});
 const response=await post(request(seed,[0,1,2,3,4,5].map(i=>ep(i)),true));assert.equal(response.status,200);assert.deepEqual(await response.json(),measureReferencePath(request(seed,[0,1,2,3,4,5].map(i=>ep(i)),true)));
 for(const body of [{...request(),closed:1},{...request(),expected_geometry_sha256:'0'.repeat(64)},{...request(),endpoints:[ep(0),ep(9)]}]) assert.equal((await post(body)).status,400);
 assert.equal((await fetch(base+'/api/reference-layout/path',{method:'POST',body:'{broken'})).status,400);
 assert.equal((await fetch(base+'/api/reference-layout/path',{method:'POST',body:' '.repeat(3_000_001)})).status,400);
 const html=await(await fetch(base+'/reference-layout')).text();assert.match(html,/id="path-form"/);assert.match(html,/Reopen matching path choices/);assert.match(html,/not a surface\/geodesic distance/);
});

// Stress inputs and serialized observations stay in memory; no large fixture is written.
test('maximum selected OBJ part count and endpoint count preserve all provenance within the observation bound',()=>{
 const parts=256, source='v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'+Array.from({length:parts-1},(_,i)=>`o p${i+1}\nf 1 2 3\n`).join('');
 const ids=Array.from({length:parts},(_,i)=>`object-${i}`), layout={contract_id:seed.contract_id,name:'max-parts',instances:[{id:'panel',source:{input_format:'obj',units:'mm',text:source,part_ids:ids},transform:{}}]};
 const endpoints=Array.from({length:64},(_,i)=>ep(i%3)), report=measureReferencePath(request(layout,endpoints,true)), bytes=Buffer.byteLength(JSON.stringify(report,null,2)+'\n');
 assert.ok(bytes>200000);assert.ok(bytes<=PATH_MAX_OBSERVATION_BYTES);assert.equal(report.endpoints.length,64);assert.equal(report.segment_count,64);
 for(const endpoint of report.endpoints){assert.deepEqual(endpoint.selection.part_ids,ids);assert.equal(endpoint.source_vertex_index,endpoint.vertex_index);}
 const reopened=JSON.parse(JSON.stringify(report,null,2));assert.deepEqual(reopened,report);assert.deepEqual(measureReferencePath(request(JSON.parse(composeReferenceLayout(layout).exports.layout),endpoints,true)),reopened);
});
