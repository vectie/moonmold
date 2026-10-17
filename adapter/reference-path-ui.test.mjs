import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createOperatorServer } from './operator-server.mjs';
import { measureReferencePath, PATH_MAX_OBSERVATION_BYTES } from './reference-path.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const seed={contract_id:'moonmold.reference-layout.v1',name:'path-ui-review',instances:[
 {id:'panel',source:{input_format:'obj',units:'mm',name:'path-points',text:'v 0 0 0\nv 3 0 0\nv 3 4 0\nv 0 4 0\nv 0 4 12\nv 0 0 12\nf 1 2 3 4\n'},transform:{}},
 {id:'other',source:{input_format:'obj',units:'mm',text:'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'},transform:{translation_mm:[0,0,5]}}
]};
// Production page script and real loopback routes, with DOM/canvas doubles.
// This is event-handler qualification, not a graphical-browser rendering test.
async function harness(t) {
 const dir=await mkdtemp(path.join(tmpdir(),'path-ui-')),server=createOperatorServer({workspaceRoot:dir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(base+'/reference-layout')).text();
 const elements=new Map(),blobs=new Map(),revoked=[],calls=[],draw=[],state={hold:null,tamper:null,fail:false};let serial=0;
 function el(id) {
  if(!elements.has(id))elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},files:[],
   addEventListener(type,handler){this.handlers[type]=handler;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},removeAttribute(key){delete this[key];},get selectedOptions(){return this.children.filter(child=>child.selected);}});
  return elements.get(id);
 }
 const ctx={clearRect(){draw.length=0;},beginPath(){},moveTo(...xy){draw.push(['move',...xy,this.strokeStyle]);},lineTo(...xy){draw.push(['line',...xy,this.strokeStyle]);},stroke(){},fillText(...args){draw.push(['text',...args]);}};
 el('preview').getContext=()=>ctx;el('preview').width=1000;el('preview').height=400;
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
  document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,AbortController,
  URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
  fetch:async(url,options)=>{
   calls.push({url,input:JSON.parse(options.body)});const response=await fetch(base+url,options);
   if(!url.endsWith('/path'))return response;
   const report=await response.json();
   if(state.hold){const hold=state.hold;hold.arrive();await hold.promise;}
   if(state.fail)throw Error('Path service interrupted');
   if(state.tamper)state.tamper(report);
   return {ok:response.ok,json:async()=>report};
  },
 });
 const fire=(id,type='click')=>el(id).handlers[type]({preventDefault(){}});
 const input=(id,value,type='input')=>{el(id).value=String(value);return fire(id,type);};
 const download=async(id,suffix)=>{const link=el(id).children.find(link=>!suffix||link.download.endsWith(suffix));assert.ok(link,`Missing download in ${id}`);return JSON.parse(await blobs.get(link.href).text());};
 return {el,blobs,revoked,calls,draw,state,fire,input,download,
  load:async(layout=seed)=>{el('layout-file').files=[{size:JSON.stringify(layout).length,text:async()=>JSON.stringify(layout)}];await fire('load-form','submit');},
  append(index,instance='panel'){input('path-instance',instance,'change');input('path-vertex',index);fire('path-add');},
  choose(indices=[0,1,2,3]){for(const index of indices)this.append(index);},
  measure:()=>fire('path-form','submit'),
  close(value){el('path-closed').checked=value;fire('path-closed','change');},
  reopen:async report=>{el('path-file').files=[{size:JSON.stringify(report).length,text:async()=>JSON.stringify(report)}];await fire('path-open');},
  hold(){let arrive,release;const arrived=new Promise(resolve=>arrive=resolve),promise=new Promise(resolve=>release=resolve);state.hold={arrive,promise};return{arrived,release(){state.hold=null;release();}};},
 };
}

test('actual operator appends 3/4/5 segments, shows placed order and cumulative lengths, and downloads exact JSON',async t=>{
 const h=await harness(t);assert.equal(h.el('path-download').children.length,0);await h.load();h.choose();
 assert.match(h.el('path-selection').textContent,/1\. panel\[0\]: 0, 0, 0 mm\n2\. panel\[1\]: 3, 0, 0 mm/);
 assert.equal(h.draw.filter(row=>row[0]==='line'&&row.at(-1)==='#ffb668').length,3);assert.ok(h.draw.some(row=>row[1]==='Path 4'));
 for(const [count,total] of [[3,10],[4,22],[5,26]]) {
  if(count>3)h.append(count);await h.measure();assert.match(h.el('path-status').textContent,new RegExp(`${count} segments; total ${total} mm`));assert.match(h.el('path-status').textContent,/cumulative 7 mm/);
  const report=await h.download('path-download'),call=h.calls.at(-1);assert.equal(call.url,'/api/reference-layout/path');assert.deepEqual(report,measureReferencePath(call.input));assert.equal(report.physical_authority,false);assert.equal(report.endpoints.length,count+1);
 }
 assert.ok(h.draw.some(row=>row[1]==='Path: 26 mm (3D)'));h.input('yaw',70);assert.ok(h.draw.some(row=>row[1]==='Path: 26 mm (3D)'));
});
test('closure, repeated points, removal, clear and cross-instance paths retain operator order',async t=>{
 const h=await harness(t);await h.load();h.choose([0,0,1,0]);h.close(true);await h.measure();let report=await h.download('path-download');assert.deepEqual(report.segments.map(s=>s.length_mm),[0,3,3,0]);assert.match(h.el('path-status').textContent,/Point 4 → 1 \(closing\): 0 mm; cumulative 6 mm/);
 const old=h.el('path-download').children[0].href;h.fire('path-remove');assert.ok(h.revoked.includes(old));assert.equal(h.el('path-download').children.length,0);assert.match(h.el('path-selection').textContent,/3\. panel\[1\]/);h.close(false);await h.measure();report=await h.download('path-download');assert.deepEqual(report.endpoints.map(e=>e.vertex_index),[0,0,1]);
 h.fire('path-clear');assert.equal(h.el('path-closed').checked,false);h.append(0);h.append(0,'other');await h.measure();report=await h.download('path-download');assert.equal(report.total_length_mm,5);assert.deepEqual(report.endpoints.map(e=>e.instance_id),['panel','other']);
});
test('editable layout and path JSON reopen retain source-bound ordered choices, requiring a fresh observation',async t=>{
 const h=await harness(t);await h.load();h.choose([0,2,1,3]);h.close(true);await h.measure();const report=await h.download('path-download'),saved=await h.download('downloads','.layout.json'),link=h.el('path-download').children[0].href;
 await h.load(saved);assert.ok(h.revoked.includes(link));assert.equal(h.el('path-download').children.length,0);assert.match(h.el('path-selection').textContent,/Append 2 through 64/);
 await h.reopen(report);assert.equal(h.el('path-download').children.length,0);assert.match(h.el('path-status').textContent,/choices reopened/);assert.equal(h.el('path-closed').checked,true);await h.measure();assert.deepEqual(await h.download('path-download'),report);assert.deepEqual(await h.download('downloads','.layout.json'),saved);
 const changed=structuredClone(saved);changed.instances[0].source.text+='# revised identity\n';await h.load(changed);assert.equal(composeReferenceLayout(changed).geometry_sha256,report.geometry_sha256);await h.reopen(report);assert.match(h.el('path-status').textContent,/does not match/);assert.equal(h.el('path-download').children.length,0);assert.match(h.el('path-selection').textContent,/Append 2 through 64/);
});
test('pending placement edits, discard/apply, undo/redo, and empty layouts revoke paths and require fresh choices',async t=>{
 const h=await harness(t);await h.load();h.choose();await h.measure();const link=h.el('path-download').children[0].href;h.input('tx',8);assert.ok(h.revoked.includes(link));assert.equal(h.el('path-controls').disabled,true);assert.match(h.el('path-selection').textContent,/Append 2 through 64/);const count=h.calls.length;await h.measure();assert.equal(h.calls.length,count);
 h.fire('discard-placement');assert.equal(h.el('path-controls').disabled,false);h.choose();await h.measure();h.input('tx',8);await h.fire('edit-form','submit');assert.equal(h.el('path-download').children.length,0);h.choose();await h.measure();assert.match(h.el('path-selection').textContent,/panel\[0\]: 8, 0, 0 mm/);
 await h.fire('layout-undo');assert.equal(h.el('path-download').children.length,0);assert.match(h.el('path-selection').textContent,/Append 2 through 64/);await h.fire('layout-redo');assert.equal(h.el('path-download').children.length,0);
 await h.load({...structuredClone(seed),instances:[structuredClone(seed.instances[0])]});h.choose();await h.measure();await h.fire('remove');assert.equal(h.el('path-controls').disabled,true);assert.equal(h.el('path-download').children.length,0);await h.fire('layout-undo');assert.equal(h.el('path-controls').disabled,false);assert.match(h.el('path-selection').textContent,/Append 2 through 64/);
});
test('repeat submit is inert; a placement-field interruption prevents a late in-flight response publishing',async t=>{
 const h=await harness(t);await h.load();h.choose();const held=h.hold(),pending=h.measure();await held.arrived;const count=h.calls.length;await h.measure();assert.equal(h.calls.length,count);
 h.input('tx',9);held.release();await pending;assert.equal(h.el('path-download').children.length,0);assert.equal(h.el('path-controls').disabled,true);assert.match(h.el('path-status').textContent,/Placement fields changed during measurement/);assert.match(h.el('path-selection').textContent,/Append 2 through 64/);
 h.fire('discard-placement');h.choose();await h.measure();assert.equal(h.el('path-download').children.length,1);
});
test('closure interruption, failed response, and mismatched identity/provenance/lengths cannot publish downloads',async t=>{
 const h=await harness(t);await h.load();h.choose();const held=h.hold(),pending=h.measure();await held.arrived;h.close(true);held.release();await pending;assert.equal(h.el('path-download').children.length,0);assert.match(h.el('path-status').textContent,/Closure changed/);
 for(const tamper of [r=>r.layout_sha256='0'.repeat(64),r=>r.geometry_sha256='0'.repeat(64),r=>r.endpoints.reverse(),r=>r.endpoints[0].source_sha256='0'.repeat(64),r=>r.endpoints[0].coordinates_mm[0]+=1,r=>r.endpoints[0].transform.translation_mm[0]+=1,r=>r.segments[0].length_mm+=1,r=>r.segments[1].cumulative_length_mm+=1,r=>r.total_length_mm+=1,r=>r.closed=false,r=>r.physical_authority=true,r=>r.endpoints=null]) {
  h.state.tamper=tamper;await h.measure();assert.match(h.el('path-status').textContent,/does not match/);assert.equal(h.el('path-download').children.length,0);
 }
 h.state.tamper=null;h.state.fail=true;await h.measure();assert.match(h.el('path-status').textContent,/service interrupted/);assert.equal(h.el('path-download').children.length,0);h.state.fail=false;await h.measure();assert.equal(h.el('path-download').children.length,1);
});
test('invalid selections, path bounds and invalid saved reports fail locally without losing applied layout',async t=>{
 const h=await harness(t);await h.load();const saved=await h.download('downloads','.layout.json');await h.measure();assert.match(h.el('path-status').textContent,/2 through 64/);
 for(const value of ['','-1','0.5','6','no']){h.input('path-instance','panel','change');h.input('path-vertex',value);h.fire('path-add');assert.match(h.el('path-status').textContent,/valid zero-based/);}
 h.choose(Array.from({length:64},()=>0));h.append(1);assert.match(h.el('path-status').textContent,/limited to 64/);await h.measure();assert.equal((await h.download('path-download')).endpoint_count,64);
 for(const report of [{},null,{endpoints:[],closed:false},{endpoints:[null,null],closed:false}]){await h.reopen(report);assert.match(h.el('path-status').textContent,/unavailable/);assert.equal(h.el('path-download').children.length,0);}
 h.el('path-file').files=[{size:PATH_MAX_OBSERVATION_BYTES+1,text:async()=>'{}'}];await h.fire('path-open');assert.match(h.el('path-status').textContent,/1000000/);
 h.el('path-file').files=[{size:2,text:async()=>'{broken'}];await h.fire('path-open');assert.match(h.el('path-status').textContent,/unavailable/);assert.deepEqual(await h.download('downloads','.layout.json'),saved);
});
test('path and existing distance/angle observations remain independent; unapplied preview hides path overlays',async t=>{
 const h=await harness(t);await h.load();h.choose();await h.measure();
 for(const [side,index] of [['a',0],['b',1]]){h.el(`measure-${side}-instance`).value='panel';h.el(`measure-${side}-vertex`).value=String(index);}await h.fire('measure-form','submit');assert.match(h.el('measure-status').textContent,/Euclidean distance: 3 mm/);assert.equal(h.el('path-download').children.length,1);
 for(const [side,index] of [['a',0],['b',1],['c',2]]){h.input(`angle-${side}-instance`,'panel','change');h.input(`angle-${side}-vertex`,index);}await h.fire('angle-form','submit');assert.match(h.el('angle-status').textContent,/90 degrees/);assert.equal(h.el('path-download').children.length,1);
 for(const id of ['fit-envelope-x','fit-envelope-y','fit-envelope-z'])h.input(id,100);await h.fire('fit-envelope-form','submit');assert.ok(!h.draw.some(row=>row[0]==='text'&&String(row[1]).startsWith('Path ')));assert.equal(h.el('path-download').children.length,1);h.fire('fit-envelope-cancel');assert.ok(h.draw.some(row=>row[1]==='Path 1'));
});

test('high valid selected-part and endpoint counts download and reopen the exact pretty-printed Blob without provenance loss',async t=>{
 const h=await harness(t);
 // Reproduce the formerly rejected 128-part case, then the parser's maximum 256 occurrences.
 for(const count of [128,256]){
  const ids=Array.from({length:count},(_,i)=>`object-${i}`),source='v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'+Array.from({length:count-1},(_,i)=>`o p${i+1}\nf 1 2 3\n`).join('');
  const layout={contract_id:seed.contract_id,name:`high-count-${count}`,instances:[{id:'panel',source:{input_format:'obj',units:'mm',text:source,part_ids:ids},transform:{}}]};
  await h.load(layout);h.choose(Array.from({length:64},(_,i)=>i%3));h.close(true);await h.measure();
  const link=h.el('path-download').children[0];assert.ok(link);const blob=h.blobs.get(link.href);assert.ok(blob.size>200000);assert.ok(blob.size<=PATH_MAX_OBSERVATION_BYTES);
  const report=JSON.parse(await blob.text());assert.equal(report.endpoints.length,64);for(const endpoint of report.endpoints)assert.deepEqual(endpoint.selection.part_ids,ids);
  const saved=await h.download('downloads','.layout.json');await h.load(saved);h.el('path-file').files=[blob];await h.fire('path-open');assert.match(h.el('path-status').textContent,/choices reopened/);assert.equal(h.el('path-download').children.length,0);
  await h.measure();assert.deepEqual(await h.download('path-download'),report);assert.equal(h.blobs.get(h.el('path-download').children[0].href).size,blob.size);
 }
});
