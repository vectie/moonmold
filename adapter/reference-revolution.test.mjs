import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { revolveReferenceProfile } from './reference-revolution.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { createOperatorServer } from './operator-server.mjs';

const recipe = JSON.parse(await readFile(new URL('../fixtures/reference-collar.revolution.json',import.meta.url),'utf8'));
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-8*Math.max(1,Math.abs(b)), `${a} != ${b}`);
const root = new URL('../../evidence/http-workspace/',import.meta.url);

test('stepped collar has closed outward facets, editable source and portable geometry', () => {
  const before=structuredClone(recipe), result=revolveReferenceProfile(recipe), edges=new Map();
  assert.equal(result.vertices.length,192);assert.equal(result.triangles.length,384);
  for(const t of result.triangles)for(let i=0;i<3;i++){
    const a=t[i],b=t[(i+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');
    const value=edges.get(key)||[0,0];value[0]++;value[1]+=a<b?1:-1;edges.set(key,value);
  }
  assert.ok([...edges.values()].every(([count,direction])=>count===2&&direction===0));
  assert.deepEqual(result.bounds.size,[40,40,15]);
  // Analytic polygonal annulus layers, not the ideal smooth circle volume.
  const expected=(300*5+125*10)*32*Math.sin(2*Math.PI/32)/2;
  near(measureReferenceVolume({layout:JSON.parse(result.exports.layout),instance_ids:[recipe.name]}).shell_sum_volume_mm3,expected);
  let signed=0;
  for(const [i,j,k] of result.triangles){const a=result.vertices[i],b=result.vertices[j],c=result.vertices[k];signed+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
  near(signed,expected);
  assert.equal(revolveReferenceProfile(JSON.parse(result.exports.recipe)).geometry_sha256,result.geometry_sha256);
  assert.equal(composeReferenceLayout(JSON.parse(result.exports.layout)).geometry_sha256,result.geometry_sha256);
  assert.match(result.exports.obj,/^#|^v /m);assert.match(result.exports.stl,/solid/);
  assert.deepEqual(recipe,before);assert.equal(result.revolution.physical_authority,false);
  near(result.revolution.maximum_radial_chord_deviation_mm,20*(1-Math.cos(Math.PI/32)));
});

test('units, winding and refinement remain explicit; unsupported profiles are rejected',()=>{
  const base=revolveReferenceProfile(recipe);
  const cm=revolveReferenceProfile({...recipe,units:'cm',vertices:recipe.vertices.map(p=>p.map(v=>v/10))});
  assert.equal(cm.geometry_sha256,base.geometry_sha256);
  const reversed=revolveReferenceProfile({...recipe,vertices:[...recipe.vertices].reverse()});
  near(measureReferenceVolume({layout:JSON.parse(reversed.exports.layout),instance_ids:[recipe.name]}).shell_sum_volume_mm3,measureReferenceVolume({layout:JSON.parse(base.exports.layout),instance_ids:[recipe.name]}).shell_sum_volume_mm3);
  assert.ok(revolveReferenceProfile({...recipe,segments:64}).revolution.maximum_radial_chord_deviation_mm<base.revolution.maximum_radial_chord_deviation_mm);
  for(const patch of [{segments:0},{segments:8.5},{segments:129},{units:'__proto__'},{coordinate_frame:'xy'},{vertices:[[0,0],[10,0],[10,10]]},{vertices:[[1,0],[4,3],[1,3],[4,0]]},{vertices:[[1,0],[2,0],[3,0]]},{vertices:[[1,0],[2,0],[2,2],[1,0]]},{vertices:[[1,0],[Infinity,0],[2,2]]},{script:'anything'}])assert.throws(()=>revolveReferenceProfile({...recipe,...patch}));
});

function harness(html,base){
  const nodes=new Map(),blobs=new Map();let serial=0;const state={hold:null,mismatch:false};
  const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,children:[],files:[],handlers:{},width:800,height:460,textContent:'',addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(a){this.children.push(a);},getContext(){return{clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};}});return nodes.get(id);};
  el('name').value=recipe.name;el('units').value=recipe.units;el('points').value=JSON.stringify(recipe.vertices);el('segments').value='32';
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:el,createElement:()=>({})},Blob,TextDecoder,
    URL:{createObjectURL(blob){const id='blob:'+ ++serial;blobs.set(id,blob);return id;},revokeObjectURL(){}},
    fetch:async(url,opts)=>{const response=await fetch(base+url,opts);if(state.hold){const hold=state.hold;state.hold=null;hold.ready();await hold.wait;}if(state.mismatch){const next=await response.json();next.revolution.recipe.segments++;return{ok:true,json:async()=>next};}return response;}});
  return{el,state,build:()=>el('build-form').handlers.submit({preventDefault(){}}),
    change(id,value){el(id).value=String(value);el(id).handlers[id==='units'?'change':'input']();},
    async saved(suffix){const link=el('downloads').children.find(x=>x.download.endsWith(suffix));assert.ok(link);return JSON.parse(await blobs.get(link.href).text());},
    async open(r){const bytes=Buffer.from(JSON.stringify(r));el('recipe-file').files=[{size:bytes.length,arrayBuffer:async()=>bytes}];return el('open-form').handlers.submit({preventDefault(){}});},
    hold(){let ready,release;const started=new Promise(r=>ready=r);state.hold={ready,wait:new Promise(r=>release=r)};return{started,release};}};
}

test('actual UI over loopback HTTP builds, revises, saves, reopens and retains good downloads after invalid input',async t=>{
  await mkdir(root,{recursive:true});const server=createOperatorServer({workspaceRoot:root.pathname});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`,response=await fetch(base+'/reference-revolution');assert.equal(response.status,200);
  const html=await response.text(),ui=harness(html,base);await ui.build();
  assert.deepEqual(await ui.saved('.revolution.json'),recipe);assert.equal(ui.el('downloads').children.length,5);
  assert.match(ui.el('summary').textContent,/384 triangles/);
  ui.change('segments',64);assert.deepEqual(await ui.saved('.revolution.json'),recipe);await ui.build();
  const revised=await ui.saved('.revolution.json');assert.equal(revised.segments,64);assert.match(ui.el('summary').textContent,/768 triangles/);
  const independent=harness(html,base);await independent.open(revised);assert.deepEqual(await independent.saved('.revolution.json'),revised);
  assert.equal(independent.el('segments').value,'64');
  const layout=await independent.saved('.layout.json');assert.equal(composeReferenceLayout(layout).geometry_sha256,(await independent.saved('.report.json')).geometry_sha256);
  ui.change('points','[[0,0],[20,0],[20,5]]');await ui.build();assert.match(ui.el('status').textContent,/axis/);assert.deepEqual(await ui.saved('.revolution.json'),revised);
  ui.el('restore').handlers.click();assert.deepEqual(JSON.parse(ui.el('points').value),recipe.vertices);
  ui.state.mismatch=true;await ui.build();assert.match(ui.el('status').textContent,/does not match/);assert.deepEqual(await ui.saved('.revolution.json'),revised);ui.state.mismatch=false;
  const hold=ui.hold(),pending=ui.build();await hold.started;ui.change('segments',16);hold.release();await pending;
  assert.deepEqual(await ui.saved('.revolution.json'),revised);assert.match(ui.el('status').textContent,/Unbuilt edits/);
  const linkPage=await(await fetch(base+'/reference-profile')).text();assert.match(linkPage,/href="\/reference-revolution"/);
});
