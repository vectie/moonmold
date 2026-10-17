import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createOperatorServer } from './operator-server.mjs';
import { locateReferenceDefects } from './reference-defects.mjs';

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
   if(!url.endsWith('/defects'))return response;
   const report=await response.json();
   if(state.hold){const hold=state.hold;hold.arrive();await hold.promise;}
   if(state.fail)throw Error('Defect service interrupted');
   if(state.tamper)state.tamper(report);
   return {ok:response.ok,json:async()=>report};
  },
 });
 const fire=(id,type='click')=>el(id).handlers[type]({preventDefault(){}});
 const input=(id,value,type='input')=>{el(id).value=String(value);return fire(id,type);};
 const download=async(id,suffix)=>{const link=el(id).children.find(link=>!suffix||link.download.endsWith(suffix));assert.ok(link,`Missing download in ${id}`);return JSON.parse(await blobs.get(link.href).text());};
 return {el,blobs,revoked,calls,draw,state,fire,input,download,
  load:async(layout=seed)=>{el('layout-file').files=[{size:JSON.stringify(layout).length,text:async()=>JSON.stringify(layout)}];await fire('load-form','submit');},
  measure:()=>fire('defect-inspect'),
  select(id){input('selected',id,'change');},
  hold(){let arrive,release;const arrived=new Promise(resolve=>arrive=resolve),promise=new Promise(resolve=>release=resolve);state.hold={arrive,promise};return{arrived,release(){state.hold=null;release();}};},
 };
}

test('real route + served selection UI locates original OBJ edges, highlights chosen edge and exports annotated sibling',async t=>{
 const h=await harness(t);await h.load();await h.measure();
 const report=await h.download('defect-download','.json');
 assert.equal(report.instance_id,'panel');assert.equal(report.defect_count,4);
 assert.deepEqual(report,JSON.parse(locateReferenceDefects(h.calls.at(-1).input).exports.json));
 assert.equal(report.defects[0].uses[0].source_locator.line,7);
 assert.deepEqual(report.defects[0].uses[0].source_locator.obj_vertex_numbers,[1,2]);
 h.input('defect-edge','E3','change');assert.match(h.el('defect-detail').textContent, /"id": "E3"/);
 assert.ok(h.draw.some(r=>r[0]==='line'&&r.at(-1)==='#ffffff'));
 const link=h.el('defect-download').children.find(a=>a.download.endsWith('.svg'));
 const svg=await h.blobs.get(link.href).text();assert.match(svg,/data-defect-id="E3"/);assert.match(svg,/original OBJ face 0, line 7/);assert.match(svg,new RegExp(report.source_sha256));
 const saved=await h.download('downloads','.layout.json');await h.load(saved);assert.equal(h.el('defect-download').children.length,0);await h.measure();assert.deepEqual(await h.download('defect-download','.json'),report);
 h.select('other');assert.equal(h.el('defect-download').children.length,0);await h.measure();assert.equal((await h.download('defect-download','.json')).instance_id,'other');
});
test('selection, dirty placement, undo and removal invalidate reports; failed/mismatched and stale requests do not publish',async t=>{
 const h=await harness(t);await h.load();await h.measure();const old=h.el('defect-download').children[0].href;
 h.input('tx',8);assert.ok(h.revoked.includes(old));assert.equal(h.el('defect-controls').disabled,true);assert.equal(h.el('defect-download').children.length,0);
 h.fire('discard-placement');await h.measure();h.input('tx',8);await h.fire('edit-form','submit');await h.measure();assert.equal((await h.download('defect-download','.json')).transform.translation_mm[0],8);
 await h.fire('layout-undo');assert.equal(h.el('defect-download').children.length,0);
 for(const tamper of [r=>r.layout_sha256='bad',r=>r.geometry_sha256='bad',r=>r.source_sha256='bad',r=>r.instance_id='other',r=>r.physical_authority=true]){h.state.tamper=tamper;await h.measure();assert.match(h.el('status').textContent,/does not match/);assert.equal(h.el('defect-download').children.length,0);}
 h.state.tamper=null;h.state.fail=true;await h.measure();assert.match(h.el('status').textContent,/interrupted/);h.state.fail=false;
 const held=h.hold(),pending=h.measure();await held.arrived;const count=h.calls.length;await h.measure();assert.equal(h.calls.length,count);h.input('tx',9);held.release();await pending;assert.equal(h.el('defect-download').children.length,0);assert.equal(h.el('defect-controls').disabled,true);
 h.fire('discard-placement');await h.measure();await h.fire('remove');assert.equal(h.el('defect-download').children.length,0);await h.fire('remove');assert.equal(h.el('defect-controls').disabled,true);
});
