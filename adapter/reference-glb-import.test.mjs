import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importReferenceMesh } from './reference-mesh.mjs';
import { parseReferenceGlb } from './reference-glb-import.mjs';
import { importReferenceGlbLayout } from './reference-glb-layout.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { sectionReferenceLayout } from './reference-layout-section.mjs';
import { createOperatorServer } from './operator-server.mjs';
const fixture=new URL('../fixtures/reference-scene.glb',import.meta.url), bytes=await readFile(fixture);
const expected=JSON.parse(await readFile(new URL('../fixtures/reference-scene.expected.json',import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const input=(data=bytes)=>({data_base64:data.toString('base64'),name:'scene'});
const source=(data=bytes)=>({input_format:'glb',units:'m',...input(data)});
const root=process.env.MOONMOLD_GLB_IMPORT_TEST_ROOT ?? path.join(tmpdir(),'moonmold-glb-import-tests');
await mkdir(root,{recursive:true});const directory=()=>mkdtemp(path.join(root,'case-'));
const near=(a,b,epsilon=1e-9)=>{assert.equal(a.length,b.length);a.forEach((n,i)=>Array.isArray(n)?near(n,b[i],epsilon):assert.ok(Math.abs(n-b[i])<=epsilon,`${n} != ${b[i]}`));};
// The fixture is independently encoded with Python struct. Mutation/edge-case
// containers below are also constructed without the production exporter.
function unpack(data=bytes) { const length=data.readUInt32LE(12);return {g:JSON.parse(data.subarray(20,20+length)),bin:Buffer.from(data.subarray(28+length))}; }
function pack(g,bin) {
  const raw=Buffer.from(JSON.stringify(g)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
  const binary=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(binary);
  const result=Buffer.alloc(28+json.length+binary.length);result.writeUInt32LE(0x46546c67);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);const offset=20+json.length;result.writeUInt32LE(binary.length,offset);result.writeUInt32LE(0x004e4942,offset+4);binary.copy(result,offset+8);return result;
}
function mutate(fn) { const {g,bin}=unpack();fn(g,bin);return pack(g,bin); }
function simple({type=5123,indexed=true,stride=12,offset=0,multiple=false}={}) {
  const size={5121:1,5123:2,5125:4}[type],vertices=[[0,0,0],[1,0,0],[0,1,0]],positions=Buffer.alloc(offset+stride*3),indices=Buffer.alloc(size*3);
  vertices.forEach((v,i)=>v.forEach((n,c)=>positions.writeFloatLE(n,offset+i*stride+c*4)));
  [0,1,2].forEach((n,i)=>indices[{1:'writeUInt8',2:'writeUInt16LE',4:'writeUInt32LE'}[size]](n,i*size));
  const primitive={attributes:{POSITION:0},...(indexed?{indices:1}:{}),mode:4};
  const g={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:multiple?[primitive,structuredClone(primitive)]:[primitive]}],buffers:[{byteLength:positions.length+indices.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length,...(stride===12?{}:{byteStride:stride})},{buffer:0,byteOffset:positions.length,byteLength:indices.length}],accessors:[{bufferView:0,byteOffset:offset,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:type,count:3,type:'SCALAR'}]};
  return pack(g,Buffer.concat([positions,indices]));
}

test('independent GLB scene fixture preserves hierarchy, nonuniform scaling, reflection, units and winding',()=>{
  const result=importReferenceGlbLayout(input());assert.equal(result.instance_count,2);assert.deepEqual(result.parts.map(p=>p.id),['Upper_panel-node-1','Mirrored_panel-node-2']);
  expected.parts.forEach((part,i)=>{
    const actual=result.parts[i],vs=result.vertices.slice(actual.vertex_range.start,actual.vertex_range.start+actual.vertex_range.count);
    near(vs,part.vertices);assert.deepEqual(result.triangles.slice(actual.triangle_range.start,actual.triangle_range.start+actual.triangle_range.count).map(face=>face.map(v=>v-actual.vertex_range.start)),part.triangles);
    assert.equal(actual.source_sha256,sha(bytes));assert.equal(actual.source_units,'m');assert.equal(actual.glb_nodes[0].node_index,part.node_index);assert.equal(actual.glb_nodes[0].winding_reversed,i===1);
    assert.match(actual.coordinate_mapping,/metres\/Y-up.*millimetres\/Z-up/);assert.match(actual.losses.join(' '),/NORMAL.*omitted/);assert.match(actual.losses.join(' '),/Materials/);
  });assert.equal(result.physical_authority,false);
});

test('node instances edit independently, retain exact sources and reopen deterministically for section and exports',()=>{
  const initial=importReferenceGlbLayout(input()),layout=JSON.parse(initial.exports.layout);
  assert.deepEqual(composeReferenceLayout(layout),initial);
  for (const [i,item] of layout.instances.entries()) {assert.equal(item.source.data_base64,bytes.toString('base64'));assert.deepEqual(item.source.node_ids,[i+1]);}
  layout.instances[1].transform.translation_mm=[500,0,0];
  const edited=composeReferenceLayout(layout);near(edited.vertices.slice(0,4),initial.vertices.slice(0,4));near(edited.vertices.slice(4),initial.vertices.slice(4).map(p=>[p[0]+500,p[1],p[2]]));
  assert.notEqual(edited.layout_sha256,initial.layout_sha256);assert.notEqual(edited.geometry_sha256,initial.geometry_sha256);assert.deepEqual(composeReferenceLayout(JSON.parse(edited.exports.layout)),edited);
  for (const format of ['obj','stl']) { const re=importReferenceMesh({input_format:format,units:'mm',text:edited.exports[format]});near(re.triangles.flatMap(face=>face.map(i=>re.vertices[i])),edited.triangles.flatMap(face=>face.map(i=>edited.vertices[i]))); }
  const exported=exportReferenceLayoutGlb(edited.layout), reimported=importReferenceGlbLayout(input(exported));near(reimported.vertices,edited.vertices,0.0001);assert.equal(reimported.triangle_count,8);
  assert.equal(unpack(exported).g.nodes[1].extras.moonmold.source_glb.nodes[0].node_index,2);
  const section=sectionReferenceLayout(edited.layout,{axis:'z',position_mm:210});assert.ok(section.segment_count>0);
});

test('scene selection uses default scene and exact mesh-node IDs, never group subtrees or untrusted extras',()=>{
  const selected=importReferenceGlbLayout({...input(),node_ids:[2]});assert.equal(selected.instance_count,1);assert.deepEqual(selected.layout.instances[0].source.node_ids,[2]);
  const reversed=importReferenceMesh({...source(),node_ids:[2,1]});assert.deepEqual(reversed.glb_node_ids,[1,2]);
  for (const node_ids of [[],[0],[999],[1,1],['1'],[1.5],null]) assert.throws(()=>importReferenceGlbLayout({...input(),node_ids}),/node_ids/);
  const alternative=mutate(g=>{g.nodes.push({name:'other',mesh:0});g.scenes.push({nodes:[3]});g.scene=1;g.asset.extras={moonmold:{source_sha256:'forged',units:'in'}};});
  const other=importReferenceGlbLayout(input(alternative));assert.equal(other.instance_count,1);assert.equal(other.parts[0].source_sha256,sha(alternative));assert.equal(other.parts[0].source_units,'m');near(other.vertices,[[0,0,0],[Math.fround(.02)*1000,0,0],[0,0,Math.fround(.03)*1000],[0,-Math.fround(.04)*1000,0]]);
  assert.throws(()=>parseReferenceGlb(mutate(g=>{g.scenes.push({nodes:[0]});delete g.scene;})),/explicit default scene/);
  assert.equal(parseReferenceGlb(mutate(g=>delete g.scene)).glb_scene_index,0);
});

test('unsigned 8/16/32-bit indices, nonindexed triangles, interleaved positions and multiple primitives import',()=>{
  for (const type of [5121,5123,5125]) for (const stride of [12,24]) for (const offset of [0,4]) {
    const mesh=parseReferenceGlb(simple({type,stride,offset}));near(mesh.vertices,[[0,0,0],[1000,0,0],[0,0,1000]]);assert.deepEqual(mesh.triangles,[[0,1,2]]);
  }
  assert.deepEqual(parseReferenceGlb(simple({indexed:false})).triangles,[[0,1,2]]);
  assert.deepEqual(parseReferenceGlb(simple({multiple:true})).triangles,[[0,1,2],[3,4,5]]);
});

test('every truncated fixture and invalid framing, UTF-8 JSON, padding or external buffer rejects',()=>{
  for (let i=0;i<bytes.length;i++) assert.throws(()=>parseReferenceGlb(bytes.subarray(0,i)),{code:'invalid-reference-glb-import'},`length ${i}`);
  for (const [offset,value] of [[0,0],[4,1],[8,bytes.length+4],[12,3],[16,0]]) {const bad=Buffer.from(bytes);bad.writeUInt32LE(value,offset);assert.throws(()=>parseReferenceGlb(bad),{code:'invalid-reference-glb-import'});}
  const utf=Buffer.from(bytes);utf[20]=255;assert.throws(()=>parseReferenceGlb(utf),/UTF-8 JSON/);
  const badJson=Buffer.from(bytes);badJson[20]=91;assert.throws(()=>parseReferenceGlb(badJson),/UTF-8 JSON/);
  const {g,bin}=unpack();g.buffers[0].byteLength--;bin[bin.length-1]=1;assert.throws(()=>parseReferenceGlb(pack(g,bin)),/padding/);
  for (const uri of ['https://example.invalid/private','data:application/octet-stream;base64,AA==','file:///tmp/source']) assert.throws(()=>parseReferenceGlb(mutate(g=>g.buffers[0].uri=uri)),/buffers are unsupported/);
});

test('accessor bounds, geometry, alignment, indices and buffer declarations fail with bounded errors',()=>{
  const changes=[g=>g.bufferViews[0].byteOffset=1000,g=>g.bufferViews[0].byteLength=1000000,g=>g.bufferViews[0].buffer=1,g=>g.bufferViews[0].byteStride=11,g=>g.bufferViews[0].byteStride=8,g=>g.bufferViews[1].byteStride=4,g=>g.accessors[0].byteOffset=2,g=>g.accessors[0].count=40001,g=>g.accessors[0].componentType=5123,g=>g.accessors[0].type='VEC2',g=>g.accessors[0].normalized=true,g=>g.accessors[0].sparse={},g=>g.accessors[0].bufferView=4,g=>g.accessors[2].componentType=5122,g=>g.accessors[2].count=11,g=>g.accessors[2].count=120001,g=>g.buffers=[],g=>g.buffers[0].byteLength=119];
  for (const change of changes) assert.throws(()=>parseReferenceGlb(mutate(change)),{code:'invalid-reference-glb-import'});
  for (const value of [NaN,Infinity,1e20]) assert.throws(()=>parseReferenceGlb(mutate((g,bin)=>bin.writeFloatLE(value,24))),{code:'invalid-reference-glb-import'});
  for (const value of [4,65535]) assert.throws(()=>parseReferenceGlb(mutate((g,bin)=>bin.writeUInt16LE(value,96))),/indices/);
  assert.throws(()=>parseReferenceGlb(mutate((g,bin)=>bin.writeUInt16LE(0,98))),/degenerate/);
  assert.throws(()=>parseReferenceGlb(mutate(g=>g.nodes[0].translation=[1e8,0,0])),/coordinate/);
});

test('hierarchy cycles, multiple parents, duplicate roots, invalid children and excessive depth reject',()=>{
  const changes=[g=>g.nodes[1].children=[0],g=>g.nodes[0].children=[1,1],g=>g.nodes[2].children=[1],g=>g.scenes[0].nodes=[1],g=>g.scenes[0].nodes=[0,0],g=>g.nodes[0].children=[999],g=>g.nodes[0].children='bad',g=>g.nodes[1].mesh=99,g=>g.scenes[0].nodes=[],g=>g.scene=4,g=>g.nodes[0].name='x'.repeat(201)];
  for (const change of changes) assert.throws(()=>parseReferenceGlb(mutate(change)),{code:'invalid-reference-glb-import'});
  assert.throws(()=>parseReferenceGlb(mutate(g=>{g.nodes=Array.from({length:65},(_,i)=>i===64?{mesh:0}:{children:[i+1]});})),/64 levels/);
  assert.throws(()=>parseReferenceGlb(mutate(g=>{g.nodes=Array.from({length:257},()=>({mesh:0}));})),/nodes/);
});

test('static-subset errors reject unsupported animation skin morph compression and transforms explicitly',()=>{
  const changes=[g=>g.animations=[{}],g=>g.skins=[{}],g=>g.nodes[1].skin=0,g=>g.nodes[1].weights=[],g=>g.meshes[0].weights=[],g=>g.meshes[0].primitives[0].targets=[],g=>g.meshes[0].primitives[0].mode=5,g=>g.meshes[0].primitives[0].attributes.JOINTS_0=1,g=>g.extensionsUsed=['KHR_draco_mesh_compression'],g=>g.extensionsRequired=['KHR_mesh_quantization'],g=>g.meshes[0].primitives[0].extensions={KHR_draco_mesh_compression:{}},g=>g.nodes[0].scale=[0,1,1],g=>g.nodes[0].rotation=[0,0,0,2],g=>g.nodes[0].translation=[1,2],g=>g.nodes[2].translation=[0,0,0],g=>g.nodes[2].matrix[3]=1,g=>g.nodes[2].matrix[4]=1,g=>g.asset.version='1.0'];
  for (const change of changes) assert.throws(()=>parseReferenceGlb(mutate(change)),{code:'invalid-reference-glb-import'});
  const images=mutate(g=>{g.images=[{uri:'https://example.invalid/not-fetched.png'}];g.cameras=[{}];});assert.match(parseReferenceGlb(images).losses.join(' '),/never fetched/);
});

test('source identity, explicit frame/units and exact retained byte source are required',()=>{
  for (const bad of [{...source(),units:'mm'},{...source(),units:undefined},{...source(),text:'glTF'},{...source(),data_base64:bytes.toString('base64')+'\n'},{...source(),data_base64:'AB=='},{...source(),part_ids:['object-1']},{input_format:'obj',units:'mm',text:'',node_ids:[1]}]) assert.throws(()=>importReferenceMesh(bad));
  for (const bad of [null,[],{}, {...input(),url:'https://example.invalid/model'}, {...input(),name:'bad name'}]) assert.throws(()=>importReferenceGlbLayout(bad));
  const changed=mutate(g=>g.asset.generator='changed only metadata'),before=importReferenceGlbLayout(input()),after=importReferenceGlbLayout(input(changed));assert.equal(before.geometry_sha256,after.geometry_sha256);assert.notEqual(before.layout_sha256,after.layout_sha256);
});

test('input byte, total geometry, node count and self-contained layout size bounds remain effective',()=>{
  const {g,bin}=unpack();g.extras={padding:''};let data=pack(g,bin);g.extras.padding='a'.repeat(400000-data.length);data=pack(g,bin);assert.equal(data.length,400000);assert.equal(parseReferenceGlb(data).triangles.length,8);assert.throws(()=>parseReferenceGlb(Buffer.concat([data,Buffer.alloc(4)])),/400000/);
  const many=n=>mutate(g=>{g.nodes=Array.from({length:n},(_,i)=>({name:'same',mesh:0,translation:[i,0,0]}));g.scenes[0].nodes=g.nodes.map((_,i)=>i);});
  assert.equal(importReferenceGlbLayout(input(many(16))).instance_count,16);assert.throws(()=>importReferenceGlbLayout(input(many(17))),/more than 16/);assert.equal(importReferenceGlbLayout({...input(many(17)),node_ids:[16]}).instance_count,1);
  const layout=importReferenceGlbLayout({...input(data),node_ids:[1]}).layout;layout.instances=Array.from({length:4},(_,i)=>({...structuredClone(layout.instances[0]),id:`copy-${i}`}));assert.throws(()=>composeReferenceLayout(layout),/2000000/);
  const dense=mutate(g=>{g.meshes[0].primitives=Array.from({length:256},()=>structuredClone(g.meshes[0].primitives[0]));g.nodes=Array.from({length:40},()=>({mesh:0}));g.scenes[0].nodes=g.nodes.map((_,i)=>i);});assert.throws(()=>parseReferenceGlb(dense),/40000/);
});

test('real CLI imports, selectively converts, edits/reopens and preserves exclusive outputs and invalid-file absence',async()=>{
  const dir=await directory(),cli=new URL('../bin/moonmold-reference-glb-import.mjs',import.meta.url).pathname;
  const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'}),output=path.join(dir,'scene.layout.json');
  const args=['--input',fixture.pathname,'--output',output];assert.equal(run(args).status,0);const saved=await readFile(output,'utf8');assert.equal(JSON.parse(saved).instances.length,2);
  assert.equal(run(args).status,1);assert.equal(await readFile(output,'utf8'),saved);
  const single=run(['--input',fixture.pathname,'--nodes','2','--format','json']);assert.equal(single.status,0,single.stderr);assert.equal(JSON.parse(single.stdout).instance_count,1);
  for (const nodes of ['-1','1,','1.5','0','1,1']) assert.equal(run(['--input',fixture.pathname,'--nodes',nodes]).status,1);
  const bad=path.join(dir,'bad.glb'),missing=path.join(dir,'not-created.json');await writeFile(bad,'not GLB');assert.equal(run(['--input',bad,'--output',missing]).status,1);await assert.rejects(access(missing));
  const meshCli=new URL('../bin/moonmold-reference-mesh.mjs',import.meta.url).pathname;
  const mesh=spawnSync(process.execPath,[meshCli,'--input',fixture.pathname,'--units','m','--nodes','1','--format','source'],{encoding:'utf8'});assert.equal(mesh.status,0,mesh.stderr);const src=path.join(dir,'mesh.source.json');await writeFile(src,mesh.stdout);const reopened=spawnSync(process.execPath,[meshCli,'--source',src],{encoding:'utf8'});assert.equal(reopened.status,0,reopened.stderr);assert.equal(JSON.parse(reopened.stdout).triangle_count,4);
  const layout=JSON.parse(saved);layout.instances[1].transform.translation_mm=[500,0,0];const edited=path.join(dir,'edited.layout.json');await writeFile(edited,JSON.stringify(layout));
  const exporter=new URL('../bin/moonmold-reference-layout.mjs',import.meta.url).pathname;
  for (const format of ['obj','stl','glb']) {const output=path.join(dir,`edited.${format}`),r=spawnSync(process.execPath,[exporter,'--input',edited,'--format',format,'--output',output]);assert.equal(r.status,0,r.stderr.toString());assert.ok((await readFile(output)).length>0);}
});

test('real HTTP imports scene and transformed sources; failed requests remain errors and page is served',async t=>{
  const server=createOperatorServer({workspaceRoot:await directory()});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
  const response=await post('/api/reference-layout/import-glb',input());assert.equal(response.status,200);assert.deepEqual(await response.json(),importReferenceGlbLayout(input()));
  const transformed=await post('/api/reference-mesh/transform',{...source(),node_ids:[2],transform:{translation_mm:[5,0,0]}});assert.equal(transformed.status,200);assert.equal((await transformed.json()).glb_nodes[0].node_index,2);
  for (const body of ['{broken',{...input(),node_ids:[0]},' '.repeat(600001)]) assert.equal((await post('/api/reference-layout/import-glb',body)).status,400);
  const html=await(await fetch(base+'/reference-layout')).text();assert.match(html,/Import GLB mesh nodes/);const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
});

test('production UI appends named nodes, handles repeats/failure atomically, edits and reopens saved original bytes',async()=>{
  const html=await readFile(new URL('../ui/reference-layout/index.html',import.meta.url),'utf8'),elements=new Map(),blobs=new Map(),calls=[],revoked=[];let serial=0,fail=false,hold=null;
  function el(id) {if (!elements.has(id)) elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);}});return elements.get(id);}
  el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});el('preview').width=1000;el('preview').height=400;
  el('glb-file').files=[{name:'scene.glb',size:bytes.length,arrayBuffer:async()=>bytes}];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:el,createElement:()=>({})},Blob,Uint8Array,btoa:binary=>Buffer.from(binary,'binary').toString('base64'),URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});if(hold)await new Promise(resolve=>hold=resolve);if(fail)return{ok:false,json:async()=>({message:'Scene unavailable'})};return{ok:true,json:async()=>url.endsWith('/import-glb')?importReferenceGlbLayout(body):composeReferenceLayout(body)};}});
  const event={preventDefault(){}},saved=async()=>JSON.parse(await blobs.get(el('downloads').children.find(a=>a.download.endsWith('.layout.json')).href).text());
  await el('glb-import-form').handlers.submit(event);let layout=await saved();assert.equal(layout.instances.length,2);assert.equal(layout.instances[1].source.data_base64,bytes.toString('base64'));
  el('tx').value='500';await el('edit-form').handlers.submit(event);layout=await saved();assert.equal(layout.instances[1].transform.translation_mm[0],500);assert.equal(layout.instances[0].transform.translation_mm[0],0);
  await el('glb-import-form').handlers.submit(event);layout=await saved();assert.equal(layout.instances.length,4);assert.equal(new Set(layout.instances.map(i=>i.id)).size,4);assert.ok(revoked.length>0);
  const before=el('downloads').children.map(a=>a.href);fail=true;await el('glb-import-form').handlers.submit(event);assert.deepEqual(el('downloads').children.map(a=>a.href),before);assert.match(el('status').textContent,/Scene unavailable.*unchanged/);fail=false;
  hold=true;const pending=el('glb-import-form').handlers.submit(event);while(typeof hold!=='function')await new Promise(r=>setImmediate(r));const count=calls.length;await el('glb-import-form').handlers.submit(event);assert.equal(calls.length,count);const release=hold;hold=null;release();await pending;assert.equal((await saved()).instances.length,6);
  el('layout-file').files=[{size:JSON.stringify(layout).length,text:async()=>JSON.stringify(layout)}];await el('load-form').handlers.submit(event);assert.deepEqual(await saved(),layout);
  const downloadBefore=el('downloads').children.map(a=>a.href);el('glb-file').files=[{name:'too-large.glb',size:400001}];await el('glb-import-form').handlers.submit(event);assert.deepEqual(el('downloads').children.map(a=>a.href),downloadBefore);assert.match(el('status').textContent,/400000/);
});
