import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sectionReferenceMesh } from './reference-section.mjs';
import { sectionReferenceLayout } from './reference-layout-section.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const cube = { input_format: 'obj', units: 'mm', text: await readFile(fixture('reference-section-cube.obj'), 'utf8') };
const example = JSON.parse(await readFile(fixture('reference-section-dxf.layout.json'), 'utf8'));
const testRoot = process.env.MOONMOLD_DXF_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-dxf-tests');
await mkdir(testRoot, { recursive: true });
const workdir = () => mkdtemp(path.join(testRoot, 'case-'));
const layout = instances => ({ contract_id: 'moonmold.reference-layout.v1', name: 'dxf-study', instances });
const slice = (input, axis = 'z', position_mm = 10) => sectionReferenceLayout(input, { axis, position_mm });
function decode(text) {
  const lines = text.trimEnd().split('\r\n'); assert.equal(lines.length % 2, 0);
  const pairs = []; for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i+1]]);
  assert.ok(pairs.every(([code, value]) => Number.isInteger(code) && value.length <= 255));
  const records = []; let current;
  for (const [code, value] of pairs) {
    if (code === 0) { current = { type: value, pairs: [] }; records.push(current); }
    else current?.pairs.push([code,value]);
  }
  const value = (record, code) => record.pairs.find(pair => pair[0] === code)?.[1];
  const point = (record, offset) => [10,20,30].map(code => Number(value(record, code + offset)));
  const entities = records.filter(r => ['LINE','POINT'].includes(r.type));
  const metadata = JSON.parse(pairs.filter(([code,v]) => code === 999 && v.startsWith('MM_META ')).map(([,v]) => v.slice(8)).join(''));
  const handles = pairs.filter(([code]) => code === 5).map(([,v])=>v); assert.equal(handles.length,new Set(handles).size);
  return { pairs, records, metadata, entities, value, point };
}

test('DXF projects every section axis to literal unscaled mm LINE coordinates and retains identity', () => {
  for (const axis of ['x','y','z']) {
    const section = sectionReferenceMesh({ ...cube, transform: { translation_mm: [100,-50,30] }, section: { axis, position_mm: {x:110,y:-40,z:40}[axis] } });
    const dxf = decode(section.exports.dxf);
    assert.equal(dxf.entities.length, 8); assert.equal(dxf.metadata.units,'mm');
    assert.equal(dxf.metadata.section_sha256,section.section_sha256);
    assert.equal(dxf.metadata.source_sha256,section.source_sha256);
    assert.equal(dxf.metadata.physical_authority,false);
    assert.equal(dxf.metadata.layers[0].name,'MM_01_reference');
    for (const [index,record] of dxf.entities.entries()) {
      assert.equal(record.type,'LINE'); assert.equal(dxf.value(record,8),'MM_01_reference');
      assert.deepEqual(dxf.point(record,0),[...section.segments[index].start_uv_mm,0]);
      assert.deepEqual(dxf.point(record,1),[...section.segments[index].end_uv_mm,0]);
    }
    const points=dxf.entities.flatMap(r=>[dxf.point(r,0),dxf.point(r,1)]);
    const projected = {x:[[-50,30],[-30,50]],y:[[100,30],[120,50]],z:[[100,-50],[120,-30]]}[axis];
    assert.deepEqual([0,1].map(i=>Math.min(...points.map(p=>p[i]))),projected[0]);
    assert.deepEqual([0,1].map(i=>Math.max(...points.map(p=>p[i]))),projected[1]);
    assert.equal(dxf.entities.reduce((sum,r)=>sum+Math.hypot(...dxf.point(r,1).map((v,i)=>v-dxf.point(r,0)[i])),0),80);
    assert.match(section.exports.dxf,/\$INSUNITS\r\n70\r\n4\r\n/);
    assert.equal(section.exports.dxf,sectionReferenceMesh({ ...cube, transform: { translation_mm: [100,-50,30] }, section: { axis, position_mm: {x:110,y:-40,z:40}[axis] } }).exports.dxf);
  }
});

test('layers remain unique for coincident, case-only, punctuated and truncated instance names', () => {
  const names = ['Panel.part','panel.part','A'.repeat(80),'A'.repeat(79)+'B'];
  const section = slice(layout(names.map(id=>({id,source:cube})))); const dxf=decode(section.exports.dxf);
  assert.equal(dxf.entities.length,32); assert.equal(new Set(dxf.metadata.layers.map(l=>l.name.toLowerCase())).size,4);
  dxf.metadata.layers.forEach((layer,i)=>{assert.equal(layer.instance_id,names[i]);assert.ok(layer.name.length<=31);assert.match(layer.name,/^[A-Za-z0-9_]+$/);assert.equal(dxf.entities.filter(r=>dxf.value(r,8)===layer.name).length,8);});
  assert.equal(dxf.metadata.layout_sha256,section.layout_sha256);
});

test('mixed source units, rotation, point contacts, omitted coplanar parts and empty layers remain honest', () => {
  const original=structuredClone(example), section=slice(example,'z',25), dxf=decode(section.exports.dxf);
  assert.deepEqual(example,original); assert.equal(section.segment_count,11); assert.equal(section.point_contact_count,1);
  assert.deepEqual(dxf.metadata.layers.map(l=>l.status),['segments','segments','point-contact','coplanar-only','empty']);
  assert.equal(dxf.records.filter(r=>r.type==='LAYER').length,6);
  assert.equal(dxf.entities.filter(r=>r.type==='LINE').length,11);
  const point=dxf.entities.find(r=>r.type==='POINT');assert.deepEqual(dxf.point(point,0),[0,0,0]);
  assert.equal(dxf.value(point,8),dxf.metadata.layers[2].name);
  assert.equal(dxf.metadata.layers[3].coplanar_triangles,1);
  assert.equal(slice(JSON.parse(composeReferenceLayout(example).exports.layout),'z',25).exports.dxf,section.exports.dxf);
  const empty=slice(example,'z',-100); assert.equal(decode(empty.exports.dxf).entities.length,0);assert.equal(decode(empty.exports.dxf).metadata.layers.length,5);
  const moved=structuredClone(example);moved.instances[0].transform.translation_mm[0]++;
  assert.notEqual(slice(moved,'z',25).exports.dxf,section.exports.dxf);
});

test('both real CLIs emit DXF and reject invalid modes/planes without overwriting output', async () => {
  const dir=await workdir();
  const cases=[['layout','reference-section-dxf.layout.json',['--section-axis','z','--section-position','25']],['mesh','reference-section-cube.obj',['--units','mm','--section-axis','z','--section-position-mm','10']]];
  for(const [kind,input,args] of cases){
    const cli=new URL(`../bin/moonmold-reference-${kind}.mjs`,import.meta.url).pathname;
    const run=extra=>spawnSync(process.execPath,[cli,'--input',fixture(input).pathname,...extra],{encoding:'utf8'});
    const output=path.join(dir,kind+'.dxf'),good=run([...args,'--format','dxf','--output',output]);assert.equal(good.status,0,good.stderr);
    const bytes=await readFile(output,'utf8');decode(bytes);assert.equal(run([...args,'--format','dxf']).stdout,bytes);
    assert.equal(run([...args,'--format','dxf','--output',output]).status,1);assert.equal(await readFile(output,'utf8'),bytes);
    assert.equal(run([...(kind==='mesh'?['--units','mm']:[]),'--format','dxf']).status,1);
    const bad=path.join(dir,kind+'-bad.dxf');assert.equal(run([...args.slice(0,-1),'NaN','--format','dxf','--output',bad]).status,1);await assert.rejects(access(bad));
  }
});

test('loopback operator offers layout and single-source DXF without scene mutation', async t => {
  const dir=await workdir(),server=createOperatorServer({workspaceRoot:dir});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const send=body=>fetch(base+'/api/reference-layout/section',{method:'POST',body});
  const response=await send(JSON.stringify({layout:example,plane:{axis:'z',position_mm:25}}));assert.equal(response.status,200);assert.deepEqual(await response.json(),slice(example,'z',25));
  for(const input of ['{broken',JSON.stringify({layout:example,plane:{axis:'Q',position_mm:25}}),JSON.stringify({layout:example,plane:{axis:'z',position_mm:25},script:'bad'}),' '.repeat(3100001)])assert.equal((await send(input)).status,400);
  const single=await fetch(base+'/api/reference-mesh/section',{method:'POST',body:JSON.stringify({...cube,section:{axis:'z',position_mm:10}})});assert.equal(single.status,200);assert.equal(decode((await single.json()).exports.dxf).entities.length,8);
  const html=await(await fetch(base+'/reference-layout')).text();assert.match(html,/Calculate section and DXF/);
  const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);
});

test('production layout controls preserve last result on failure, block repeats/dirty edits and invalidate revised outputs', async () => {
  const html=await readFile(new URL('../ui/reference-layout/index.html',import.meta.url),'utf8'),elements=new Map(),blobs=new Map(),revoked=[],calls=[];
  let serial=0,fail=false,mismatch=false,hold=null;
  function el(id){if(!elements.has(id))elements.set(id,{value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},removeAttribute(name){delete this[name];}});return elements.get(id);}
  el('preview').getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});el('preview').width=1000;el('preview').height=400;
  el('layout-file').files=[{size:2000,text:async()=>JSON.stringify(example)}];el('section-axis').value='z';el('section-position').value='25';
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:el,createElement:()=>({}),createTextNode:text=>({textContent:text})},Blob,
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async(url,options)=>{const input=JSON.parse(options.body);calls.push({url,input});if(hold)await new Promise(resolve=>{hold=resolve;});if(fail)return{ok:false,json:async()=>({message:'Section unavailable'})};if(url.endsWith('/section')){const section=sectionReferenceLayout(input.layout,input.plane);if(mismatch)section.geometry_sha256='0'.repeat(64);return{ok:true,json:async()=>section};}return{ok:true,json:async()=>composeReferenceLayout(input)};}});
  const event={preventDefault(){}},submit=()=>el('section-form').handlers.submit(event);
  await submit();assert.equal(calls.length,0);await el('load-form').handlers.submit(event);assert.equal(el('section-controls').disabled,false);
  await submit();assert.equal(el('section-downloads').children.length,4);const first=el('section-downloads').children[0].href;
  assert.equal(await blobs.get(first).text(),slice(example,'z',25).exports.dxf);assert.equal(el('section-preview').hidden,false);
  el('section-position').value='26';el('section-position').handlers.input();assert.equal(el('section-downloads').children[0].href,first);assert.match(el('section-status').textContent,/last calculated/);
  for(const mode of ['failure','mismatch']){fail=mode==='failure';mismatch=mode==='mismatch';await submit();assert.equal(el('section-downloads').children[0].href,first);assert.match(el('status').textContent,/unavailable|does not match/);}
  fail=false;mismatch=false;hold=true;const pending=submit(),count=calls.length;await submit();assert.equal(calls.length,count);assert.equal(el('section-controls').disabled,true);const release=hold;hold=null;release();await pending;assert.ok(revoked.includes(first));
  el('tx').value='120';el('tx').handlers.input();assert.equal(el('section-controls').disabled,true);assert.equal(el('section-downloads').children.length,0);assert.equal(el('section-preview').hidden,true);const dirtyCount=calls.length;await submit();assert.equal(calls.length,dirtyCount);
  await el('edit-form').handlers.submit(event);await submit();assert.equal(el('section-downloads').children.length,4);
  const report=JSON.parse(await blobs.get(el('section-downloads').children[1].href).text());assert.equal(report.parts[0].transform.translation_mm[0],120);
  el('section-middle').handlers.click();assert.match(el('section-status').textContent,/Midpoint selected/);assert.ok(Number.isFinite(Number(el('section-position').value)));
  while(!el('section-controls').disabled)await el('remove').handlers.click();assert.equal(el('section-downloads').children.length,0);assert.equal(el('section-preview').hidden,true);
  await el('load-form').handlers.submit(event);el('section-position').value='25';await submit();assert.equal(await blobs.get(el('section-downloads').children[0].href).text(),slice(example,'z',25).exports.dxf);
});
