import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { cutReferenceLayout, CUT_CONTRACT } from './reference-cut.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { createOperatorServer } from './operator-server.mjs';
const fixture = name => new URL(`../fixtures/${name}`,import.meta.url);
const layout = JSON.parse(await readFile(fixture('reference-cut.layout.json'),'utf8'));
const request = { layout, instance_ids: ['housing','discard'], plane: { axis:'x',position_mm:30,keep:'positive' } };
const cut = (extra={}) => cutReferenceLayout({ ...request,...extra });
const root = process.env.MOONMOLD_CUT_TEST_ROOT ?? path.join(tmpdir(),'moonmold-cut-tests');
await mkdir(root,{recursive:true});
const workdir = () => mkdtemp(path.join(root,'case-'));
const cli = new URL('../bin/moonmold-reference-cut.mjs',import.meta.url).pathname;
const run = args => spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
const args = ['--input',fixture('reference-cut.layout.json').pathname,'--instances','housing,discard','--axis','x','--position-mm','30','--keep','positive'];
const area = mesh => mesh.triangles.reduce((sum,face) => {
 const [a,b,c]=face.map(i=>mesh.vertices[i]),u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
 return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
},0);
const normal = (vertices,face) => { const [a,b,c]=face.map(i=>vertices[i]),u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]); return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]; };
const near = (a,b) => assert.ok(Math.abs(a-b) <= 1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const one = (text,transform={}) => ({contract_id:layout.contract_id,name:'one',instances:[{id:'part',source:{input_format:'obj',units:'mm',text},transform}]});
const triangle = 'v -2 0 0\nv 2 0 0\nv 2 4 0\nf 1 2 3\n';

test('cut a placed housing to reusable open surfaces, preserve fixed instances, remove empty ones and retain exact originals in recipe',()=>{
 const original=structuredClone(request), before=composeReferenceLayout(layout), result=cut();
 assert.deepEqual(request,original);assert.deepEqual(result.layout.instances.map(i=>i.id),['housing','marker']);
 assert.equal(result.triangle_count,15);assert.deepEqual(result.parts[0].bounds,{min:[30,20,5],max:[50,50,25],size:[20,30,20]});
 assert.equal(result.parts[0].triangle_range.count,14);assert.deepEqual(result.layout.instances[1],before.layout.instances[1]);
 assert.deepEqual(result.layout.instances[0].transform,{scale:1,rotation_deg:[0,0,0],center_and_ground:false,translation_mm:[0,0,0]});
 assert.equal(result.layout.instances[0].source.units,'mm');assert.equal(result.cut.parts[1].status,'removed-empty');
 assert.equal(result.cut.parent_layout_sha256,before.layout_sha256);assert.equal(result.cut.parent_geometry_sha256,before.geometry_sha256);
 assert.equal(result.cut.layout_sha256,result.layout_sha256);assert.equal(result.cut.geometry_sha256,result.geometry_sha256);
 const recipe=JSON.parse(result.exports.recipe);assert.equal(recipe.contract_id,CUT_CONTRACT);assert.deepEqual(recipe.layout,before.layout);
 assert.equal(recipe.layout.instances[0].source.text,layout.instances[0].source.text);assert.ok(recipe.layout.instances[0].source.text.includes('\r\n'));
 assert.equal(createHash('sha256').update(recipe.layout.instances[0].source.text).digest('hex'),before.parts[0].source_sha256);
 near(area(result),2606);assert.equal(result.physical_authority,false);assert.equal(result.cut.physical_authority,false);
 assert.match(result.cut.losses.join(' '),/no cut caps/);
});

test('both sides on all axes conserve surface area and child triangle winding with stable parent triangle lineage',()=>{
 const original=one(triangle),before=composeReferenceLayout(original);
 for(const [axis,position_mm] of [['x',0],['y',2],['z',0]]){
  const results=['positive','negative'].map(keep=>cutReferenceLayout({layout:original,instance_ids:['part'],plane:{axis,position_mm,keep}}));
  for(const result of results){
   const mapping=result.cut.parts[0].output_triangle_parent_local_indices;assert.equal(mapping.length,result.triangle_count);
   for(const [i,face] of result.triangles.entries()){
    const a=normal(result.vertices,face),b=normal(before.vertices,before.triangles[mapping[i]]);assert.ok(a.reduce((sum,n,j)=>sum+n*b[j],0)>0);
   }
   const a=['x','y','z'].indexOf(axis);assert.ok(result.vertices.every(p=>result.cut.plane.keep==='positive'?p[a]>=position_mm:p[a]<=position_mm));
  }
  near(area(results[0])+area(results[1]),area(before)*(axis==='z'?2:1));
 }
});

test('world plane evaluates after mixed units, compound rotations and grounding rather than source-space coordinates',()=>{
 const transformed=structuredClone(layout);transformed.instances=[transformed.instances[0]];
 transformed.instances[0].transform={scale:1.5,rotation_deg:[23,-31,47],center_and_ground:true,translation_mm:[100,-20,7]};
 const before=composeReferenceLayout(transformed);
 for(const [a,axis] of ['x','y','z'].entries()){
  const position_mm=(before.bounds.min[a]+before.bounds.max[a])/2;
  const results=['positive','negative'].map(keep=>cutReferenceLayout({layout:transformed,instance_ids:['housing'],plane:{axis,position_mm,keep}}));
  near(area(results[0])+area(results[1]),area(before));
  for(const result of results) assert.ok(result.vertices.every(p=>result.cut.plane.keep==='positive'?p[a]>=position_mm:p[a]<=position_mm));
 }
});

test('shared source edges reuse exact cut vertices while coincident disconnected source vertices remain separate',()=>{
 const text='v -2 0 0\nv 2 0 0\nv 2 4 0\nv -2 4 0\nf 1 2 3\nf 1 3 4\n';
 const result=cutReferenceLayout({layout:one(text),instance_ids:['part'],plane:{axis:'x',position_mm:0,keep:'positive'}});
 assert.equal(result.vertex_count,5);assert.equal(result.triangle_count,3);
 assert.equal(result.vertices.filter(p=>p[0]===0&&p[1]===2).length,1);
 const duplicate=triangle+'v -2 0 0\nv 2 0 0\nv 2 4 0\nf 4 5 6\n';
 const disconnected=cutReferenceLayout({layout:one(duplicate),instance_ids:['part'],plane:{axis:'x',position_mm:0,keep:'positive'}});
 assert.equal(disconnected.vertex_count,8);assert.equal(disconnected.triangle_count,4);
 near(area(disconnected),12);
});

test('inclusive coplanar faces survive, isolated edge or point contacts do not become degenerate geometry, unused vertices drop',()=>{
 const text='v 0 0 0\nv 0 2 0\nv 0 0 3\nv -1 0 0\nv -1 2 0\nv -1 0 3\nv 999 999 999\nf 1 2 3\nf 1 2 4\nf 1 5 6\nf 4 5 6\n';
 const result=cutReferenceLayout({layout:one(text),instance_ids:['part'],plane:{axis:'x',position_mm:0,keep:'positive'}});
 assert.equal(result.triangle_count,1);assert.equal(result.vertex_count,3);assert.equal(result.cut.parts[0].boundary_only_triangles,2);
 assert.equal(result.cut.parts[0].excluded_triangles,1);assert.equal(result.cut.parts[0].unchanged_triangles,1);near(area(result),3);
 assert.deepEqual(result.bounds,{min:[0,0,0],max:[0,2,3],size:[0,2,3]});
 assert.throws(()=>cutReferenceLayout({layout:one(triangle),instance_ids:['part'],plane:{axis:'x',position_mm:2,keep:'positive'}}),/no triangle surfaces/);
});

test('binary STL, binary PLY and GLB originals survive recipe reopen and selected imports remain source-exact',async()=>{
 for(const [name,input_format,units] of [['reference-tetrahedron-binary.stl','stl','in'],['reference-tetrahedron-be.ply','ply','cm'],['reference-scene.glb','glb','m']]){
  const bytes=await readFile(fixture(name)),source={input_format,units,data_base64:bytes.toString('base64')};
  if(input_format==='glb')source.node_ids=[importReferenceMesh(source).glb_nodes[0].node_index];
  const original={contract_id:layout.contract_id,name:'binary',instances:[{id:'binary',source,transform:{rotation_deg:[20,30,40],translation_mm:[10,20,30]}}]};
  const before=composeReferenceLayout(original),position_mm=(before.bounds.min[0]+before.bounds.max[0])/2;
  const result=cutReferenceLayout({layout:original,instance_ids:['binary'],plane:{axis:'x',position_mm,keep:'positive'}}),recipe=JSON.parse(result.exports.recipe);
  assert.deepEqual(Buffer.from(recipe.layout.instances[0].source.data_base64,'base64'),bytes);
  assert.deepEqual(cutReferenceLayout(recipe),result);assert.equal(result.cut.parts[0].source_sha256,createHash('sha256').update(bytes).digest('hex'));
 }
});

test('derived layout save/reopen, OBJ/STL/GLB and drawing remain usable; recipe recut restores source and derivative placements remain editable',()=>{
 const result=cut(),reopened=composeReferenceLayout(JSON.parse(result.exports.layout));
 assert.equal(reopened.layout_sha256,result.layout_sha256);assert.equal(reopened.geometry_sha256,result.geometry_sha256);
 assert.deepEqual(cutReferenceLayout(JSON.parse(result.exports.recipe)),result);
 const obj=importReferenceMesh({input_format:'obj',units:'mm',text:result.exports.obj});assert.deepEqual(obj.vertices,result.vertices);assert.deepEqual(obj.triangles,result.triangles);
 near(area(importReferenceMesh({input_format:'stl',units:'mm',text:result.exports.stl})),area(result));
 assert.match(drawReferenceLayout(reopened.layout).exports.svg,/<svg /);
 const glb=exportReferenceLayoutGlb(reopened.layout);assert.equal(glb.toString('ascii',0,4),'glTF');
 const recipe=JSON.parse(result.exports.recipe);recipe.plane.position_mm=20;const revised=cutReferenceLayout(recipe);assert.equal(revised.parts[0].bounds.min[0],20);
 const moved=structuredClone(reopened.layout);moved.instances[0].transform.translation_mm[2]=10;
 assert.equal(composeReferenceLayout(moved).parts[0].bounds.min[2],15);
});

test('invalid, empty and oversized output selections fail atomically without mutating originals',()=>{
 const original=structuredClone(request);
 for(const instance_ids of [[],['housing','housing'],['missing'],[1],null])assert.throws(()=>cut({instance_ids}),{code:'invalid-reference-cut'});
 for(const plane of [null,{}, {axis:'w',position_mm:0,keep:'positive'},{axis:'x',position_mm:'0',keep:'positive'},{axis:'x',position_mm:NaN,keep:'positive'},{axis:'x',position_mm:1e9+1,keep:'positive'},{axis:'x',position_mm:0,keep:'both'},{...request.plane,script:'no'}])assert.throws(()=>cut({plane}),{code:'invalid-reference-cut'});
 for(const extra of [{contract_id:'wrong'},{url:'no'}])assert.throws(()=>cut(extra),{code:'invalid-reference-cut'});
 assert.throws(()=>cut({layout:{...layout,instances:[layout.instances[0]]},instance_ids:['housing'],plane:{axis:'x',position_mm:500,keep:'positive'}}),/no triangle surfaces/);
 const many=one('v -2 0 0\nv 2 0 0\nv 2 4 0\n'+'f 1 2 3\n'.repeat(21000));
 assert.throws(()=>cutReferenceLayout({layout:many,instance_ids:['part'],plane:{axis:'x',position_mm:0,keep:'positive'}}),/40000/);
 assert.deepEqual(request,original);
});

test('real CLI writes all outputs, reopens recipe, rejects invalid flags, bad UTF8 and overwrite without creating partial files',async()=>{
 const dir=await workdir();
 for(const format of ['layout','recipe','json','obj','stl']){
  const output=path.join(dir,`cut.${format}`),r=run([...args,'--format',format,'--output',output]);assert.equal(r.status,0,r.stderr);
  assert.equal(await readFile(output,'utf8'),format==='json'?JSON.stringify(cut(),null,2)+'\n':cut().exports[format]);
 }
 const recipe=path.join(dir,'cut.recipe');assert.equal(run(['--recipe',recipe]).stdout,cut().exports.layout);
 assert.equal(run([...args,'--output',recipe]).status,1);assert.equal(await readFile(recipe,'utf8'),cut().exports.recipe);
 assert.equal(run(['--recipe',recipe,'--axis','y']).status,1);
 for(const extra of [['--format','glb'],['--keep','negative'],['--script','no'],['--output']])assert.equal(run([...args,...extra]).status,1);
 for(const value of ['NaN','0x10','1e999',''])assert.equal(run([...args.slice(0,6),'--position-mm',value,'--keep','positive']).status,1);
 for(const [name,data] of [['utf8',Buffer.from([255])],['bad','{'],['huge',Buffer.alloc(3100001,32)]]){
  const input=path.join(dir,name),output=input+'.out';await writeFile(input,data);
  assert.equal(run(['--input',input,...args.slice(2),'--output',output]).status,1);await assert.rejects(access(output));
 }
});

test('real loopback cut API returns reproducible geometry and rejects malformed requests; served page script parses',async t=>{
 const server=createOperatorServer({workspaceRoot:await workdir()});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 const send=body=>fetch(base+'/api/reference-layout/cut',{method:'POST',body});
 let response=await send(JSON.stringify(request));assert.equal(response.status,200);assert.deepEqual(await response.json(),cut());
 response=await send(cut().exports.recipe);assert.equal(response.status,200);assert.deepEqual(await response.json(),cut());
 for(const body of ['{}','{',' '.repeat(3100001),JSON.stringify({...request,instance_ids:['missing']})])assert.equal((await send(body)).status,400);
 const html=await(await fetch(base+'/reference-layout')).text();assert.match(html,/Cut chosen surfaces/);assert.match(html,/Restore originals to revise cut/);
 const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
});

test('production UI protects unapplied edits, repeated requests and failures; cut, recipe reopen and restore enable a revised cut',async()=>{
 const html=await readFile(new URL('../ui/reference-layout/index.html',import.meta.url),'utf8');
 const elements=new Map(),blobs=new Map(),revoked=[],calls=[];let serial=0,fail=false,mismatch=false,hold=null;
 function el(id){
  if(!elements.has(id))elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},
   addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},
   get selectedOptions(){return this.children.filter(c=>c.selected);}});
  return elements.get(id);
 }
 el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});el('preview').width=1000;el('preview').height=400;
 el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(layout)}];el('cut-axis').value='x';el('cut-position').value='30';el('cut-keep').value='positive';
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
  document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,TextDecoder,
  URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
  fetch:async(url,options)=>{
   const input=JSON.parse(options.body);calls.push({url,input});
   if(url.endsWith('/cut')){
    if(hold)await new Promise(resolve=>{hold=resolve;});
    if(fail)return{ok:false,json:async()=>({message:'Cut unavailable'})};
    try{const next=cutReferenceLayout(input);if(mismatch)next.cut.parent_layout_sha256='0'.repeat(64);return{ok:true,json:async()=>next};}
    catch(error){return{ok:false,json:async()=>({message:error.message})};}
   }
   if(url.endsWith('/drawing'))return{ok:true,json:async()=>drawReferenceLayout(input)};
   if(url.endsWith('/glb'))return{ok:true,arrayBuffer:async()=>exportReferenceLayoutGlb(input)};
   return{ok:true,json:async()=>composeReferenceLayout(input)};
  }
 });
 const event={preventDefault(){}},submit=()=>el('cut-form').handlers.submit(event);
 const choose=()=>el('cut-targets').children.forEach(c=>c.selected=['housing','discard'].includes(c.value));
 const document=async suffix=>JSON.parse(await blobs.get(el('downloads').children.find(c=>c.download.endsWith(suffix)).href).text());
 await submit();assert.equal(calls.length,0);await el('load-form').handlers.submit(event);choose();
 await el('drawing-export').handlers.click();await el('glb-export').handlers.click();
 const oldLinks=el('downloads').children,drawing=el('drawing-download').children[0].href,glb=el('glb-download').children[0].href;
 for(const mode of ['fail','mismatch']){fail=mode==='fail';mismatch=mode==='mismatch';await submit();assert.equal(el('downloads').children,oldLinks);assert.match(el('status').textContent,/unavailable|does not match/);}
 fail=false;mismatch=false;el('tx').value='11';el('tx').handlers.input();const count=calls.length;
 assert.equal(el('cut-controls').disabled,true);await submit();assert.equal(calls.length,count);
 el('selected').value='housing';el('selected').handlers.change();choose();assert.equal(el('cut-controls').disabled,false);
 hold=true;const pending=submit();await new Promise(resolve=>setImmediate(resolve));const pendingCount=calls.length;
 assert.equal(el('cut-controls').disabled,true);await submit();assert.equal(calls.length,pendingCount);const release=hold;hold=null;release();await pending;
 assert.equal(el('cut-restore').disabled,false);assert.match(el('status').textContent,/Removed empty instances: discard/);
 assert.equal(el('drawing-download').children.length,0);assert.equal(el('glb-download').children.length,0);assert.ok(revoked.includes(drawing));assert.ok(revoked.includes(glb));
 assert.equal(el('measure-a-instance').value,'');const saved=await document('.layout.json'),recipe=await document('.cut.json');
 assert.deepEqual(saved,cut().layout);assert.deepEqual(recipe,JSON.parse(cut().exports.recipe));
 const links=el('downloads').children;el('cut-targets').children.forEach(c=>c.selected=false);const emptyCount=calls.length;
 await submit();assert.equal(calls.length,emptyCount);assert.equal(el('downloads').children,links);
 await el('cut-restore').handlers.click();assert.equal(el('cut-restore').disabled,true);assert.deepEqual(await document('.layout.json'),composeReferenceLayout(layout).layout);
 assert.deepEqual(el('cut-targets').selectedOptions.map(c=>c.value),['housing','discard']);assert.equal(el('cut-position').value,'30');
 el('cut-position').value='20';await submit();assert.equal(composeReferenceLayout(await document('.layout.json')).parts[0].bounds.min[0],20);
 el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(recipe)}];await el('load-form').handlers.submit(event);
 assert.deepEqual(await document('.layout.json'),saved);assert.equal(el('cut-restore').disabled,false);assert.match(el('status').textContent,/recipe reopened/);
 await el('edit-form').handlers.submit(event);assert.equal(el('cut-restore').disabled,true);assert.ok(!el('downloads').children.some(c=>c.download.endsWith('.cut.json')));
 el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(saved)}];await el('load-form').handlers.submit(event);await el('drawing-export').handlers.click();
 assert.equal(await blobs.get(el('drawing-download').children[0].href).text(),drawReferenceLayout(saved).exports.svg);
 while(!el('cut-controls').disabled)await el('remove').handlers.click();
 assert.equal(el('cut-targets').children.length,0);assert.equal(el('cut-restore').disabled,true);assert.equal(el('downloads').children.length,0);
});
