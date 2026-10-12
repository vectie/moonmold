import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { circularArrayReferenceLayout } from './reference-circular-array.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-circular-array.layout.json'), 'utf8'));
const request = () => ({ layout: structuredClone(seed), instance_id: 'panel', axis: 'z', pivot_mm: [10,20,5], step_deg: 90, count: 4 });
const make = (changes = {}) => circularArrayReferenceLayout({ ...request(), ...changes });
const near = (a, b, epsilon = 1e-8) => a.forEach((n, i) => assert.ok(Math.abs(n-b[i]) < epsilon, `${a} != ${b}`));
const root = process.env.MOONMOLD_CIRCULAR_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-circular-tests');
await mkdir(root, { recursive: true });
const workdir = () => mkdtemp(path.join(root, 'case-'));

// Independent Rodrigues oracle: does not use production rotation/arrangement.
function turn(point, axis, angle, pivot) {
  const p = point.map((n, i) => n-pivot[i]), v = [0,0,0]; v['xyz'.indexOf(axis)] = 1;
  const c = Math.cos(angle*Math.PI/180), s = Math.sin(angle*Math.PI/180);
  const cross = [v[1]*p[2]-v[2]*p[1], v[2]*p[0]-v[0]*p[2], v[0]*p[1]-v[1]*p[0]];
  const dot = p.reduce((sum, n, i) => sum+n*v[i], 0);
  return p.map((n, i) => pivot[i]+n*c+cross[i]*s+v[i]*dot*(1-c));
}

test('four radial display panels keep originals and exact selected centimeter source with bound lineage', () => {
  const input = request(), original = structuredClone(input), before = composeReferenceLayout(input.layout), result = circularArrayReferenceLayout(input);
  assert.deepEqual(input, original);
  assert.equal(result.instance_count, 5); assert.equal(result.vertex_count, 20); assert.equal(result.triangle_count, 10);
  assert.deepEqual(result.layout.instances.slice(0,2), before.layout.instances);
  assert.deepEqual(result.vertices.slice(0,8), before.vertices);
  const expected = [
    [[60,20,5],[70,20,5],[70,20,35],[60,20,35]],
    [[10,70,5],[10,80,5],[10,80,35],[10,70,35]],
    [[-40,20,5],[-50,20,5],[-50,20,35],[-40,20,35]],
    [[10,-30,5],[10,-40,5],[10,-40,35],[10,-30,35]],
  ];
  for (let n = 0; n < 4; n++) {
    const part = result.parts[n+1];
    result.vertices.slice(part.vertex_range.start, part.vertex_range.start+4).forEach((p, i) => near(p, expected[n][i]));
    assert.deepEqual(result.layout.instances[n+1].source, before.layout.instances[1].source);
    assert.equal(part.source_sha256, createHash('sha256').update(seed.instances[1].source.text).digest('hex'));
    assert.deepEqual(part.selection.part_ids, ['object-1']);
    assert.deepEqual(part.triangle_source_faces, before.parts[1].triangle_source_faces);
    assert.equal(part.transform.scale, 0.5); assert.equal(part.transform.center_and_ground, true);
  }
  const op = result.circular_array;
  assert.equal(op.parent_layout_sha256, before.layout_sha256); assert.equal(op.parent_geometry_sha256, before.geometry_sha256);
  assert.equal(op.layout_sha256, result.layout_sha256); assert.equal(op.geometry_sha256, result.geometry_sha256);
  assert.equal(op.source_sha256, before.parts[1].source_sha256); assert.equal(op.added_instance_count, 3);
  assert.deepEqual(op.placements.map(p => [p.instance_id,p.index,p.angle_deg]), [['panel',0,0],['circular-1',1,90],['circular-2',2,180],['circular-3',3,270]]);
  assert.equal(result.physical_authority, false); assert.equal(op.physical_authority, false);
  assert.deepEqual(make(), result);
});

test('world X Y Z, negative increments and existing compound or gimbal rotations use the original placement each time', () => {
  for (const [axis, prior, grounded] of [['x',[13,27,-41],false], ['y',[37,90,-73],true], ['z',[37,-90,-73],true]]) {
    const input = request(); input.axis = axis; input.step_deg = -73; input.pivot_mm = [7,-11,17]; input.count = 5;
    input.layout.instances[1].transform.rotation_deg = prior; input.layout.instances[1].transform.center_and_ground = grounded;
    const before = composeReferenceLayout(input.layout), result = circularArrayReferenceLayout(input);
    assert.deepEqual(result.vertices.slice(0,8), before.vertices);
    for (let index = 1; index < input.count; index++) {
      const part = result.parts[index+1];
      for (let n = 0; n < 4; n++) near(result.vertices[part.vertex_range.start+n], turn(before.vertices[4+n], axis, input.step_deg*index, input.pivot_mm));
    }
  }
});

test('sources in OBJ, binary STL, binary PLY and selected GLB nodes retain payload, units and selections', async () => {
  const sources = [{ input_format: 'obj', units: 'cm', text: seed.instances[1].source.text, part_ids: ['object-1'] }];
  for (const [name,input_format,units] of [['reference-tetrahedron-binary.stl','stl','in'],['reference-tetrahedron-be.ply','ply','cm'],['reference-scene.glb','glb','m']]) {
    const source = { input_format, units, data_base64: (await readFile(fixture(name))).toString('base64') };
    if (input_format === 'glb') source.node_ids = [importReferenceMesh(source).glb_nodes[0].node_index];
    sources.push(source);
  }
  for (const source of sources) {
    const layout = { ...seed, instances: [{ id: 'panel', source, transform: { rotation_deg: [13,27,-41], center_and_ground: true, translation_mm: [50,20,5] } }] };
    const before = composeReferenceLayout(layout), result = make({ layout, axis: 'y', step_deg: 60, count: 3 });
    for (const item of result.layout.instances) assert.deepEqual(item.source, before.layout.instances[0].source);
    for (const part of result.parts) assert.equal(part.source_sha256, before.parts[0].source_sha256);
    assert.deepEqual(composeReferenceLayout(JSON.parse(result.exports.layout)).exports, result.exports);
  }
});

test('save, reopen and independent edit retain other placements; OBJ and STL contain the circular geometry', () => {
  const result = make(), reopened = composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256, result.layout_sha256); assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(reopened.exports, result.exports);
  const saved = JSON.parse(result.exports.layout); saved.instances[2].transform.translation_mm[2] += 7;
  const edited = composeReferenceLayout(saved);
  for (let n = 0; n < result.vertex_count; n++) near(edited.vertices[n], result.vertices[n].map((v, axis) => v+(n>=8 && n<12 && axis===2 ? 7 : 0)));
  for (const index of [0,1,3,4]) assert.deepEqual(edited.parts[index], result.parts[index]);
  result.layout.instances[2].source.part_ids.push('mutation');
  assert.deepEqual(result.layout.instances[1].source.part_ids, ['object-1']); assert.deepEqual(result.layout.instances[3].source.part_ids, ['object-1']);
  const obj = importReferenceMesh({ input_format: 'obj', units: 'mm', text: result.exports.obj });
  assert.deepEqual(obj.vertices, result.vertices); assert.deepEqual(obj.triangles, result.triangles);
  const stl = importReferenceMesh({ input_format: 'stl', units: 'mm', text: result.exports.stl });
  assert.equal(stl.triangle_count, 10);
  stl.triangles.forEach((face,i) => face.forEach((v,j) => near(stl.vertices[v], result.vertices[result.triangles[i][j]])));
});

test('count includes original, capacity is 16, names avoid collisions and repeated turns retain ordinary copies', () => {
  const layout = { ...seed, instances: [structuredClone(seed.instances[1])] };
  layout.instances[0].id = 'a'.repeat(80);
  const max = make({ layout, instance_id: layout.instances[0].id, count: 16, step_deg: 22.5 });
  assert.equal(max.instance_count, 16); assert.equal(max.layout.instances.at(-1).id, 'circular-15');
  const occupied = structuredClone(seed); occupied.instances[0].id = 'circular-1';
  assert.equal(make({ layout: occupied }).layout.instances[2].id, 'circular-2');
  const repeat = make({ count: 5 });
  assert.deepEqual(repeat.layout.instances.at(-1).transform, repeat.layout.instances[1].transform);
  assert.deepEqual(repeat.vertices.slice(-4), repeat.vertices.slice(4,8));
  assert.deepEqual(repeat.circular_array.placements.map(p => p.angle_deg), [0,90,180,270,360]);
});

test('invalid declarations and over-capacity or out-of-range results fail without mutating input', () => {
  for (const input of [null, [], {}, {...request(), unknown: true}]) assert.throws(() => circularArrayReferenceLayout(input));
  for (const axis of ['', 'Z', 'local', null, 2]) assert.throws(() => make({axis}), {code:'invalid-reference-circular-array'});
  for (const step_deg of [null, '90', NaN, Infinity, 0, -0, 360, -360, 900]) assert.throws(() => make({step_deg}), {code:'invalid-reference-circular-array'});
  for (const count of [null, '4', 1, 2.5, 16, 17, Infinity]) assert.throws(() => make({count}), {code:'invalid-reference-circular-array'});
  for (const pivot_mm of [null, [], [0,0], [0,0,0,0], ['0',0,0], [NaN,0,0], [Infinity,0,0], [1e9+1,0,0]]) assert.throws(() => make({pivot_mm}), {code:'invalid-reference-circular-array'});
  assert.throws(() => make({instance_id:'missing'}), /existing/);
  const input = request(); input.pivot_mm = [1e9,0,0]; input.step_deg = 180;
  const unchanged = structuredClone(input); assert.throws(() => circularArrayReferenceLayout(input), /coordinate exceeds/); assert.deepEqual(input, unchanged);
  const large = request(); large.layout.instances[1].source.text += '#'+ 'x'.repeat(399000);
  large.count = 7; const largeBefore = structuredClone(large);
  assert.throws(() => circularArrayReferenceLayout(large), /2000000/); assert.deepEqual(large, largeBefore);
});

test('actual CLI saves all formats, reopens for editing, and retains every no-clobber or malformed-input attempt', async () => {
  const dir = await workdir(), cli = new URL('../bin/moonmold-reference-circular-array.mjs', import.meta.url).pathname;
  let sequence = 0;
  const run = async (script, args) => {
    const result = spawnSync(process.execPath, [script,...args], {encoding:'utf8'});
    await writeFile(path.join(dir, `attempt-${++sequence}.json`), JSON.stringify({script,args,status:result.status,stdout:result.stdout,stderr:result.stderr},null,2));
    return result;
  };
  const args = ['--input',fixture('reference-circular-array.layout.json').pathname,'--instance','panel','--axis','z','--pivot-mm','10,20,5','--step-deg','90','--count','4'];
  const expected = make();
  for (const format of ['layout','json','obj','stl']) {
    const output = path.join(dir, `radial.${format}`), extra = ['--format',format,'--output',output];
    const good = await run(cli,[...args,...extra]); assert.equal(good.status,0,good.stderr);
    const bytes = await readFile(output,'utf8'); assert.equal(bytes,format==='json' ? JSON.stringify(expected,null,2)+'\n' : expected.exports[format]);
    const again = await run(cli,[...args,...extra]); assert.equal(again.status,1); assert.match(again.stderr,/EEXIST/); assert.equal(await readFile(output,'utf8'),bytes);
  }
  const saved = JSON.parse(await readFile(path.join(dir,'radial.layout'),'utf8')); saved.instances[2].transform.translation_mm[2] += 7;
  const edit = path.join(dir,'edited.layout.json'); await writeFile(edit,JSON.stringify(saved,null,2)+'\n');
  const reopen = await run(new URL('../bin/moonmold-reference-layout.mjs', import.meta.url).pathname,['--input',edit,'--format','json']);
  assert.equal(reopen.status,0,reopen.stderr); assert.equal(JSON.parse(reopen.stdout).geometry_sha256,composeReferenceLayout(saved).geometry_sha256);
  for (const extra of [['--format','svg'],['--count','3'],['--script','x'],['--output']]) assert.equal((await run(cli,[...args,...extra])).status,1);
  for (const [flag,value] of [['--step-deg','0x5a'],['--step-deg','1e999'],['--count','4.5'],['--pivot-mm','1,,3'],['--axis','q']]) {
    const bad = [...args]; bad[bad.indexOf(flag)+1] = value; assert.equal((await run(cli,bad)).status,1);
  }
  const decimal = [...args]; decimal[decimal.indexOf('--step-deg')+1] = '-9e1'; assert.equal((await run(cli,decimal)).status,0);
  for (const [name,data] of [['utf8',Buffer.from([255])],['syntax','{broken']]) {
    const file = path.join(dir,name), output = `${file}.out`; await writeFile(file,data);
    assert.equal((await run(cli,['--input',file,...args.slice(2),'--output',output])).status,1); await assert.rejects(access(output));
  }
});
