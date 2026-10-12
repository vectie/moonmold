import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const text = await readFile(new URL('../fixtures/reference-tetrahedron.obj', import.meta.url),'utf8');
const transform = JSON.parse(await readFile(new URL('../fixtures/reference-placement.json',import.meta.url),'utf8'));
const input = { text, units:'cm', name:'placed-tetrahedron' };
const near = (actual,expected) => actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-10,`${actual} != ${expected}`));

test('place a scaled and rotated imported reference, retaining original lineage and reusable exports',()=>{
 const original=importReferenceMesh(input), edited=transformReferenceMesh({...input,transform});
 near(edited.bounds.size,[40,80,60]);near(edited.bounds.min,[80,10,0]);near(edited.bounds.max,[120,90,60]);
 assert.equal(edited.source_sha256,original.source_sha256);assert.deepEqual(edited.source_bounds,original.bounds);
 assert.deepEqual(edited.triangles,original.triangles);assert.deepEqual(edited.transform,transform);assert.equal(edited.physical_authority,false);
 const roundtrip=importReferenceMesh({text:edited.exports.obj,units:'mm'});
 assert.deepEqual(roundtrip.vertices,edited.vertices);assert.deepEqual(roundtrip.triangles,original.triangles);
 assert.equal((edited.exports.stl.match(/facet normal/g)||[]).length,4);
 assert.doesNotMatch(edited.exports.stl,/NaN|Infinity/);
 assert.deepEqual(transformReferenceMesh(input).vertices,original.vertices);
 assert.deepEqual(transformReferenceMesh({...input,transform}),edited);
});

test('rotations are right handed X then Y then Z, translation is last',()=>{
 const triangle={text:'v 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3',units:'mm'};
 near(transformReferenceMesh({...triangle,transform:{rotation_deg:[0,0,90]}}).vertices[0],[0,1,0]);
 near(transformReferenceMesh({...triangle,transform:{rotation_deg:[0,90,0]}}).vertices[0],[0,0,-1]);
 near(transformReferenceMesh({...triangle,transform:{rotation_deg:[90,0,0]}}).vertices[1],[0,0,1]);
 near(transformReferenceMesh({...triangle,transform:{rotation_deg:[90,90,90],translation_mm:[3,4,5]}}).vertices[1],[3,5,5]);
});

test('invalid edits fail without accepting mirrored or collapsed geometry',()=>{
 for(const transform of [{scale:0},{scale:-1},{scale:'2'},{rotation_deg:[0,0]},{translation_mm:[0,0,Infinity]},{center_and_ground:1},{unexpected:2},{scale:1e6,translation_mm:[1e9,0,0]}]){
  assert.throws(()=>transformReferenceMesh({...input,transform}),{code:'invalid-reference-transform'});
 }
});

test('CLI applies a saved placement recipe and exports reusable OBJ',()=>{
 const result=spawnSync(process.execPath,[new URL('../bin/moonmold-reference-mesh.mjs',import.meta.url).pathname,'--input',new URL('../fixtures/reference-tetrahedron.obj',import.meta.url).pathname,'--units','cm','--transform',new URL('../fixtures/reference-placement.json',import.meta.url).pathname,'--format','obj'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);near(importReferenceMesh({text:result.stdout,units:'mm'}).bounds.size,[40,80,60]);
});

test('real HTTP edit workflow supports preview source, edit, export and reset',async t=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'moonmold-edit-'));
 const server=createOperatorServer({workspaceRoot:workspace});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(workspace,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=body=>fetch(base+'/api/reference-mesh/transform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const edited=await request({...input,transform});assert.equal(edited.status,200);const mesh=await edited.json();near(mesh.bounds.min,[80,10,0]);
 assert.deepEqual(importReferenceMesh({text:mesh.exports.obj,units:'mm'}).vertices,mesh.vertices);
 const reset=await request(input);assert.equal(reset.status,200);assert.deepEqual((await reset.json()).bounds.size,[20,30,40]);
 const bad=await request({...input,transform:{scale:0}});assert.equal(bad.status,400);
 const html=await (await fetch(base+'/reference-mesh')).text();
 for(const marker of ['<canvas','Apply edits','Reset to original','Set scale to fit','/api/reference-mesh/transform'])assert.ok(html.includes(marker));
 // Parse the served module as JavaScript independently of DOM execution.
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 const parse=spawnSync(process.execPath,['--input-type=module','--check'],{input:script,encoding:'utf8'});assert.equal(parse.status,0,parse.stderr);
});

test('served UI handlers import, apply and reset while downloads follow successful geometry', async()=>{
 const { runInNewContext } = await import('node:vm');
 const html=await readFile(new URL('../ui/reference-mesh/index.html',import.meta.url),'utf8');
 const elements=new Map(), blobs=[];
 function element(id){if(!elements.has(id))elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(a){this.children.push(a);},removeAttribute(name){delete this[name];},setPointerCapture(){}});return elements.get(id);}
 element('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
 element('preview').width=1000;element('preview').height=400;
 element('file').files=[{name:'sample.obj',size:text.length,text:async()=>text}];element('units').value='cm';element('scale').value='1';element('yaw').value='35';element('pitch').value='25';
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
  document:{getElementById:element,querySelector:()=>element('import-button'),createElement:()=>({})},
  Blob,URL:{createObjectURL(blob){blobs.push(blob);return `blob:test-${blobs.length}`;},revokeObjectURL(){}},
  fetch:async(_url,options)=>{try{const result=transformReferenceMesh(JSON.parse(options.body));return {ok:true,json:async()=>result};}catch(error){return {ok:false,json:async()=>({message:error.message})};}}
 });
 const event={preventDefault(){}};
 await element('import-form').handlers.submit(event);
 assert.equal(element('edits').disabled,false);assert.equal(element('downloads').children.length,3);
 element('scale').value='2';element('rx').value='90';element('ground').checked=true;element('tx').value='100';element('ty').value='50';
 element('edit-form').handlers.submit(event);
 // Async handler launches apply; allow its fulfilled request to settle.
 await new Promise(resolve=>setImmediate(resolve));
 near(JSON.parse(await blobs.at(-3).text()).bounds.size,[40,80,60]);
 assert.match(element('downloads').children[1].download,/edited.obj/);
 element('reset').handlers.click();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(await blobs.at(-3).text()).bounds.size,[20,30,40]);
 assert.equal(element('scale').value,'1');assert.equal(element('ground').checked,false);
});
