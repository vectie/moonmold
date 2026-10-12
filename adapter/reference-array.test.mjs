import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arrayReferenceLayout } from './reference-array.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { createOperatorServer } from './operator-server.mjs';

const seed = JSON.parse(await readFile(new URL('../fixtures/reference-array-seed.layout.json', import.meta.url), 'utf8'));
const request = () => ({ layout: structuredClone(seed), instance_id: 'panel', counts: [2, 1, 3], pitch_mm: [80, 0, 50] });
const close = (a,b) => a.forEach((n,i) => assert.ok(Math.abs(n-b[i]) < 1e-9, `${a} != ${b}`));

test('array six placed named panels with original lineage and world-axis spacing', () => {
  const input = request(), snapshot = structuredClone(input), result = arrayReferenceLayout(input);
  assert.deepEqual(input, snapshot);
  assert.equal(result.instance_count, 6); assert.equal(result.triangle_count, 12); assert.equal(result.vertex_count, 24);
  close(result.bounds.min, [80,-10,5]); close(result.bounds.max, [200,50,105]);
  assert.deepEqual(result.array.cells.map(c=>c.cell), [[0,0,0],[1,0,0],[0,0,1],[1,0,1],[0,0,2],[1,0,2]]);
  const original = composeReferenceLayout(seed);
  assert.equal(result.array.parent_layout_sha256, original.layout_sha256);
  assert.equal(result.physical_authority, false);
  for (const [i, part] of result.parts.entries()) {
    assert.deepEqual(part.selection.part_ids, ['object-1']);
    assert.equal(part.source_sha256, original.parts[0].source_sha256);
    assert.deepEqual(result.layout.instances[i].source, original.layout.instances[0].source);
    assert.deepEqual(part.triangle_source_faces, original.parts[0].triangle_source_faces);
    for (let v = 0; v < 4; v++) close(result.vertices[i*4+v], original.vertices[v].map((n,a)=>n+result.array.cells[i].offset_mm[a]));
  }
  const reopened = composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256, result.layout_sha256); assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  assert.equal(importReferenceMesh({text:result.exports.obj,units:'mm'}).triangle_count,12);
  assert.equal(importReferenceMesh({input_format:'stl',text:result.exports.stl,units:'mm'}).triangle_count,12);
});

test('save/reopen, independent edits and non-template instances remain independent', () => {
  const input=request(); input.layout.instances.push({...structuredClone(seed.instances[0]),id:'array-1'});
  const result=arrayReferenceLayout(input);
  assert.equal(result.layout.instances[1].id,'array-1'); assert.equal(result.array.cells[1].instance_id,'array-2');
  assert.deepEqual(result.layout.instances.slice(0,2),composeReferenceLayout(input.layout).layout.instances);
  const saved=JSON.parse(result.exports.layout); saved.instances[2].transform.translation_mm[1]+=25;
  const edited=composeReferenceLayout(saved);
  assert.deepEqual(edited.parts[0],result.parts[0]); assert.deepEqual(edited.parts[1],result.parts[1]);
  assert.equal(edited.parts[2].bounds.min[1],result.parts[2].bounds.min[1]+25);
  assert.deepEqual(edited.parts[3],result.parts[3]);
  result.layout.instances[2].source.part_ids.push('mutation');
  assert.deepEqual(result.layout.instances[3].source.part_ids,['object-1']);
});

test('negative pitches, all axes, and 16-instance boundary', () => {
  const input=request(); input.counts=[2,2,2]; input.pitch_mm=[-80,70,-50];
  const result=arrayReferenceLayout(input); assert.equal(result.instance_count,8);
  close(result.parts.at(-1).transform.translation_mm,[20,90,-45]);
  input.counts=[16,1,1]; assert.equal(arrayReferenceLayout(input).instance_count,16);
  input.layout.instances[0].id='a'.repeat(80); input.instance_id='a'.repeat(80);
  assert.equal(arrayReferenceLayout(input).layout.instances.at(-1).id,'array-15');
});

test('repeats binary STL and ASCII PLY without changing source payload or units', async () => {
  const binary=await readFile(new URL('../fixtures/reference-tetrahedron-binary.stl',import.meta.url));
  const sources=[{input_format:'stl',units:'in',data_base64:binary.toString('base64')},
    {input_format:'ply',units:'m',text:'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n'}];
  for(const source of sources){const input=request();input.layout.instances[0].source=source;input.counts=[2,1,1];const r=arrayReferenceLayout(input);assert.equal(r.parts[0].source_sha256,r.parts[1].source_sha256);assert.deepEqual(r.layout.instances[0].source,r.layout.instances[1].source);}
});

test('rejects invalid arrays atomically including coordinate and expanded source limits', () => {
  for(const counts of [null,[],[1,1,1],[0,1,2],[2.5,1,1],[17,1,1],[16,2,1],[2,1,1,1]]) assert.throws(()=>arrayReferenceLayout({...request(),counts}));
  for(const pitch_mm of [null,[],[0,0,50],[NaN,0,50],[Infinity,0,50],['80',0,50],[1e10,0,50]]) assert.throws(()=>arrayReferenceLayout({...request(),pitch_mm}));
  assert.throws(()=>arrayReferenceLayout({...request(),instance_id:'missing'}),/existing/);
  assert.throws(()=>arrayReferenceLayout({...request(),unexpected:true}),/Expected/);
  const input=request();input.pitch_mm=[1e9,0,50]; assert.throws(()=>arrayReferenceLayout(input),/coordinate exceeds/);
  input.pitch_mm=[80,0,50]; input.layout.instances[0].source.text += '#'+ 'x'.repeat(350000); assert.throws(()=>arrayReferenceLayout(input),/2000000/);
  const unchanged=structuredClone(seed);assert.deepEqual(seed,unchanged);
});

test('combined triangle budget still applies to a valid repeated source', () => {
  const input=request(); input.layout.instances[0].source={input_format:'obj',units:'mm',text:'v 0 0 0\nv 1 0 0\nv 0 1 0\n'+'f 1 2 3\n'.repeat(7000)};
  assert.equal(composeReferenceLayout(input.layout).triangle_count,7000);
  assert.throws(()=>arrayReferenceLayout(input),/40000/);
});

test('CLI emits portable layout by default, real exports, and refuses overwrite and bad flags', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-array-cli-'));
  const cli=new URL('../bin/moonmold-reference-array.mjs',import.meta.url).pathname;
  const input=new URL('../fixtures/reference-array-seed.layout.json',import.meta.url).pathname;
  const args=['--input',input,'--instance','panel','--counts','2,1,3','--pitch-mm','80,0,50'];
  const run=extra=>spawnSync(process.execPath,[cli,...args,...extra],{encoding:'utf8'});
  const result=run([]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).instances.length,6);
  for(const format of ['layout','json','obj','stl']){const output=path.join(dir,`out.${format}`);const r=run(['--format',format,'--output',output]);assert.equal(r.status,0,r.stderr);const contents=await readFile(output,'utf8');assert.ok(contents.length>100);assert.equal(run(['--format',format,'--output',output]).status,1);assert.equal(await readFile(output,'utf8'),contents);}
  for(const extra of [['--format','svg'],['--counts','2,1,1'],['--wrong','x']]) assert.equal(run(extra).status,1);
  const bad=path.join(dir,'bad.json');await writeFile(bad,Buffer.from([0xff]));const r=spawnSync(process.execPath,[cli,'--input',bad,'--instance','panel','--counts','2,1,1','--pitch-mm','20,0,0'],{encoding:'utf8'});assert.equal(r.status,1);
});

async function serverFor(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-array-http-'));
  const server=createOperatorServer({workspaceRoot:dir});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP array output reopens through existing compose endpoint; invalid requests are 400',async t=>{
  const base=await serverFor(t);
  const send=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await send('/api/reference-layout/array',request());assert.equal(response.status,200);
  const result=await response.json();assert.deepEqual(result,arrayReferenceLayout(request()));
  const reopened=await send('/api/reference-layout/compose',result.layout);assert.equal((await reopened.json()).geometry_sha256,result.geometry_sha256);
  for(const body of [null,{}, {...request(),counts:[99,1,1]}]) assert.equal((await send('/api/reference-layout/array',body)).status,400);
});

test('served UI creates array, edits copy, saves/reopens, and keeps output on errors and repeated clicks',async t=>{
  const base=await serverFor(t), html=await(await fetch(base+'/reference-layout')).text();
  const elements=new Map(),blobs=new Map(),calls=[];let serial=0,hold=null;
  function el(id){if(!elements.has(id))elements.set(id,{value:'0',textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);}});return elements.get(id);}
  el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
  el('preview').width=1000;el('preview').height=400;
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:el,createElement:()=>({})},Blob,Uint8Array,btoa,
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(){}},
    fetch:async(route,options)=>{calls.push({route,body:JSON.parse(options.body)});if(hold)await new Promise(resolve=>{hold=resolve;});return fetch(base+route,options);}
  });
  const event={preventDefault(){}},saved=async()=>JSON.parse(await blobs.get(el('downloads').children[0].href).text());
  el('layout-file').files=[{size:1000,text:async()=>JSON.stringify(seed)}];await el('load-form').handlers.submit(event);assert.equal(el('array-controls').disabled,false);
  ['count-x','count-y','count-z'].forEach((id,i)=>el(id).value=String([2,1,3][i]));
  ['array-x','array-y','array-z'].forEach((id,i)=>el(id).value=String([80,0,50][i]));
  el('tx').value='999'; // unapplied edits must not leak into array
  hold=true;const pending=el('array-form').handlers.submit(event);const n=calls.length;
  await el('array-form').handlers.submit(event);assert.equal(calls.length,n);assert.equal(el('array-controls').disabled,true);hold();hold=null;await pending;
  const array=await saved();assert.equal(array.instances.length,6);assert.deepEqual(array.instances[0].transform.translation_mm,[100,20,5]);assert.equal(el('selected').value,'array-5');
  el('ty').value='70';await el('edit-form').handlers.submit(event);const edited=await saved();assert.equal(edited.instances[5].transform.translation_mm[1],70);assert.deepEqual(edited.instances[0],array.instances[0]);
  const old=el('downloads').children[0].href;el('count-x').value='16';await el('array-form').handlers.submit(event);assert.equal(el('downloads').children[0].href,old);assert.match(el('status').textContent,/unchanged/);
  el('layout-file').files=[{size:10000,text:async()=>JSON.stringify(edited)}];await el('load-form').handlers.submit(event);assert.deepEqual(await saved(),edited);
  el('count-x').value='';await el('array-form').handlers.submit(event);assert.match(el('status').textContent,/Enter all/);
});
