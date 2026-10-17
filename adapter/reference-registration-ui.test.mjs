import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { registerReferenceVertices } from './reference-registration.mjs';
import { placeReferenceFace } from './reference-face-placement.mjs';
import { fitReferenceEnvelope } from './reference-envelope-fit.mjs';
import { createOperatorServer } from './operator-server.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-layout.json', import.meta.url), 'utf8'));
layout.instances[0].source.text = await readFile(new URL('../fixtures/reference-tetrahedron.obj', import.meta.url), 'utf8');
const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
// Execute the actual production script and event handlers. DOM and canvas are doubles, not a graphical-browser qualification.
function harness(options={}) {
 const drawing={points:[],labels:[]}, elements=new Map(), blobs=new Map(), calls=[], revoked=[];
 const state={hold:null,fail:false,tamper:null,honorAbort:false};let serial=0;
 function el(id) {
  if(!elements.has(id)) elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},
   addEventListener(type,handler){this.handlers[type]=handler;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},
   get selectedOptions(){return this.children.filter(child=>child.selected);}});
  return elements.get(id);
 }
 el('preview').getContext=()=>({clearRect(){drawing.points=[];drawing.labels=[];},beginPath(){},moveTo(...p){drawing.points.push(p);},lineTo(...p){drawing.points.push(p);},stroke(){},fillText(text){drawing.labels.push(text);}});
 el('preview').width=1000;el('preview').height=400;
 el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(layout)}];
 runInNewContext((options.html??html).match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
  document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,AbortController,
  URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
  fetch:async(url,request)=>{
   const input=JSON.parse(request.body);calls.push({url,input});
   if(options.base)return fetch(options.base+url,request);
   if(url.endsWith('/register-vertices')) {
    if(state.hold)await new Promise((resolve,reject)=>{state.hold=resolve;if(state.honorAbort)request.signal.addEventListener('abort',()=>reject(Error('Aborted')),{once:true});});
    if(state.fail)throw Error('Registration service unavailable');
   }
   try {
    const next=url.endsWith('/register-vertices')?registerReferenceVertices(input):url.endsWith('/place-face')?placeReferenceFace(input):url.endsWith('/fit-envelope')?fitReferenceEnvelope(input):composeReferenceLayout(input);
    if(url.endsWith('/register-vertices')&&state.tamper)state.tamper(next);
    return {ok:true,json:async()=>next};
   }catch(error){return{ok:false,json:async()=>({message:error.message})};}
  },
 });
 const event={preventDefault(){}};
 return{el,blobs,calls,revoked,state,drawing,event,
  open:()=>el('load-form').handlers.submit(event),preview:()=>el('registration-form').handlers.submit(event),click:id=>el(id).handlers.click(),
  choose:()=>{for(const side of ['moving','fixed'])for(let i=1;i<=3;i++){el(`registration-${side}-${i}`).value=String(i-1);el(`registration-${side}-${i}`).handlers.input();}},
  input:(id,value)=>{el(id).value=String(value);el(id).handlers.input();},
  saved:async(suffix='.layout.json',json=true)=>{const link=el('downloads').children.find(link=>link.download.endsWith(suffix));const text=await blobs.get(link.href).text();return json?JSON.parse(text):text;},
 };
}

test('fresh two-file import feeds paired registration and retains both original source files',async()=>{
 const ui=harness();ui.el('source-units').value='mm';
 const sources=['v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3\n','v 8 9 5\nv 8 11 5\nv 5 9 5\nf 1 2 3\n'];
 for(let i=0;i<2;i++){ui.el('mesh-file').files=[{name:`source-${i}.obj`,size:sources[i].length,text:async()=>sources[i]}];await ui.el('add-form').handlers.submit(ui.event);}
 const original=await ui.saved();assert.equal(original.instances.length,2);assert.equal(ui.el('registration-controls').disabled,false);ui.choose();await ui.preview();assert.equal(ui.el('registration-apply').disabled,false);await ui.click('registration-apply');
 const applied=await ui.saved(),report=await ui.saved('.report.json');assert.ok(report.registration.max_residual_mm<1e-12);assert.equal(applied.instances[0].source.text,sources[0]);assert.equal(applied.instances[1].source.text,sources[1]);assert.deepEqual(applied.instances[0],original.instances[0]);assert.notDeepEqual(applied.instances[1].transform,original.instances[1].transform);
});
test('mounted production workflow labels all pairs, previews honest residuals, cancels, applies once and saves editable history',async()=>{
 const ui=harness();await ui.preview();assert.equal(ui.calls.length,0);await ui.open();ui.choose();
 const original=await ui.saved(),obj=await ui.saved('.obj',false),report=await ui.saved('.report.json'),urls=ui.el('downloads').children.map(link=>link.href),oldDrawing=JSON.stringify(ui.drawing.points);
 assert.match(ui.el('registration-selection').textContent,/M1 \[0\]/);assert.match(ui.el('registration-selection').textContent,/F3 \[2\]/);
 for(const label of ['M1','M2','M3','F1','F2','F3'])assert.ok(ui.drawing.labels.includes(label));
 await ui.preview();assert.equal(ui.el('registration-apply').disabled,false);assert.ok(ui.drawing.labels.some(text=>text.includes('REGISTRATION PREVIEW')));assert.notEqual(JSON.stringify(ui.drawing.points),oldDrawing);
 assert.match(ui.el('registration-status').textContent,/Pair 1:.*\nPair 2:.*\nPair 3:.*\nRMS:.*maximum:/);assert.match(ui.el('registration-status').textContent,/Unequal triangles/);
 assert.deepEqual(await ui.saved(),original);assert.equal(await ui.saved('.obj',false),obj);assert.deepEqual(await ui.saved('.report.json'),report);assert.deepEqual(ui.el('downloads').children.map(link=>link.href),urls);
 await ui.click('registration-cancel');assert.equal(ui.el('registration-apply').disabled,true);assert.ok(!ui.drawing.labels.some(text=>text.includes('REGISTRATION PREVIEW')));assert.deepEqual(await ui.saved(),original);
 await ui.preview();await ui.click('registration-apply');const registered=await ui.saved(),appliedReport=await ui.saved('.report.json');assert.notDeepEqual(registered,original);
 assert.deepEqual(registered.instances[0].source,original.instances[0].source);assert.equal(registered.instances[0].transform.scale,original.instances[0].transform.scale);assert.deepEqual(registered.instances.slice(1),original.instances.slice(1));
 assert.ok(appliedReport.registration.max_residual_mm>1);assert.equal(appliedReport.registration.moving.instance_id,original.instances[0].id);assert.equal(appliedReport.registration.fixed.instance_id,original.instances[1].id);
 await ui.click('registration-apply');assert.match(ui.el('history-status').textContent,/1 undo/);await ui.click('layout-undo');assert.deepEqual(await ui.saved(),original);await ui.click('layout-redo');assert.deepEqual(await ui.saved(),registered);
 ui.el('layout-file').files=[{size:5000,text:async()=>JSON.stringify(registered)}];await ui.open();assert.deepEqual(await ui.saved(),registered);assert.equal((await ui.saved('.report.json')).geometry_sha256,appliedReport.geometry_sha256);assert.equal(ui.el('registration-moving-1').value,'');
});
test('pending cancel, vertex and fixed-reference edits invalidate late success and failure while duplicate and conflicting operations stay locked',async()=>{
 for(const interrupt of ['cancel','vertex','fixed'])for(const fail of [false,true]){
  const ui=harness();await ui.open();ui.choose();const original=await ui.saved();ui.state.hold=true;
  const pending=ui.preview(),count=ui.calls.length;assert.equal(ui.el('registration-controls').disabled,true);assert.equal(ui.el('registration-cancel').disabled,false);
  await ui.preview();await ui.click('registration-apply');await ui.click('layout-undo');await ui.el('face-placement-form').handlers.submit(ui.event);await ui.el('fit-envelope-form').handlers.submit(ui.event);assert.equal(ui.calls.length,count);
  if(interrupt==='cancel')await ui.click('registration-cancel');else if(interrupt==='vertex')ui.input('registration-moving-1',1);else{ui.el('registration-fixed').value=layout.instances[2].id;ui.el('registration-fixed').handlers.change();}
  ui.state.fail=fail;const release=ui.state.hold;ui.state.hold=null;release();await pending;
  assert.equal(ui.el('registration-apply').disabled,true);assert.equal(ui.el('registration-controls').disabled,false);assert.deepEqual(await ui.saved(),original);assert.doesNotMatch(ui.el('status').textContent,/unavailable/);
  ui.state.fail=false;ui.choose();await ui.preview();assert.equal(ui.el('registration-apply').disabled,false);
 }
});
test('dirty placement, selected instance, fresh layout and competing face or envelope previews clear registration ownership',async()=>{
 const ui=harness();await ui.open();ui.choose();const original=await ui.saved();await ui.preview();
 ui.input('tx',9);await ui.click('registration-apply');assert.equal(ui.el('registration-controls').disabled,true);assert.deepEqual(await ui.saved(),original);const count=ui.calls.length;await ui.preview();assert.equal(ui.calls.length,count);
 await ui.click('discard-placement');ui.choose();await ui.preview();ui.el('selected').value=layout.instances[1].id;ui.el('selected').handlers.change();assert.equal(ui.el('registration-apply').disabled,true);
 ui.choose();await ui.preview();await ui.el('face-placement-form').handlers.submit(ui.event);assert.equal(ui.el('registration-apply').disabled,true);assert.equal(ui.el('face-placement-apply').disabled,false);
 ui.choose();await ui.preview();assert.equal(ui.el('face-placement-apply').disabled,true);for(const axis of ['x','y','z'])ui.input('fit-envelope-'+axis,1);await ui.el('fit-envelope-form').handlers.submit(ui.event);assert.equal(ui.el('registration-apply').disabled,true);assert.equal(ui.el('fit-envelope-apply').disabled,false);
 ui.choose();await ui.preview();assert.equal(ui.el('fit-envelope-apply').disabled,true);await ui.open();assert.equal(ui.el('registration-apply').disabled,true);assert.deepEqual(await ui.saved(),original);
});
test('invalid choices, server errors and mismatched responses never change the applied downloads',async()=>{
 const ui=harness();await ui.open();ui.choose();const original=await ui.saved();
 const mutations=[
  n=>n.registration.parent_layout_sha256='bad',n=>n.registration.parent_geometry_sha256='bad',n=>n.registration.layout_sha256='bad',n=>n.registration.geometry_sha256='bad',
  n=>n.registration.moving.vertex_indices=[1,2,0],n=>n.registration.fixed.instance_id='wrong',n=>n.registration.residuals[0].before_mm=[77,88,99],n=>n.registration.residuals[0].distance_mm=0,n=>n.registration.rms_residual_mm=0,
  n=>n.layout.instances[0].transform.scale=7,n=>n.layout.instances[0].source.text='wrong',n=>n.layout.instances[1].transform.translation_mm[0]=9,
  n=>n.registration.residuals[0].after_mm=[1,2,3],n=>n.exports.layout=JSON.stringify(original),n=>n.triangles[0]=[0,0,0],n=>n.vertices[0][0]+=1,n=>n.vertices.at(-1)[0]+=1,n=>n.registration.world_rotation[0][0]=-9,
 ];
 for(const mutate of mutations){ui.state.tamper=mutate;await ui.preview();assert.equal(ui.el('registration-apply').disabled,true);assert.match(ui.el('status').textContent,/does not match/);assert.deepEqual(await ui.saved(),original);}
 ui.state.tamper=null;ui.state.fail=true;await ui.preview();assert.match(ui.el('status').textContent,/unavailable/);assert.deepEqual(await ui.saved(),original);ui.state.fail=false;
 for(const value of [-1,'0.1',999,'','NaN',1]){ui.choose();ui.input('registration-moving-1',value);await ui.preview();assert.equal(ui.el('registration-apply').disabled,true);assert.deepEqual(await ui.saved(),original);}
});
test('cancel aborts an active transport and unlocks editing without error or stale apply',async()=>{
 const ui=harness();await ui.open();ui.choose();const original=await ui.saved();ui.state.hold=true;ui.state.honorAbort=true;
 const pending=ui.preview();await ui.click('registration-cancel');await pending;assert.equal(ui.el('edit-controls').disabled,false);assert.equal(ui.el('registration-apply').disabled,true);assert.deepEqual(await ui.saved(),original);assert.doesNotMatch(ui.el('status').textContent,/Aborted/);
});
test('actual served DOM handlers register through the real endpoint, apply, undo, redo and reopen',async t=>{
 const root=process.env.MOONMOLD_TEST_OUTPUT_ROOT||os.tmpdir();await mkdir(root,{recursive:true});const workspace=await mkdtemp(path.join(root,'registration-ui-http-'));
 const server=createOperatorServer({workspaceRoot:workspace});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,page=await(await fetch(base+'/reference-layout')).text(),ui=harness({base,html:page});
 await ui.open();ui.choose();const original=await ui.saved();await ui.preview();assert.equal(ui.el('registration-apply').disabled,false);await ui.click('registration-apply');const changed=await ui.saved();assert.notDeepEqual(changed,original);
 await ui.click('layout-undo');assert.deepEqual(await ui.saved(),original);await ui.click('layout-redo');assert.deepEqual(await ui.saved(),changed);
 ui.el('layout-file').files=[{size:4000,text:async()=>JSON.stringify(changed)}];await ui.open();assert.deepEqual(await ui.saved(),changed);assert.ok(ui.calls.some(call=>call.url==='/api/reference-layout/register-vertices'));
});
