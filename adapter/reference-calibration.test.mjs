import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { calibrateReferenceLayout } from './reference-calibration.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL('../fixtures/' + name, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-calibration.layout.json'), 'utf8'));
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const vector = (a, b) => a.forEach((n, i) => close(n, b[i]));
function request(layout = seed, a = 0, b = 1, length = 120, id = 'panel') {
  const composed = composeReferenceLayout(layout);
  return { layout: structuredClone(layout), endpoint_a: { instance_id: id, vertex_index: a }, endpoint_b: { instance_id: id, vertex_index: b }, target_distance_mm: length, expected_layout_sha256: composed.layout_sha256, expected_geometry_sha256: composed.geometry_sha256 };
}

test('R405 calibrates the named cm panel from 90 to 120 mm around A and preserves PLY neighbor and original bytes', () => {
  const input = request(), snapshot = structuredClone(input), before = composeReferenceLayout(input.layout);
  const result = calibrateReferenceLayout(input), op = result.calibration;
  assert.deepEqual(input, snapshot);
  assert.equal(op.before_distance_mm, 90); assert.equal(op.after_distance_mm, 120); assert.equal(op.residual_mm, 0);
  assert.equal(op.after_transform.scale, 2); vector(op.after_transform.translation_mm, [90, 35, 5]);
  [[130,-25,5],[130,95,5],[50,95,5],[50,-25,5]].forEach((point,i) => vector(result.vertices[i], point));
  vector(op.anchor_before_mm, [130,-25,5]); vector(op.anchor_after_mm, [130,-25,5]);
  assert.deepEqual(result.parts[1], before.parts[1]); assert.deepEqual(result.layout.instances[1], before.layout.instances[1]);
  assert.deepEqual(result.layout.instances[0].source, before.layout.instances[0].source);
  assert.deepEqual(result.parts[0].selection.part_ids, ['object-1']); assert.deepEqual(result.parts[0].triangle_source_faces, before.parts[0].triangle_source_faces);
  assert.equal(op.source_sha256, before.parts[0].source_sha256); assert.equal(op.parent_layout_sha256, before.layout_sha256);
  assert.equal(op.parent_geometry_sha256, before.geometry_sha256); assert.equal(op.layout_sha256, result.layout_sha256);
  assert.equal(op.geometry_sha256, result.geometry_sha256); assert.equal(op.physical_authority, false);
  assert.match(op.limitations.join(' '), /not a verified physical measurement/);
});

test('R405 non-origin anchors, all-axis rotations, shrink/enlarge and ground modes obey world-pivot scaling', () => {
  for (const ground of [true, false]) for (const rotation of [[0,0,0],[90,0,0],[0,90,0],[0,0,90],[23,-41,67]]) for (const factor of [0.25, 3]) {
    const layout = structuredClone(seed); layout.instances[0].transform = { scale: 1.25, rotation_deg: rotation, center_and_ground: ground, translation_mm: [-130, 70, 11] };
    const before = composeReferenceLayout(layout), anchor = before.vertices[2], distance = Math.hypot(...before.vertices[3].map((n,i) => n-anchor[i]));
    const result = calibrateReferenceLayout(request(layout, 2, 3, distance * factor));
    before.vertices.slice(0,4).forEach((point,i) => vector(result.vertices[i], point.map((n,axis) => anchor[axis] + factor*(n-anchor[axis]))));
    vector(result.vertices[2], anchor); close(result.calibration.after_distance_mm, distance*factor);
    assert.deepEqual(result.layout.instances[0].transform.rotation_deg, rotation);
    assert.equal(result.layout.instances[0].transform.center_and_ground, ground);
    assert.deepEqual(result.parts[1], before.parts[1]);
  }
});

test('R405 binary STL, binary PLY and selected GLB retain byte payloads, units and selection during calibration', async () => {
  const stl = await readFile(fixture('reference-tetrahedron-binary.stl'));
  const glb = await readFile(fixture('reference-scene.glb'));
  const ply = JSON.parse(await readFile(fixture('reference-binary-ply.layout.json'), 'utf8'));
  const sources = [
    { input_format: 'stl', units: 'in', data_base64: stl.toString('base64') },
    ply.instances[0].source,
    { input_format: 'glb', units: 'm', data_base64: glb.toString('base64'), node_ids: [1] },
  ];
  for (const source of sources) {
    const layout = structuredClone(seed); layout.instances[0].source = source;
    const before = composeReferenceLayout(layout), a = before.vertices[0], b = before.vertices[1];
    const distance = Math.hypot(...b.map((n,i)=>n-a[i]));
    const result = calibrateReferenceLayout(request(layout, 0, 1, distance * 2));
    assert.deepEqual(result.layout.instances[0].source, before.layout.instances[0].source);
    assert.equal(result.parts[0].source_sha256, before.parts[0].source_sha256); vector(result.vertices[0], a);
    close(result.calibration.after_distance_mm, distance * 2); assert.deepEqual(result.parts[1], before.parts[1]);
  }
});

test('R405 saved calibration reopens exactly and equal-length request is idempotent without cumulative baking', () => {
  const result = calibrateReferenceLayout(request()), reopened = composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256, result.layout_sha256); assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  const repeated = calibrateReferenceLayout(request(reopened.layout));
  assert.equal(repeated.layout_sha256, result.layout_sha256); assert.equal(repeated.geometry_sha256, result.geometry_sha256);
  assert.equal(repeated.calibration.scale_factor, 1); assert.deepEqual(repeated.layout.instances[0].source, result.layout.instances[0].source);
  const smaller = calibrateReferenceLayout(request(reopened.layout, 0, 1, 60));
  assert.equal(smaller.calibration.after_transform.scale, 1); vector(smaller.calibration.anchor_after_mm, result.calibration.anchor_before_mm);
  assert.equal(smaller.layout.calibration, undefined);
});

test('R405 malformed, cross-instance, coincident, stale, unrepresentable and out-of-range calibration stops before changing input', () => {
  for (const input of [null, [], {}, { ...request(), extra: true }]) assert.throws(() => calibrateReferenceLayout(input));
  for (const target_distance_mm of [null, undefined, '12', -1, 0, NaN, Infinity, 1e10, 1e-300]) assert.throws(() => calibrateReferenceLayout({ ...request(), target_distance_mm }));
  for (const endpoint_b of [null, { instance_id:'stand', vertex_index:0 }, { instance_id:'panel', vertex_index:0 }, { instance_id:'panel', vertex_index:99 }, { instance_id:'panel', vertex_index:1.2 }]) assert.throws(() => calibrateReferenceLayout({ ...request(), endpoint_b }));
  for (const mutate of [input => input.expected_layout_sha256 = '0'.repeat(64), input => input.expected_geometry_sha256 = '0'.repeat(64), input => input.layout.instances[0].source.text += '# revision\n', input => input.layout.instances[0].transform.translation_mm[0]++]) {
    const input = request(); mutate(input); const saved = structuredClone(input); assert.throws(() => calibrateReferenceLayout(input), /Stale endpoint selection/); assert.deepEqual(input, saved);
  }
  const far = structuredClone(seed); far.instances[0].transform.translation_mm = [0, 999999900, 0];
  const input = request(far, 0, 1, 10000), saved = structuredClone(input);
  assert.throws(() => calibrateReferenceLayout(input), /coordinate exceeds/i); assert.deepEqual(input, saved);
});

test('R405 command writes real layout/report/OBJ/STL, reopens, honors identity and keeps every invalid fixture', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moonmold-calibration-cli-'));
  const cli = new URL('../bin/moonmold-reference-calibrate.mjs', import.meta.url).pathname;
  const input = fixture('reference-calibration.layout.json').pathname;
  const args = ['--input',input,'--instance','panel','--a-vertex','0','--b-vertex','1','--length-mm','120'];
  const run = (extra = [], argv = args) => spawnSync(process.execPath, [cli,...argv,...extra], { encoding:'utf8' });
  const result = calibrateReferenceLayout(request());
  for (const format of ['layout','json','obj','stl']) {
    const output = path.join(dir, `calibrated.${format}`), child = run(['--format',format,'--output',output]);
    assert.equal(child.status, 0, child.stderr);
    const text = await readFile(output, 'utf8'); assert.equal(text, format === 'json' ? JSON.stringify(result,null,2)+'\n' : result.exports[format]);
    assert.equal(run(['--format',format,'--output',output]).status, 1); assert.equal(await readFile(output,'utf8'),text);
  }
  const reopened = composeReferenceLayout(JSON.parse(await readFile(path.join(dir,'calibrated.layout'),'utf8')));
  assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  const bound=request(); assert.equal(run(['--expect-layout-sha256',bound.expected_layout_sha256,'--expect-geometry-sha256',bound.expected_geometry_sha256]).status,0);
  for (const extra of [['--format','svg'],['--instance','stand'],['--wrong','1'],['--output'],['--expect-layout-sha256','0'.repeat(64)],['--expect-layout-sha256','0'.repeat(64),'--expect-geometry-sha256',bound.expected_geometry_sha256]]) assert.equal(run(extra).status,1);
  for (const [key, values] of [['--a-vertex',['-1','1.5','1e0','01','9007199254740992']],['--length-mm',['0','-1','NaN','Infinity','0x10']]]) for (const value of values) { const bad=[...args];bad[bad.indexOf(key)+1]=value;assert.equal(run([],bad).status,1); }
  for (const [i, bytes] of [Buffer.from([255]),Buffer.from('{oops'),Buffer.from(' '.repeat(3000001))].entries()) {
    const filename=path.join(dir,`invalid-${i}.json`);await writeFile(filename,bytes,{flag:'wx'});const bad=[...args];bad[1]=filename;assert.equal(run([],bad).status,1);
  }
});

async function serverFor(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moonmold-calibration-http-')), server = createOperatorServer({ workspaceRoot:dir });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve))); return `http://127.0.0.1:${server.address().port}`;
}

test('R405 loopback endpoint returns calibrated editable layout and rejects stale/oversized requests', async t => {
  const base=await serverFor(t), post=body=>fetch(base+'/api/reference-layout/calibrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post(request());assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result,calibrateReferenceLayout(request()));
  const reopen=await fetch(base+'/api/reference-layout/compose',{method:'POST',body:JSON.stringify(result.layout)});assert.equal(reopen.status,200);assert.equal((await reopen.json()).geometry_sha256,result.geometry_sha256);
  for (const body of [{...request(),target_distance_mm:0},{...request(),expected_layout_sha256:'0'.repeat(64)}]) assert.equal((await post(body)).status,400);
  for (const body of ['{',' '.repeat(3000001)]) assert.equal((await fetch(base+'/api/reference-layout/calibrate',{method:'POST',body})).status,400);
  assert.match(await(await fetch(base+'/reference-layout')).text(),/Scale measured instance, keep A fixed/);
});

test('R405 served operator calibrates measurement, gates repeats and edits, retains failures, invalidates old outputs, and reopens', async t => {
  const base=await serverFor(t), html=await(await fetch(base+'/reference-layout')).text();
  const elements=new Map(), blobs=new Map(), revoked=[], calls=[];let serial=0, hold=null, mode='normal';
  function el(id){if(!elements.has(id))elements.set(id,{value:'0',textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);}});return elements.get(id);}
  el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});el('preview').width=1000;el('preview').height=400;
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:el,createElement:()=>({})},Blob,Uint8Array,btoa,URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},fetch:async(route,options)=>{
    calls.push({route,body:JSON.parse(options.body)});if(hold)await new Promise(resolve=>{hold=resolve;});
    if(route.endsWith('/calibrate')&&mode==='fail')return{ok:false,json:async()=>({message:'Synthetic calibration refusal'})};
    const response=await fetch(base+route,options);
    if(route.endsWith('/calibrate')&&mode==='mismatch'){const body=await response.json();body.calibration.target_distance_mm=999;return{ok:true,json:async()=>body};}
    return response;
  }});
  const event={preventDefault(){}},fire=(id,type)=>el(id).handlers[type](event);
  async function load(layout){el('layout-file').files=[{size:3000,text:async()=>JSON.stringify(layout)}];await fire('load-form','submit');}
  async function choose(bId='panel',bIndex='1'){for(const[side,id,index]of[['a','panel','0'],['b',bId,bIndex]]){el(`measure-${side}-instance`).value=id;fire(`measure-${side}-instance`,'change');el(`measure-${side}-vertex`).value=index;fire(`measure-${side}-vertex`,'input');}await fire('measure-form','submit');}
  const saved=async()=>JSON.parse(await blobs.get(el('downloads').children[0].href).text());
  await load(seed);assert.equal(el('calibrate-controls').disabled,true);await choose('stand','0');assert.equal(el('calibrate-controls').disabled,true);await choose('panel','0');assert.equal(el('calibrate-controls').disabled,true);
  await choose();assert.equal(el('calibrate-controls').disabled,false);el('calibrate-length').value='120';
  const initial=el('downloads').children[0].href;
  for(const failure of ['fail','mismatch']){mode=failure;await fire('calibrate-form','submit');assert.equal(el('downloads').children[0].href,initial);assert.equal(el('calibrate-controls').disabled,false);}
  mode='normal';hold=true;const stale=fire('calibrate-form','submit');el('measure-a-vertex').value='2';fire('measure-a-vertex','input');hold();hold=null;await stale;assert.equal(el('downloads').children[0].href,initial);assert.match(el('status').textContent,/selection changed/);
  await choose();el('scale').value='2';fire('scale','input');assert.equal(el('calibrate-controls').disabled,true);const count=calls.length;await fire('calibrate-form','submit');assert.equal(calls.length,count);
  await load(seed);await choose();await fire('drawing-export','click');await fire('glb-export','click');
  const oldMeasurement=el('measure-download').children[0].href;hold=true;const pending=fire('calibrate-form','submit'), sent=calls.length;assert.equal(el('calibrate-controls').disabled,true);await fire('calibrate-form','submit');assert.equal(calls.length,sent);hold();hold=null;await pending;
  const calibrated=await saved();assert.equal(composeReferenceLayout(calibrated).geometry_sha256,calibrateReferenceLayout(request()).geometry_sha256);assert.match(el('status').textContent,/90 → 120 mm/);assert.equal(el('scale').value,'2');
  assert.equal(el('measure-download').children.length,0);assert.ok(revoked.includes(oldMeasurement));assert.equal(el('drawing-download').children.length,0);assert.equal(el('glb-download').children.length,0);assert.equal(el('calibrate-controls').disabled,true);
  await load(calibrated);await choose();const measured=JSON.parse(await blobs.get(el('measure-download').children[0].href).text());assert.equal(measured.distance_mm,120);
  await fire('calibrate-form','submit');assert.equal(composeReferenceLayout(await saved()).geometry_sha256,composeReferenceLayout(calibrated).geometry_sha256);
  await fire('remove','click');assert.equal(el('calibrate-controls').disabled,true);await fire('remove','click');assert.equal(el('calibrate-controls').disabled,true);
});
