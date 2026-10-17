import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { measureReferenceAngle } from './reference-angle.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const seed = { contract_id:'moonmold.reference-layout.v1', name:'three-point-review', instances:[
 {id:'arms', source:{input_format:'obj',units:'mm',name:'orthogonal-arms',text:'v 1 0 0\nv 0 0 0\nv 0 1 0\nv -1 0 0\nv 0 0 1\nf 1 2 3\n'},transform:{}},
 {id:'other', source:{input_format:'obj',units:'mm',text:'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'},transform:{translation_mm:[0,0,3]}}
] };
const ep = (vertex_index, instance_id='arms') => ({instance_id,vertex_index});
const request = (layout=seed, a=ep(0), b=ep(1), c=ep(2)) => {const composed=composeReferenceLayout(layout);return {layout:structuredClone(layout),endpoint_a:a,vertex_b:b,endpoint_c:c,expected_layout_sha256:composed.layout_sha256,expected_geometry_sha256:composed.geometry_sha256};};
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('right, acute, obtuse, collinear, reversed and cross-instance 3D arms retain exact provenance', () => {
 const input=request(),before=structuredClone(input),report=measureReferenceAngle(input);
 assert.deepEqual(input,before);assert.equal(report.angle_abc_degrees,90);assert.deepEqual(report.vertex_b.coordinates_mm,[0,0,0]);
 assert.equal(report.arm_ba_length_mm,1);assert.equal(report.arm_bc_length_mm,1);assert.equal(report.physical_authority,false);assert.match(report.qualification,/not a dihedral/);
 assert.equal(measureReferenceAngle(request(seed,ep(2),ep(1),ep(0))).angle_abc_degrees,90);
 assert.equal(measureReferenceAngle(request(seed,ep(0),ep(1),ep(0))).angle_abc_degrees,0);
 assert.equal(measureReferenceAngle(request(seed,ep(0),ep(1),ep(3))).angle_abc_degrees,180);
 assert.equal(measureReferenceAngle(request(seed,ep(0),ep(1),ep(0,'other'))).angle_abc_degrees,90);
 for(const [x,y,expected] of [[1,1,45],[-1,1,135],[1,1e-12,Math.atan2(1e-12,1)*180/Math.PI]]) {const layout=structuredClone(seed);layout.instances[0].source.text+=`v ${x} ${y} 0\n`;close(measureReferenceAngle(request(layout,ep(0),ep(1),ep(5))).angle_abc_degrees,expected);}
 assert.equal(report.endpoint_a.source_sha256,composeReferenceLayout(seed).parts[0].source_sha256);assert.match(report.limitations.join(' '),/IEEE double precision/);
});
test('shared placed extraction honors units, rotation, scale, grounding and part-selected local order', async () => {
 for(const units of ['mm','cm','m','in']) {const layout=structuredClone(seed);layout.instances[0].source.units=units;layout.instances[0].transform={scale:2,rotation_deg:[35,20,91],translation_mm:[100,-30,4],center_and_ground:true};const composed=composeReferenceLayout(layout),report=measureReferenceAngle(request(layout));close(report.angle_abc_degrees,90);assert.deepEqual(report.endpoint_a.coordinates_mm,composed.vertices[0]);assert.deepEqual(report.endpoint_c.transform,composed.parts[0].transform);}
 const selected=JSON.parse(await readFile(new URL('../fixtures/reference-alignment.layout.json',import.meta.url),'utf8'));
 const report=measureReferenceAngle(request(selected,ep(0,'panel'),ep(1,'panel'),ep(2,'panel')));close(report.angle_abc_degrees,90);assert.equal(report.endpoint_c.source_vertex_index,2);assert.deepEqual(report.endpoint_a.selection.part_ids,['object-1']);
 const saved=JSON.parse(composeReferenceLayout(selected).exports.layout);assert.deepEqual(measureReferenceAngle(request(saved,ep(0,'panel'),ep(1,'panel'),ep(2,'panel'))),report);
});
test('zero represented arms, invalid selectors, stale revisions and arbitrary fields fail without mutation', () => {
 for(const input of [request(seed,ep(1)),request(seed,ep(0),ep(1),ep(1)),{...request(),execute:'shell'},null,[],{}]) assert.throws(()=>measureReferenceAngle(input));
 for(const key of ['endpoint_a','vertex_b','endpoint_c']) for(const value of [ep(-1),ep(99),ep(0.5),ep('1'),ep(0,'missing'),{...ep(0),unknown:true},null]) assert.throws(()=>measureReferenceAngle({...request(),[key]:value}));
 for(const key of ['expected_layout_sha256','expected_geometry_sha256']) for(const value of [undefined,'no','0'.repeat(64)]) assert.throws(()=>measureReferenceAngle({...request(),[key]:value}));
 for(const mutate of [i=>i.layout.instances[0].transform={translation_mm:[1,0,0]},i=>i.layout.instances[0].source.text+='# changed\n',i=>i.layout.instances[0].source.units='cm',i=>i.layout.instances.reverse(),i=>i.layout.name='new']) {const input=request();mutate(input);const before=structuredClone(input);assert.throws(()=>measureReferenceAngle(input),/Stale angle/);assert.deepEqual(input,before);}
 const coincident=structuredClone(seed);coincident.instances[1].transform={};assert.throws(()=>measureReferenceAngle(request(coincident,ep(0),ep(1),ep(0,'other'))),/nonzero/);
 const precision=structuredClone(seed);precision.instances[0].source.text+='v 1e-20 0 0\n';precision.instances[0].transform={translation_mm:[1e8,0,0]};assert.throws(()=>measureReferenceAngle(request(precision,ep(5))),/nonzero/);
});
async function serve(t) {const dir=await mkdtemp(path.join(tmpdir(),'moonmold-angle-'));const server=createOperatorServer({workspaceRoot:dir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}
test('production loopback endpoint serves bound angle, strict errors and bounded bodies',async t=>{const base=await serve(t);const post=body=>fetch(base+'/api/reference-layout/angle',{method:'POST',body:JSON.stringify(body)});const response=await post(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),measureReferenceAngle(request()));assert.equal((await post({...request(),expected_layout_sha256:'0'.repeat(64)})).status,400);assert.equal((await fetch(base+'/api/reference-layout/angle',{method:'POST',body:' '.repeat(3_000_001)})).status,400);const html=await(await fetch(base+'/reference-layout')).text();assert.match(html,/id="angle-form"/);assert.match(html,/canvas is a projection/);});

async function harness(t) {
 const base=await serve(t),html=await(await fetch(base+'/reference-layout')).text(),elements=new Map(),blobs=new Map(),revoked=[],calls=[],draw=[];let serial=0,hold=null,mismatch=false;
 function el(id){if(!elements.has(id))elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},addEventListener(k,v){this.handlers[k]=v;},replaceChildren(){this.children=[];},append(...a){this.children.push(...a);},removeAttribute(k){delete this[k];},get selectedOptions(){return this.children.filter(c=>c.selected);}});return elements.get(id);}
 const ctx={clearRect(){draw.length=0;},beginPath(){},moveTo(...p){draw.push(['move',...p,this.strokeStyle]);},lineTo(...p){draw.push(['line',...p,this.strokeStyle]);},stroke(){},fillText(...p){draw.push(['text',...p]);}};
 el('preview').getContext=()=>ctx;el('preview').width=1000;el('preview').height=400;
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:el,createElement:()=>({})},Blob,URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});const response=await fetch(base+url,options);if(url.endsWith('/angle')){if(hold)await new Promise(resolve=>hold=resolve);if(mismatch){const report=await response.json();report.endpoint_c.vertex_index=99;return {ok:true,json:async()=>report};}}return response;}});
 const fire=(id,type='click')=>el(id).handlers[type]({preventDefault(){}});
 const load=async layout=>{el('layout-file').files=[{size:5000,text:async()=>JSON.stringify(layout??seed)}];await fire('load-form','submit');};
 const choose=(side,index,instance='arms')=>{el(`angle-${side}-instance`).value=instance;fire(`angle-${side}-instance`,'change');el(`angle-${side}-vertex`).value=String(index);fire(`angle-${side}-vertex`,'input');};
 return {el,blobs,revoked,calls,draw,fire,load,choose,select(){choose('a',0);choose('b',1);choose('c',2);},measure:()=>fire('angle-form','submit'),hold(){hold=true;},isHeld(){return typeof hold==='function';},release(){const resolve=hold;hold=null;resolve();},mismatch(v){mismatch=v;}};
}
test('served production handlers preview true placed XYZ and both arms, download exact report, retain independent distance workflow',async t=>{
 const h=await harness(t);await h.load();h.select();assert.match(h.el('angle-selection').textContent,/B \(angle vertex\) arms\[1\]: 0, 0, 0 mm/);assert.ok(h.draw.some(row=>row[1]==='Angle B (vertex)'));assert.equal(h.draw.filter(row=>row[0]==='line'&&row.at(-1)==='#a5ed90').length,6);
 await h.measure();assert.match(h.el('angle-status').textContent,/90 degrees/);assert.equal(h.el('angle-download').children.length,1);assert.deepEqual(JSON.parse(await h.blobs.get(h.el('angle-download').children[0].href).text()),measureReferenceAngle(request()));assert.ok(h.draw.some(row=>row[1]==='ABC at B: 90° (3D)'));
 h.el('yaw').value='80';h.fire('yaw','input');assert.ok(h.draw.some(row=>row[1]==='ABC at B: 90° (3D)'));
 for(const [side,index] of [['a',0],['b',1]]){h.el(`measure-${side}-instance`).value='arms';h.el(`measure-${side}-vertex`).value=String(index);}await h.fire('measure-form','submit');assert.match(h.el('measure-status').textContent,/Euclidean distance: 1 mm/);assert.equal(h.el('angle-download').children.length,1);
});
test('placement edits, apply, undo/redo, empty layouts and reopen revoke reports and require fresh selections',async t=>{
 const h=await harness(t);await h.load();h.select();await h.measure();const link=h.el('angle-download').children[0].href;h.el('tx').value='3';h.fire('tx','input');assert.ok(h.revoked.includes(link));assert.equal(h.el('angle-controls').disabled,true);assert.equal(h.el('angle-a-instance').value,'');assert.equal(h.el('angle-download').children.length,0);const count=h.calls.length;await h.measure();assert.equal(h.calls.length,count);
 await h.fire('edit-form','submit');assert.equal(h.el('angle-controls').disabled,false);h.select();await h.measure();assert.match(h.el('angle-selection').textContent,/A arms\[0\]: 4, 0, 0 mm/);await h.fire('layout-undo');assert.equal(h.el('angle-download').children.length,0);assert.equal(h.el('angle-b-instance').value,'');await h.fire('layout-redo');assert.equal(h.el('angle-c-instance').value,'');
 const single={...structuredClone(seed),instances:[structuredClone(seed.instances[0])]};await h.load(single);h.select();await h.measure();await h.fire('remove');assert.equal(h.el('angle-download').children.length,0);assert.equal(h.el('angle-controls').disabled,true);await h.fire('layout-undo');assert.equal(h.el('angle-a-instance').value,'');
});
test('repeated submits, interrupted selection, same-identity mismatched responses and invalid arms cannot publish stale evidence',async t=>{
 const h=await harness(t);await h.load();h.select();h.hold();const pending=h.measure();while(h.calls.at(-1)?.url!='/api/reference-layout/angle')await new Promise(resolve=>setImmediate(resolve));const count=h.calls.length;await h.measure();assert.equal(h.calls.length,count);h.choose('c',4);while(!h.isHeld())await new Promise(resolve=>setImmediate(resolve));h.release();await pending;assert.equal(h.el('angle-download').children.length,0);
 h.select();h.mismatch(true);await h.measure();assert.match(h.el('angle-status').textContent,/does not match/);assert.equal(h.el('angle-download').children.length,0);h.mismatch(false);h.choose('a',1);await h.measure();assert.match(h.el('angle-status').textContent,/nonzero/);h.choose('a',0);await h.measure();assert.equal(h.el('angle-download').children.length,1);const link=h.el('angle-download').children[0].href;h.choose('a',99);assert.ok(h.revoked.includes(link));await h.measure();assert.match(h.el('angle-status').textContent,/zero-based/);
});
