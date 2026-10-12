import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mirrorReferenceLayout } from './reference-mirror.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const fixture = name => new URL('../fixtures/' + name, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-calibration.layout.json'), 'utf8'));
const request = (layout = seed, axis = 'x', position_mm = 50) => ({ layout, instance_ids: ['panel'], plane: { axis, position_mm }, suffix: '-mirror' });
const vector = (a, b) => a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-7, `${a} != ${b}`));
const normal = (vertices, face) => {
  const [a, b, c] = face.map(i => vertices[i]), u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
  return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
};

test('R430 creates a mirrored selected cm panel after complete placement, keeping every original', () => {
  const input = request(), saved = structuredClone(input), before = composeReferenceLayout(seed), result = mirrorReferenceLayout(input);
  assert.deepEqual(input, saved);
  assert.equal(result.instance_count, 3);
  assert.deepEqual(result.layout.instances.slice(0, 2), before.layout.instances);
  assert.deepEqual(result.parts.slice(0, 2), before.parts);
  assert.deepEqual(result.vertices.slice(0, 8), before.vertices);
  [[-30,-25,5],[-30,65,5],[30,65,5],[30,-25,5]].forEach((p,i) => vector(result.vertices[8+i], p));
  assert.deepEqual(result.triangles.slice(-2), [[8,10,9],[8,11,10]]);
  const mirror = result.mirror;
  assert.equal(mirror.parent_layout_sha256, before.layout_sha256);
  assert.equal(mirror.parts[0].source_sha256, before.parts[0].source_sha256);
  assert.equal(mirror.parts[0].derived_source_sha256, result.parts[2].source_sha256);
  assert.equal(mirror.physical_authority, false);
  assert.deepEqual(result.layout.instances[2].transform, { scale:1,rotation_deg:[0,0,0],center_and_ground:false,translation_mm:[0,0,0] });
  const recipe = JSON.parse(result.exports.recipe);
  assert.deepEqual(recipe.layout, before.layout);
  assert.deepEqual(recipe.layout.instances[0].source.part_ids, ['object-1']);
});

test('R430 all world axes reflect positions and oriented faces, retaining unused vertices', () => {
  const layout = { contract_id:'moonmold.reference-layout.v1',name:'asymmetric-reference',instances:[{id:'bracket',source:{input_format:'obj',units:'mm',text:'v 1 2 3\nv 4 2 3\nv 1 6 3\nv 1 2 8\nv 9 11 13\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4\n'},transform:{scale:2,rotation_deg:[23,-31,47],center_and_ground:true,translation_mm:[12,-9,20]}}] };
  const before = composeReferenceLayout(layout);
  for (const [axis, coordinate] of ['x','y','z'].map((a,i) => [a,i])) {
    const result = mirrorReferenceLayout({...request(layout,axis,-7.5),instance_ids:['bracket']});
    assert.equal(result.parts[1].vertex_range.count, 5);
    for (let i = 0; i < 5; i++) vector(result.vertices[5+i], before.vertices[i].map((n,j) => j === coordinate ? -15-n : n));
    for (let i = 0; i < 4; i++) {
      const sourceNormal = normal(before.vertices,before.triangles[i]);
      vector(normal(result.vertices,result.triangles[4+i]), sourceNormal.map((n,j) => j === coordinate ? -n : n));
    }
    assert.deepEqual(result.layout.instances[0],before.layout.instances[0]);
  }
});

test('R430 binary STL/PLY and selected GLB retain exact originals and mirror their placed geometry', async () => {
  const sources = [
    { input_format:'stl',units:'in',data_base64:(await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') },
    { input_format:'glb',units:'m',node_ids:[2],data_base64:(await readFile(fixture('reference-scene.glb'))).toString('base64') },
    JSON.parse(await readFile(fixture('reference-binary-ply.layout.json'),'utf8')).instances[0].source,
  ];
  for (const source of sources) {
    const layout = structuredClone(seed); layout.instances[0].source = source;
    const before = composeReferenceLayout(layout), result = mirrorReferenceLayout(request(layout,'y',12));
    const count = before.parts[0].vertex_range.count, start = before.vertex_count;
    for (let i = 0; i < count; i++) vector(result.vertices[start+i], [before.vertices[i][0],24-before.vertices[i][1],before.vertices[i][2]]);
    assert.deepEqual(result.layout.instances.slice(0,2),before.layout.instances);
    assert.deepEqual(JSON.parse(result.exports.recipe).layout,before.layout);
    assert.equal(result.parts[0].source_sha256,before.parts[0].source_sha256);
  }
});

test('R430 recipes regenerate deterministically; selected copies are independent editable layout sources', () => {
  const input = {...request(),instance_ids:['stand','panel']}, result = mirrorReferenceLayout(input);
  assert.deepEqual(result.mirror.instance_ids,['panel','stand']);
  assert.deepEqual(result.layout.instances.map(item => item.id),['panel','stand','panel-mirror','stand-mirror']);
  const repeated = mirrorReferenceLayout(JSON.parse(result.exports.recipe));
  assert.equal(repeated.exports.layout,result.exports.layout); assert.equal(repeated.exports.recipe,result.exports.recipe);
  const reopened = composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256,result.layout_sha256); assert.equal(reopened.geometry_sha256,result.geometry_sha256);
  const edited = JSON.parse(result.exports.layout); edited.instances[2].transform.translation_mm = [0,0,10];
  const moved = composeReferenceLayout(edited);
  assert.deepEqual(moved.parts[0],result.parts[0]); assert.deepEqual(moved.parts[1],result.parts[1]);
  vector(moved.vertices[8],[result.vertices[8][0],result.vertices[8][1],15]);
  const changed = JSON.parse(result.exports.recipe); changed.plane.position_mm = 60;
  const changedResult = mirrorReferenceLayout(changed);
  assert.notEqual(changedResult.geometry_sha256,result.geometry_sha256);
  vector(changedResult.vertices[8],[-10,-25,5]);
});

test('R430 rejects invalid choices, duplicate output IDs, capacity and reflected range without mutating input', () => {
  const invalid = [null,[],{}, {...request(),extra:true}, {...request(),contract_id:'wrong'}];
  for (const instance_ids of [[],['missing'],['panel','panel'],[1]]) invalid.push({...request(),instance_ids});
  for (const plane of [null,{}, {axis:'w',position_mm:0},{axis:'x',position_mm:Infinity},{axis:'x',position_mm:'0'},{axis:'x',position_mm:1e10}]) invalid.push({...request(),plane});
  for (const suffix of ['',null,'/copy','a'.repeat(80)]) invalid.push({...request(),suffix});
  invalid.push(request(seed,'x',-1e9));
  const collision = structuredClone(seed); collision.instances[1].id = 'panel-mirror'; invalid.push(request(collision));
  const many = structuredClone(seed); many.instances = Array.from({length:16},(_,i) => ({...structuredClone(seed.instances[0]),id:i === 0 ? 'panel' : 'copy'+i})); invalid.push(request(many));
  const long = structuredClone(seed); long.instances[0].id = 'a'.repeat(79); invalid.push({...request(long),instance_ids:[long.instances[0].id]});
  for (const input of invalid) { const saved = structuredClone(input); assert.throws(() => mirrorReferenceLayout(input)); assert.deepEqual(input,saved); }
});

test('R430 CLI saves all siblings, reopens recipe/layout and retains every fixture and failed command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'moonmold-mirror-cli-'));
  const cli = new URL('../bin/moonmold-reference-mirror.mjs',import.meta.url).pathname;
  const argv = ['--input',fixture('reference-calibration.layout.json').pathname,'--instances','panel','--axis','x','--position-mm','50','--suffix','-mirror'];
  let count = 0;
  async function run(args, file = cli) {
    const result = spawnSync(process.execPath,[file,...args],{encoding:'utf8'}), id = String(++count).padStart(2,'0');
    await writeFile(path.join(dir,id+'.json'),JSON.stringify({argv:[process.execPath,file,...args],status:result.status,stdout:result.stdout,stderr:result.stderr},null,2),{flag:'wx'});
    return result;
  }
  const expected = mirrorReferenceLayout(request());
  for (const format of ['layout','recipe','json','obj','stl']) {
    const output = path.join(dir,'result.'+format), result = await run([...argv,'--format',format,'--output',output]); assert.equal(result.status,0,result.stderr);
    const bytes = await readFile(output,'utf8'); assert.equal(bytes,format === 'json' ? JSON.stringify(expected,null,2)+'\n' : expected.exports[format]);
    assert.equal((await run([...argv,'--format',format,'--output',output])).status,1);
    assert.equal(await readFile(output,'utf8'),bytes);
  }
  assert.equal((await run(['--recipe',path.join(dir,'result.recipe'),'--format','layout'])).stdout,expected.exports.layout);
  const reopen = await run(['--input',path.join(dir,'result.layout'),'--format','json'],new URL('../bin/moonmold-reference-layout.mjs',import.meta.url).pathname);
  assert.equal(reopen.status,0,reopen.stderr); assert.equal(JSON.parse(reopen.stdout).geometry_sha256,expected.geometry_sha256);
  assert.equal((await run(['--recipe',path.join(dir,'result.recipe'),'--axis','y'])).status,1);
  assert.equal((await run(['--recipe',path.join(dir,'result.layout')])).status,1);
  for (const value of ['NaN','1e309','0x10','']) { const bad = [...argv]; bad[7] = value; assert.equal((await run(bad)).status,1); }
  const invalid = path.join(dir,'invalid.json'); await writeFile(invalid,'{broken',{flag:'wx'});
  assert.equal((await run(['--input',invalid,...argv.slice(2)])).status,1);
  assert.equal((await run([...argv,'--format','bad'])).status,1);
});
