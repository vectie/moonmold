import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { locateReferenceDefects } from './reference-defects.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/reference-volume.layout.json', import.meta.url)));
const inspect = (layout=fixture,instance_id='open-panel') => locateReferenceDefects({layout,instance_id});

test('boundary, winding and nonmanifold locators agree with existing volume incidence without modifying originals',()=>{
 for(const mode of ['boundary','inconsistent','nonmanifold','closed']) {
  const layout=structuredClone(fixture),item=layout.instances[0];
  if(mode==='inconsistent')item.source.text=item.source.text.replace('f 1 3 2','f 2 3 1');
  if(mode==='nonmanifold')item.source.text+='f 1 3 2\n';
  const id=mode==='boundary'?'open-panel':item.id,before=JSON.stringify(layout),r=inspect(layout,id),v=measureReferenceVolume({layout,instance_ids:[id]}).parts[0];
  for(const kind of ['boundary','nonmanifold','inconsistent'])assert.equal(r.counts[kind],v.topology[kind+'_edges']);
  assert.equal(JSON.stringify(layout),before);assert.equal(r.physical_authority,false);
  assert.deepEqual(r,inspect(layout,id));assert.equal(r.defect_count,mode==='closed'?0:3);
  assert.match(r.exports.svg,/DEFECT EDGE LOCATORS/);
 }
});
test('selected OBJ group preserves original face, line and vertex identity across remapping and placement',()=>{
 const layout={contract_id:'moonmold.reference-layout.v1',name:'selected',instances:[{id:'chosen',source:{input_format:'obj',units:'cm',text:'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 5 0 0\nv 6 0 0\nv 5 1 0\no first\nf 1 2 3\no chosen\nf 4 5 6\n',part_ids:['object-2']},transform:{translation_mm:[7,8,9]}}]};
 const r=inspect(layout,'chosen'),use=r.defects[0].uses[0];assert.equal(use.source_locator.face_index,1);assert.equal(use.source_locator.line,10);assert.deepEqual(use.local_vertex_indices,[0,1]);assert.deepEqual(use.source_locator.vertex_indices,[3,4]);assert.deepEqual(use.source_locator.obj_vertex_numbers,[4,5]);assert.deepEqual(r.defects[0].coordinates_mm,[[57,8,9],[67,8,9]]);
});
test('non-OBJ observations explicitly withhold original face mapping, and source-only changes change binding',()=>{
 const layout={contract_id:'moonmold.reference-layout.v1',name:'stl',instances:[{id:'part',source:{input_format:'stl',units:'mm',text:'solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test\n'}}]};
 const r=inspect(layout,'part');assert.equal(r.defects[0].uses[0].source_locator.kind,'retained-triangulation-only');assert.match(r.exports.svg,/original face mapping unavailable/);
 const next=structuredClone(fixture),a=inspect(next);next.instances[2].source.text+='# source revision\n';const b=inspect(next);assert.notEqual(a.source_sha256,b.source_sha256);assert.notEqual(a.layout_sha256,b.layout_sha256);assert.equal(a.geometry_sha256,b.geometry_sha256);
});
test('unknown selections, arbitrary fields and defect overflow fail explicitly rather than silently truncating',()=>{
 assert.throws(()=>inspect(fixture,'missing'),/existing retained instance/);
 assert.throws(()=>locateReferenceDefects({layout:fixture,instance_id:'open-panel',repair:true}),/only layout/);
 const text=Array.from({length:86},(_,i)=>`v ${i*3} 0 0\nv ${i*3+1} 0 0\nv ${i*3} 1 0\nf ${i*3+1} ${i*3+2} ${i*3+3}\n`).join('');
 const layout={contract_id:'moonmold.reference-layout.v1',name:'limit',instances:[{id:'part',source:{input_format:'obj',units:'mm',text}}]};assert.throws(()=>inspect(layout,'part'),/256 defect edges/);
});
