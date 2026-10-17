import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { placeReferenceFace } from './reference-face-placement.mjs';
import { fitReferenceEnvelope } from './reference-envelope-fit.mjs';
import { createOperatorServer } from './operator-server.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-layout.json', import.meta.url), 'utf8'));
layout.instances[0].source.text = await readFile(new URL('../fixtures/reference-tetrahedron.obj', import.meta.url), 'utf8');
const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
// Execute the actual production script, following the envelope-fit UI harness
// contract. DOM and canvas are doubles, not a graphical-browser qualification.
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
   if(url.endsWith('/place-face')) {
    if(state.hold)await new Promise((resolve,reject)=>{state.hold=resolve;if(state.honorAbort)request.signal.addEventListener('abort',()=>reject(Error('Aborted')),{once:true});});
    if(state.fail)throw Error('Face service unavailable');
   }
   try {
    const next=url.endsWith('/place-face')?placeReferenceFace(input):url.endsWith('/fit-envelope')?fitReferenceEnvelope(input):composeReferenceLayout(input);
    if(url.endsWith('/place-face')&&state.tamper)state.tamper(next);
    return {ok:true,json:async()=>next};
   }catch(error){return{ok:false,json:async()=>({message:error.message})};}
  },
 });
 const event={preventDefault(){}};
 return{el,blobs,calls,revoked,state,drawing,event,
  open:()=>el('load-form').handlers.submit(event),preview:()=>el('face-placement-form').handlers.submit(event),click:id=>el(id).handlers.click(),
  input:(id,value)=>{el(id).value=String(value);el(id).handlers.input();},
  saved:async(suffix='.layout.json',json=true)=>{const link=el('downloads').children.find(link=>link.download.endsWith(suffix));const text=await blobs.get(link.href).text();return json?JSON.parse(text):text;},
 };
}

test('actual preview highlights the picked face; cancel, single apply, undo/redo, save and reopen preserve original source',async()=>{
 const ui=harness();await ui.preview();assert.equal(ui.calls.length,0);await ui.open();
 const original=await ui.saved(), originalObj=await ui.saved('.obj',false),originalReport=await ui.saved('.report.json'),urls=ui.el('downloads').children.map(link=>link.href);
 const oldDrawing=JSON.stringify(ui.drawing.points);ui.input('face-placement-triangle',1);ui.input('face-placement-height',5);await ui.preview();
 assert.match(ui.el('face-placement-selection').textContent,/picked 1/);assert.ok(ui.drawing.labels.some(text=>text.includes('FACE PREVIEW')));assert.ok(ui.drawing.labels.includes('Face A'));
 assert.notEqual(JSON.stringify(ui.drawing.points),oldDrawing);assert.equal(ui.el('face-placement-apply').disabled,false);
 assert.deepEqual(await ui.saved(),original);assert.equal(await ui.saved('.obj',false),originalObj);assert.deepEqual(await ui.saved('.report.json'),originalReport);assert.deepEqual(ui.el('downloads').children.map(link=>link.href),urls);
 await ui.click('face-placement-cancel');assert.equal(ui.el('face-placement-apply').disabled,true);assert.ok(!ui.drawing.labels.some(text=>text.includes('FACE PREVIEW')));
 await ui.preview();await ui.click('face-placement-apply');const placed=await ui.saved();assert.notDeepEqual(placed,original);
 assert.deepEqual(placed.instances[0].source,original.instances[0].source);assert.equal(placed.instances[0].transform.scale,original.instances[0].transform.scale);assert.deepEqual(placed.instances.slice(1),original.instances.slice(1));
 const report=await ui.saved('.report.json');assert.equal(report.face_placement.triangle_index,1);assert.equal(report.face_placement.height_mm,5);
 await ui.click('face-placement-apply');assert.match(ui.el('history-status').textContent,/1 undo/);
 await ui.click('layout-undo');assert.deepEqual(await ui.saved(),original);await ui.click('layout-redo');assert.deepEqual(await ui.saved(),placed);
 ui.el('layout-file').files=[{size:5000,text:async()=>JSON.stringify(placed)}];await ui.open();assert.deepEqual(await ui.saved(),placed);
 assert.equal((await ui.saved('.report.json')).geometry_sha256,report.geometry_sha256);
});
test('pending cancel and input interruptions ignore late success and failure; repeated/conflicting requests stay locked',async()=>{
 for(const interrupt of ['cancel','height','triangle']) for(const fail of [false,true]) {
  const ui=harness();await ui.open();const original=await ui.saved();ui.input('face-placement-height',4);ui.state.hold=true;
  const pending=ui.preview(),count=ui.calls.length;assert.equal(ui.el('face-placement-controls').disabled,true);assert.equal(ui.el('face-placement-cancel').disabled,false);
  await ui.preview();await ui.click('face-placement-apply');await ui.click('layout-undo');await ui.el('fit-envelope-form').handlers.submit(ui.event);assert.equal(ui.calls.length,count);
  if(interrupt==='cancel')await ui.click('face-placement-cancel');else ui.input('face-placement-'+interrupt,interrupt==='height'?7:1);
  ui.state.fail=fail;const release=ui.state.hold;ui.state.hold=null;release();await pending;
  assert.equal(ui.el('face-placement-apply').disabled,true);assert.equal(ui.el('face-placement-controls').disabled,false);assert.deepEqual(await ui.saved(),original);assert.doesNotMatch(ui.el('status').textContent,/unavailable/);
  ui.state.fail=false;await ui.preview();assert.equal(ui.el('face-placement-apply').disabled,false);
 }
});
test('selection, dirty placement, changed revision and another preview invalidate pending face application',async()=>{
 const ui=harness();await ui.open();const original=await ui.saved();ui.input('face-placement-height',4);await ui.preview();
 ui.input('tx',9);await ui.click('face-placement-apply');assert.equal(ui.el('face-placement-controls').disabled,true);assert.deepEqual(await ui.saved(),original);
 const count=ui.calls.length;await ui.preview();assert.equal(ui.calls.length,count);await ui.click('discard-placement');
 await ui.preview();ui.el('selected').value=layout.instances[1].id;ui.el('selected').handlers.change();assert.equal(ui.el('face-placement-apply').disabled,true);
 await ui.preview();for(const axis of ['x','y','z']){ui.el('fit-envelope-'+axis).value='1';ui.el('fit-envelope-'+axis).handlers.input();}
 await ui.el('fit-envelope-form').handlers.submit(ui.event);assert.equal(ui.el('face-placement-apply').disabled,true);assert.equal(ui.el('fit-envelope-apply').disabled,false);
 await ui.preview();assert.equal(ui.el('fit-envelope-apply').disabled,true);await ui.click('face-placement-apply');await ui.preview();await ui.click('layout-undo');
 assert.equal(ui.el('face-placement-apply').disabled,true);assert.deepEqual(await ui.saved(),original);
});
test('mismatched responses and invalid choices cannot mutate saved layout or leave an applicable preview',async()=>{
 const ui=harness();await ui.open();const original=await ui.saved();ui.input('face-placement-height',4);
 const mutations=[
  n=>n.face_placement.parent_layout_sha256='bad',n=>n.face_placement.parent_geometry_sha256='bad',n=>n.face_placement.layout_sha256='bad',n=>n.face_placement.geometry_sha256='bad',
  n=>n.face_placement.instance_id='wrong',n=>n.face_placement.triangle_index=1,n=>n.face_placement.height_mm=9,n=>n.face_placement.before_vertices_mm[0]=[77,88,99],
  n=>n.layout.instances[0].transform.scale=7,n=>n.layout.instances[0].source.text='wrong',n=>n.layout.instances[1].transform.translation_mm[0]=9,
  n=>n.face_placement.after_vertices_mm[0]=[1,2,3],n=>n.exports.layout=JSON.stringify(original),n=>n.triangles[0]=[0,0,0],
 ];
 for(const mutate of mutations){ui.state.tamper=mutate;await ui.preview();assert.equal(ui.el('face-placement-apply').disabled,true);assert.match(ui.el('status').textContent,/does not match/);assert.deepEqual(await ui.saved(),original);}
 ui.state.tamper=null;ui.state.fail=true;await ui.preview();assert.match(ui.el('status').textContent,/unavailable/);assert.deepEqual(await ui.saved(),original);ui.state.fail=false;
 for(const [id,value] of [['triangle',-1],['triangle','0.1'],['triangle',999],['height',''],['height','NaN'],['height',1e10]]) {
  ui.input('face-placement-triangle',0);ui.input('face-placement-height',0);ui.input('face-placement-'+id,value);await ui.preview();assert.equal(ui.el('face-placement-apply').disabled,true);assert.deepEqual(await ui.saved(),original);
 }
});
test('actual served handlers use the real HTTP endpoint, apply, undo, redo and reopen',async t=>{
 const root=process.env.MOONMOLD_TEST_OUTPUT_ROOT||os.tmpdir();await mkdir(root,{recursive:true});const workspace=await mkdtemp(path.join(root,'face-placement-ui-http-'));
 const server=createOperatorServer({workspaceRoot:workspace});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,page=await(await fetch(base+'/reference-layout')).text(),ui=harness({base,html:page});
 await ui.open();const original=await ui.saved();ui.input('face-placement-height',12);await ui.preview();assert.equal(ui.el('face-placement-apply').disabled,false);await ui.click('face-placement-apply');
 const changed=await ui.saved();assert.notDeepEqual(changed,original);await ui.click('layout-undo');assert.deepEqual(await ui.saved(),original);await ui.click('layout-redo');assert.deepEqual(await ui.saved(),changed);
 ui.el('layout-file').files=[{size:4000,text:async()=>JSON.stringify(changed)}];await ui.open();assert.deepEqual(await ui.saved(),changed);
 assert.ok(ui.calls.some(call=>call.url==='/api/reference-layout/place-face'));
});

test('pending cancel aborts the request and unlocks editing when the transport honors abort',async()=>{
 const ui=harness();await ui.open();const original=await ui.saved();ui.state.hold=true;ui.state.honorAbort=true;
 const pending=ui.preview();await ui.click('face-placement-cancel');await pending;
 assert.equal(ui.el('edit-controls').disabled,false);assert.equal(ui.el('face-placement-apply').disabled,true);assert.deepEqual(await ui.saved(),original);assert.doesNotMatch(ui.el('status').textContent,/Aborted/);
});
