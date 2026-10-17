import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arrayReferencePath } from './reference-path-array.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';
const seed=JSON.parse(await readFile(new URL('../fixtures/reference-array-seed.layout.json',import.meta.url),'utf8'));
const request=()=>({layout:structuredClone(seed),instance_id:'panel',count:5,points_mm:[[0,0,0],[30,0,0],[30,0,70]]});
const close=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-8));
test('unequal 3D segments use equal arc length and preserve editable source transforms',()=>{
 const input=request(), copy=structuredClone(input), r=arrayReferencePath(input), before=composeReferenceLayout(seed);
 assert.deepEqual(input,copy);assert.equal(r.instance_count,5);assert.equal(r.path_array.spacing_mm,25);
 const expected=[[0,0,0],[25,0,0],[30,0,20],[30,0,45],[30,0,70]];
 r.layout.instances.forEach((item,i)=>{close(item.transform.translation_mm,expected[i]);assert.deepEqual(item.source,before.layout.instances[0].source);assert.deepEqual(item.transform.rotation_deg,before.layout.instances[0].transform.rotation_deg);assert.deepEqual(item.transform.scale,before.layout.instances[0].transform.scale);assert.equal(r.parts[i].source_sha256,before.parts[0].source_sha256);});
 assert.equal(r.physical_authority,false);assert.equal(composeReferenceLayout(JSON.parse(r.exports.layout)).geometry_sha256,r.geometry_sha256);
 const edited=JSON.parse(r.exports.layout);edited.instances[2].transform.translation_mm[0]+=9;assert.deepEqual(composeReferenceLayout(edited).parts[3],r.parts[3]);
});
test('corners, negative coordinates, id collisions and unrelated instances',()=>{
 const q=request();q.layout.instances.push({...structuredClone(seed.instances[0]),id:'path-1'});q.points_mm=[[0,0,0],[-10,0,0],[-10,-10,0]];q.count=3;
 const r=arrayReferencePath(q);assert.deepEqual(r.layout.instances[1],composeReferenceLayout(q.layout).layout.instances[1]);assert.equal(r.path_array.samples[1].instance_id,'path-2');close(r.path_array.samples[1].origin_mm,[-10,0,0]);
 assert.equal(arrayReferencePath({...request(),count:16}).instance_count,16);
});
test('invalid paths and excessive output rejected without mutation',()=>{
 for(const change of [{count:1},{count:17},{count:2.5},{points_mm:[[0,0,0],[0,0,0]]},{points_mm:[[0,0,0],[NaN,0,0]]},{points_mm:[[0,0,0],['1',0,0]]},{instance_id:'missing'},{extra:1}]) assert.throws(()=>arrayReferencePath({...request(),...change}));
 const q=request();q.count=16;q.layout.instances.push({...structuredClone(seed.instances[0]),id:'other'});assert.throws(()=>arrayReferencePath(q),/16 instances/);
});
test('CLI produces saved editable path layout and refuses overwriting',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-path-array-cli-'));
 const cli=new URL('../bin/moonmold-reference-path-array.mjs',import.meta.url).pathname;
 const args=[cli,'--input',new URL('../fixtures/reference-array-seed.layout.json',import.meta.url).pathname,'--instance','panel','--count','5','--points-mm','0,0,0;30,0,0;30,0,70'];
 const run=extra=>spawnSync(process.execPath,[...args,...extra],{encoding:'utf8'});
 const r=run([]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).instances.length,5);
 const file=path.join(dir,'placed.json');assert.equal(run(['--output',file]).status,0);assert.equal(run(['--output',file]).status,1);
 assert.equal(run(['--count','6']).status,1);
});
async function serverFor(t){const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-path-array-http-'));const server=createOperatorServer({workspaceRoot:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}
test('actual HTTP route returns editable geometry and rejects bad requests',async t=>{
 const base=await serverFor(t),send=body=>fetch(base+'/api/reference-layout/path-array',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const r=await send(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),arrayReferencePath(request()));assert.equal((await send({...request(),count:0})).status,400);
});
test('served UI applies path, saves/reopens, and keeps prior layout on invalid input',async t=>{
 const base=await serverFor(t),html=await(await fetch(base+'/reference-layout')).text(),elements=new Map(),blobs=new Map();let serial=0;
 function el(id){if(!elements.has(id))elements.set(id,{value:'0',textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);}});return elements.get(id);}
 el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});el('preview').width=1000;el('preview').height=400;
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:el,createElement:()=>({})},Blob,Uint8Array,btoa,URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(){}},fetch:(route,options)=>fetch(base+route,options)});
 const event={preventDefault(){}},saved=async()=>JSON.parse(await blobs.get(el('downloads').children[0].href).text());
 el('layout-file').files=[{size:1000,text:async()=>JSON.stringify(seed)}];await el('load-form').handlers.submit(event);assert.equal(el('path-array-controls').disabled,false);
 el('path-array-count').value='5';el('path-array-points').value=JSON.stringify(request().points_mm);await el('path-array-form').handlers.submit(event);
 const result=await saved();assert.equal(result.instances.length,5);assert.deepEqual(result.instances.at(-1).transform.translation_mm,[30,0,70]);
 const old=el('downloads').children[0].href;el('path-array-points').value='invalid';await el('path-array-form').handlers.submit(event);assert.equal(el('downloads').children[0].href,old);
 el('layout-file').files=[{size:10000,text:async()=>JSON.stringify(result)}];await el('load-form').handlers.submit(event);assert.deepEqual(await saved(),result);
});
