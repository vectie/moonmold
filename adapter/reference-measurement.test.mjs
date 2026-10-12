import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, truncate } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { measureReferenceLayout } from './reference-measurement.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-measurement.layout.json'), 'utf8'));
const panelSeed = JSON.parse(await readFile(fixture('reference-alignment.layout.json'), 'utf8'));
const endpoint = (instance_id, vertex_index) => ({ instance_id, vertex_index });
function request(layout = seed, a = endpoint('triangle', 0), b = endpoint('triangle', 1)) {
  const composed = composeReferenceLayout(layout);
  return { layout: structuredClone(layout), endpoint_a: a, endpoint_b: b, expected_layout_sha256: composed.layout_sha256, expected_geometry_sha256: composed.geometry_sha256 };
}
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
const vector = (a,b) => a.forEach((n,i) => close(n,b[i]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('literal 3-4-5, signed XYZ, reversed, zero and same/cross-instance distances', () => {
  const input = request(), before = structuredClone(input), report = measureReferenceLayout(input);
  assert.deepEqual(input, before);
  assert.deepEqual(report.endpoint_a.coordinates_mm, [0,0,0]);
  assert.deepEqual(report.endpoint_b.coordinates_mm, [3,4,0]);
  assert.deepEqual(report.delta_b_minus_a_mm, {x:3,y:4,z:0}); assert.equal(report.distance_mm,5);
  const reverse = measureReferenceLayout(request(seed, endpoint('triangle',1), endpoint('triangle',0)));
  assert.deepEqual(reverse.delta_b_minus_a_mm,{x:-3,y:-4,z:0}); assert.equal(reverse.distance_mm,5);
  const signed = measureReferenceLayout(request(seed, endpoint('triangle',0), endpoint('triangle',3)));
  assert.deepEqual(signed.delta_b_minus_a_mm,{x:-3,y:-4,z:-12}); assert.equal(signed.distance_mm,13);
  const cross = measureReferenceLayout(request(seed, endpoint('triangle',0), endpoint('translated',0)));
  assert.deepEqual(cross.delta_b_minus_a_mm,{x:3,y:4,z:12}); assert.equal(cross.distance_mm,13);
  assert.equal(cross.endpoint_b.layout_vertex_index,4);
  const zero = measureReferenceLayout(request(seed, endpoint('triangle',1), endpoint('triangle',1)));
  assert.equal(zero.distance_mm,0); assert.deepEqual(zero.delta_b_minus_a_mm,{x:0,y:0,z:0});
  const coincident = structuredClone(seed); coincident.instances[1].transform = {};
  assert.equal(measureReferenceLayout(request(coincident,endpoint('triangle',0),endpoint('translated',0))).distance_mm,0);
  assert.equal(report.physical_authority,false); assert.match(report.qualification,/Not minimum mesh separation/);
  assert.equal(report.units,'mm'); assert.equal(report.endpoint_a.source_sha256,sha(seed.instances[0].source.text));
  assert.equal(report.layout,undefined); assert.equal(report.exports,undefined);
});

test('unit conversion, scale, independent X/Y/Z rotation, translation and grounding use placed coordinates', () => {
  for (const [units,factor] of [['mm',1],['cm',10],['m',1000],['in',25.4]]) {
    const layout = structuredClone(seed); layout.instances = [layout.instances[0]];
    layout.instances[0].source.units = units;
    layout.instances[0].transform = {scale:2,rotation_deg:[0,0,90],translation_mm:[10,-20,30]};
    const report = measureReferenceLayout(request(layout));
    vector(report.endpoint_a.coordinates_mm,[10,-20,30]);
    vector(report.endpoint_b.coordinates_mm,[10-8*factor,-20+6*factor,30]);
    close(report.distance_mm,10*factor); assert.equal(report.endpoint_a.source_units,units);
    assert.deepEqual(report.endpoint_a.transform,composeReferenceLayout(layout).parts[0].transform);
  }
  for (const [rotation_deg, expected] of [[[90,0,0],[3,0,4]],[[0,90,0],[0,4,-3]],[[0,0,90],[-4,3,0]],[[90,90,90],[0,4,-3]]]) {
    const layout = structuredClone(seed); layout.instances[0].transform = {rotation_deg};
    vector(measureReferenceLayout(request(layout)).endpoint_b.coordinates_mm,expected);
  }
  const layout = structuredClone(seed); layout.instances[0].transform = {center_and_ground:true,translation_mm:[10,20,30]};
  const report = measureReferenceLayout(request(layout));
  assert.deepEqual(report.endpoint_a.coordinates_mm,[10,20,42]);
  assert.deepEqual(report.endpoint_b.coordinates_mm,[13,24,42]); assert.equal(report.distance_mm,5);
});

test('selected OBJ local order maps to original source vertices; PLY coordinates and source bytes remain exact', () => {
  const input = request(panelSeed,endpoint('panel',0),endpoint('panel',2)), snapshot = structuredClone(input);
  const report = measureReferenceLayout(input), composed = composeReferenceLayout(panelSeed);
  vector(report.endpoint_a.coordinates_mm,[130,-25,5]); vector(report.endpoint_b.coordinates_mm,[70,65,5]);
  close(report.distance_mm,Math.hypot(60,90)); assert.deepEqual(report.endpoint_a.selection.part_ids,['object-1']);
  assert.equal(report.endpoint_b.source_vertex_index,2); assert.deepEqual(input,snapshot);
  assert.equal(report.endpoint_a.source_sha256,sha(panelSeed.instances[0].source.text));
  const cross = measureReferenceLayout(request(panelSeed,endpoint('panel',0),endpoint('stand',3)));
  vector(cross.endpoint_b.coordinates_mm,[10,20,40]);
  vector(Object.values(cross.delta_b_minus_a_mm),[-120,45,35]); assert.equal(cross.endpoint_b.source_format,'ply');
  assert.equal(cross.endpoint_b.layout_vertex_index,7);
  const saved = JSON.parse(composed.exports.layout); assert.deepEqual(measureReferenceLayout(request(saved,input.endpoint_a,input.endpoint_b)),report);
  const selected = structuredClone(panelSeed); selected.instances[0].source.part_ids = ['object-2'];
  const fresh = measureReferenceLayout(request(selected,endpoint('panel',0),endpoint('panel',2)));
  assert.equal(fresh.endpoint_b.source_vertex_index,4);
});

test('binary STL in inches, repeated triangle vertices and retained unreferenced OBJ vertices are selectable', async () => {
  const bytes = await readFile(fixture('reference-tetrahedron-binary.stl'));
  const layout = structuredClone(seed); layout.instances[0].source = {input_format:'stl',units:'in',data_base64:bytes.toString('base64')};
  const composed = composeReferenceLayout(layout), report = measureReferenceLayout(request(layout));
  assert.equal(report.endpoint_a.source_encoding,'binary'); assert.equal(report.endpoint_a.source_sha256,sha(bytes));
  assert.deepEqual(report.endpoint_b.coordinates_mm,composed.vertices[1]); assert.deepEqual(report.endpoint_a.coordinates_mm,[0,0,0]);
  assert.equal(report.distance_mm,76.19999999999999);
  assert.equal(layout.instances[0].source.data_base64,bytes.toString('base64'));
  assert.equal(measureReferenceLayout(request(seed,endpoint('triangle',0),endpoint('triangle',3))).distance_mm,13);
});

test('stale source/placement/units/selection/name/order hashes reject; explicit new measurements recompute', () => {
  const original = request();
  for (const mutate of [
    input => input.layout.instances[0].source.text += '# changed bytes\n',
    input => input.layout.instances[0].source.units = 'cm',
    input => input.layout.instances[0].transform = {translation_mm:[1,2,3]},
    input => input.layout.instances[0].id = 'renamed',
    input => input.layout.instances.reverse(), input => input.layout.name = 'renamed',
    input => input.expected_geometry_sha256 = '0'.repeat(64), input => input.expected_layout_sha256 = '0'.repeat(64)
  ]) { const input = structuredClone(original); mutate(input); assert.throws(() => measureReferenceLayout(input),/Stale endpoint selection/); }
  const input = request(panelSeed,endpoint('panel',0),endpoint('panel',1)); input.layout.instances[0].source.part_ids = ['object-2'];
  assert.throws(() => measureReferenceLayout(input),/Stale endpoint selection/);
  const moved = structuredClone(seed); moved.instances[1].transform.translation_mm = [6,8,0];
  const fresh = measureReferenceLayout(request(moved,endpoint('triangle',0),endpoint('translated',0)));
  assert.equal(fresh.distance_mm,10); assert.deepEqual(fresh.delta_b_minus_a_mm,{x:6,y:8,z:0});
  assert.notEqual(fresh.layout_sha256,original.expected_layout_sha256);
  assert.deepEqual(seed.instances[1].transform.translation_mm,[3,4,12]);
});

test('strict request shape, indices, hashes and existing layout bounds fail without mutation', () => {
  for (const input of [null,[],{}, {...request(),extra:true}]) assert.throws(() => measureReferenceLayout(input),{code:'invalid-reference-measurement'});
  for (const key of ['endpoint_a','endpoint_b']) for (const value of [null,[],{},endpoint('missing',0),endpoint(1,0),{...endpoint('triangle',0),extra:true},...[-1,4,0.5,NaN,Infinity,'1',null,undefined,Number.MAX_SAFE_INTEGER+1].map(index=>endpoint('triangle',index))]) {
    const input = {...request(),[key]:value}; assert.throws(() => measureReferenceLayout(input),{code:'invalid-reference-measurement'});
  }
  for (const key of ['expected_layout_sha256','expected_geometry_sha256']) for (const value of [undefined,null,1,'abc','G'.repeat(64)]) assert.throws(()=>measureReferenceLayout({...request(),[key]:value}),{code:'invalid-reference-measurement'});
  for (const mutate of [layout=>layout.instances[0].source.units='guess',layout=>layout.instances[0].source.input_format='gltf',layout=>layout.instances[0].transform={translation_mm:[1e10,0,0]}]) {
    const input=request(); mutate(input.layout); const snapshot=structuredClone(input); assert.throws(()=>measureReferenceLayout(input)); assert.deepEqual(input,snapshot);
  }
});

test('reported zero at large coordinates is represented double precision, never an accuracy claim', () => {
  const layout=structuredClone(seed); layout.instances=[layout.instances[0]];
  layout.instances[0].source.text='v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1e-20 0 0\nf 1 2 3\n';
  layout.instances[0].transform={translation_mm:[1e8,0,0]};
  const report=measureReferenceLayout(request(layout,endpoint('triangle',0),endpoint('triangle',3)));
  assert.equal(report.distance_mm,0); assert.equal(report.endpoint_a.coordinates_mm[0],1e8);
  assert.match(report.limitations.join(' '),/IEEE double precision/);
});

test('CLI makes real standalone JSON, supports expected hashes, preserves input, refuses overwrites and bad files/flags', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-measure-cli-'));
  const cli=new URL('../bin/moonmold-reference-measure.mjs',import.meta.url).pathname;
  const input=path.join(dir,'layout.json'), output=path.join(dir,'measurement.json');
  const text=JSON.stringify(seed); await writeFile(input,text);
  const args=['--input',input,'--a-instance','triangle','--a-vertex','0','--b-instance','triangle','--b-vertex','1'];
  const run=(extra=[])=>spawnSync(process.execPath,[cli,...args,...extra],{encoding:'utf8'});
  const stdout=run(); assert.equal(stdout.status,0,stdout.stderr); assert.deepEqual(JSON.parse(stdout.stdout),measureReferenceLayout(request()));
  assert.equal(run(['--output',output]).status,0); assert.equal(await readFile(output,'utf8'),stdout.stdout);
  assert.equal(run(['--output',output]).status,1); assert.equal(await readFile(output,'utf8'),stdout.stdout); assert.equal(await readFile(input,'utf8'),text);
  const binding=request(); assert.equal(run(['--expect-layout-sha256',binding.expected_layout_sha256,'--expect-geometry-sha256',binding.expected_geometry_sha256]).status,0);
  for (const extra of [['--a-vertex','1'],['--wrong','1'],['--output'],['--expect-layout-sha256','0'.repeat(64)],['--expect-layout-sha256','0'.repeat(64),'--expect-geometry-sha256',binding.expected_geometry_sha256]]) assert.equal(run(extra).status,1);
  for (const index of ['-1','1.5','1e0','01','9007199254740992','4']) { const bad=[...args]; bad[5]=index; assert.equal(spawnSync(process.execPath,[cli,...bad]).status,1); }
  const changed=structuredClone(seed); changed.instances[0].transform={scale:2}; await writeFile(input,JSON.stringify(changed));
  assert.equal(run(['--expect-layout-sha256',binding.expected_layout_sha256,'--expect-geometry-sha256',binding.expected_geometry_sha256]).status,1);
  assert.equal(JSON.parse(run().stdout).distance_mm,10);
  for (const bad of [Buffer.from([0xff]),'{oops',JSON.stringify({...seed,extra:true})]) { await writeFile(input,bad); assert.equal(run().status,1); }
  await truncate(input,3_000_001); assert.match(run().stderr,/exceeds 3000000/); // Sparse oversized file tests the stat guard without retaining 3 MB of whitespace.
});

async function serverFor(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'moonmold-measure-http-')), server=createOperatorServer({workspaceRoot:dir});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve))); return `http://127.0.0.1:${server.address().port}`;
}

test('real loopback HTTP returns same bound report, rejects stale and oversized requests, and serves controls', async t => {
  const base=await serverFor(t), post=body=>fetch(base+'/api/reference-layout/measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post(request()); assert.equal(response.status,200); assert.deepEqual(await response.json(),measureReferenceLayout(request()));
  for (const input of [{...request(),endpoint_b:endpoint('triangle',99)},{...request(),expected_layout_sha256:'0'.repeat(64)}]) { const bad=await post(input); assert.equal(bad.status,400); assert.equal((await bad.json()).code,'invalid-reference-measurement'); }
  assert.equal((await fetch(base+'/api/reference-layout/measure',{method:'POST',body:' '.repeat(3_000_001)})).status,400);
  assert.equal((await fetch(base+'/api/reference-layout/measure',{method:'POST',body:'{'})).status,400);
  const html=await(await fetch(base+'/reference-layout')).text(); assert.match(html,/id="measure-form"/); assert.match(html,/zero-based/);
});

test('served UI executes endpoints, overlay, view controls, JSON download, pending edit invalidation and recomputation', async t => {
  const base=await serverFor(t), html=await(await fetch(base+'/reference-layout')).text();
  const elements=new Map(),blobs=new Map(),revoked=[],calls=[],draw=[]; let serial=0,hold=null;
  function el(id) { if (!elements.has(id)) elements.set(id,{value:'0',textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);}}); return elements.get(id); }
  const ctx={clearRect(){draw.length=0;},beginPath(){},moveTo(...p){draw.push(['move',...p,this.strokeStyle]);},lineTo(...p){draw.push(['line',...p,this.strokeStyle]);},stroke(){},fillText(...a){draw.push(['text',...a]);}};
  el('preview').getContext=()=>ctx; el('preview').width=1000;el('preview').height=400;
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:el,createElement:()=>({})},Blob,Uint8Array,btoa,
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async(route,options)=>{calls.push({route,body:JSON.parse(options.body)});if(hold)await new Promise(resolve=>{hold=resolve;});return fetch(base+route,options);}
  });
  const event={preventDefault(){}},fire=(id,type)=>el(id).handlers[type](event);
  async function load(layout){el('layout-file').files=[{size:3000,text:async()=>JSON.stringify(layout)}];await fire('load-form','submit');}
  function choose(a='triangle',ai='0',b='triangle',bi='1') { for(const [side,id,index]of[['a',a,ai],['b',b,bi]]){el(`measure-${side}-instance`).value=id;fire(`measure-${side}-instance`,'change');el(`measure-${side}-vertex`).value=index;fire(`measure-${side}-vertex`,'input');} }
  const report=async()=>JSON.parse(await blobs.get(el('measure-download').children[0].href).text());
  await load(seed); assert.equal(el('measure-controls').disabled,false);assert.equal(el('measure-a-instance').value,'');
  choose();hold=true;const pending=fire('measure-form','submit'),count=calls.length;assert.equal(el('measure-controls').disabled,true);await fire('measure-form','submit');assert.equal(calls.length,count);hold();hold=null;await pending;
  assert.equal((await report()).distance_mm,5);assert.match(el('measure-status').textContent,/Signed B − A: X 3, Y 4, Z 0/);
  assert.ok(draw.some(item=>item[0]==='text'&&item[1]==='A'));assert.ok(draw.some(item=>item[0]==='text'&&item[1]==='B'));assert.ok(draw.some(item=>item[0]==='line'&&item[3]==='#ff80d5'));
  const downloaded=el('measure-download').children[0].href;await fire('top','click');assert.ok(draw.some(item=>item[0]==='text'&&item[1]==='A'));assert.equal(el('measure-download').children[0].href,downloaded);
  const line=draw.find(item=>item[0]==='line'&&item[3]==='#ff80d5'); vector(line.slice(1,3),[542.5,256.6666666666667]);
  const start=draw.find(item=>item[0]==='move'&&item[3]==='#ff80d5'); vector(start.slice(1,3),[457.5,143.33333333333334]);
  const savedLayout=JSON.parse(await blobs.get(el('downloads').children[0].href).text());assert.equal(savedLayout.contract_id,'moonmold.reference-layout.v1');assert.equal(savedLayout.measurement,undefined);
  el('scale').value='2';fire('scale','input');assert.equal(el('measure-download').children.length,0);assert.ok(revoked.includes(downloaded));assert.equal(el('measure-controls').disabled,true);assert.ok(!draw.some(item=>item[0]==='text'&&item[1]==='A'));
  const pre=calls.length;await fire('measure-form','submit');assert.equal(calls.length,pre);
  await fire('edit-form','submit');assert.equal(el('measure-a-instance').value,'');assert.equal(el('measure-a-vertex').value,'');choose();await fire('measure-form','submit');assert.equal((await report()).distance_mm,10);
  el('measure-b-vertex').value='99';fire('measure-b-vertex','input');assert.equal(el('measure-download').children.length,0);await fire('measure-form','submit');assert.match(el('measure-status').textContent,/Measurement unavailable/);assert.equal(el('measure-download').children.length,0);
  choose('triangle','1','triangle','0');await fire('measure-form','submit');assert.deepEqual((await report()).delta_b_minus_a_mm,{x:-6,y:-8,z:0});
  choose('triangle','1','triangle','1');await fire('measure-form','submit');assert.equal((await report()).distance_mm,0);
  choose();hold=true;const racing=fire('measure-form','submit');el('measure-a-vertex').value='2';fire('measure-a-vertex','input');hold();hold=null;await racing;assert.equal(el('measure-download').children.length,0);
  await load(savedLayout);assert.equal(el('measure-download').children.length,0);choose('triangle','0','translated','0');await fire('measure-form','submit');assert.equal((await report()).distance_mm,13);
  await fire('remove','click');assert.equal(el('measure-download').children.length,0);assert.equal(el('measure-a-instance').value,'');
  await fire('remove','click');assert.equal(el('measure-controls').disabled,true);assert.equal(el('measure-download').children.length,0);
});
