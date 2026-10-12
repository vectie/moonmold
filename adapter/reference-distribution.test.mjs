import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { distributeReferenceLayout } from './reference-distribution.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const seed = JSON.parse(await readFile(new URL('../fixtures/reference-distribution.layout.json', import.meta.url), 'utf8'));
const request = () => ({ layout: structuredClone(seed), instance_ids: ['left', 'wide', 'tall', 'right'], axis: 'x' });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function assertRetained(before, result, ids, axis) {
  const index = ['x', 'y', 'z'].indexOf(axis), moving = new Set(ids.slice(1, -1));
  assert.deepEqual(result.layout.instances.map(item => item.id), before.layout.instances.map(item => item.id));
  for (let i = 0; i < before.parts.length; i++) {
    const old = before.layout.instances[i], next = result.layout.instances[i];
    assert.deepEqual(next.source, old.source);
    assert.equal(result.parts[i].source_sha256, before.parts[i].source_sha256);
    if (!moving.has(old.id)) assert.deepEqual(next, old);
    else {
      const restored = structuredClone(next);
      restored.transform.translation_mm[index] = old.transform.translation_mm[index];
      assert.deepEqual(restored, old);
    }
    const delta = next.transform.translation_mm[index] - old.transform.translation_mm[index];
    for (let j = 0; j < before.parts[i].vertex_range.count; j++) {
      const vertex = before.parts[i].vertex_range.start + j;
      for (let a = 0; a < 3; a++) near(result.vertices[vertex][a], before.vertices[vertex][a] + (a === index ? delta : 0));
    }
  }
}

test('unequal mixed-unit panels get literal equal 20 mm projected gaps with fixed endpoints and source lineage', () => {
  const input = request(), snapshot = structuredClone(input), before = composeReferenceLayout(input.layout);
  const result = distributeReferenceLayout(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result.parts.map(part => part.bounds.min[0]), [0, 30, 70, 120, 45]);
  assert.deepEqual(result.parts.map(part => part.bounds.max[0]), [10, 50, 100, 130, 50]);
  assert.equal(result.distribution.target_gap_mm, 20);
  assert.deepEqual(result.distribution.gaps.map(gap => gap.actual_gap_mm), [20, 20, 20]);
  assert.deepEqual(result.distribution.instances.map(item => item.translation_delta_mm), [0, -57, 58, 0]);
  assertRetained(before, result, input.instance_ids, input.axis);
  assert.equal(result.distribution.parent_layout_sha256, before.layout_sha256);
  assert.equal(result.distribution.parent_geometry_sha256, before.geometry_sha256);
  assert.equal(result.distribution.layout_sha256, result.layout_sha256);
  assert.equal(result.distribution.geometry_sha256, result.geometry_sha256);
  assert.equal(result.physical_authority, false);
  assert.equal(result.distribution.physical_authority, false);
  assert.match(result.distribution.semantics, /Unchosen placements stay fixed/);
});

test('explicit selection order controls the arrangement without changing layout order or unchosen references', () => {
  const input = request(); input.instance_ids = ['left', 'tall', 'wide', 'right'];
  const before = composeReferenceLayout(input.layout), result = distributeReferenceLayout(input);
  assert.deepEqual(result.parts.map(part => part.bounds.min[0]), [0, 80, 30, 120, 45]);
  assert.deepEqual(result.distribution.instance_ids, input.instance_ids);
  assertRetained(before, result, input.instance_ids, input.axis);
  const subset = distributeReferenceLayout({ ...request(), instance_ids: ['left', 'wide', 'right'] });
  assert.equal(subset.parts[1].bounds.min[0], 55);
  assert.deepEqual(subset.parts[2], before.parts[2]);
});

test('placed bounds honor rotated, scaled and grounded originals on each world axis', () => {
  for (const [axisIndex, axis] of ['x', 'y', 'z'].entries()) {
    const input = request(); input.axis = axis;
    for (const [index, item] of input.layout.instances.entries()) {
      item.transform = { scale: 0.6 + index * 0.2, rotation_deg: [25, -30, 40], center_and_ground: true, translation_mm: [15, 25, 35] };
    }
    input.layout.instances[0].transform.translation_mm[axisIndex] = -200;
    input.layout.instances[3].transform.translation_mm[axisIndex] = 300;
    const before = composeReferenceLayout(input.layout), result = distributeReferenceLayout(input);
    const expected = (before.parts[3].bounds.min[axisIndex] - before.parts[0].bounds.max[axisIndex] - before.parts[1].bounds.size[axisIndex] - before.parts[2].bounds.size[axisIndex]) / 3;
    near(result.distribution.target_gap_mm, expected);
    for (const gap of result.distribution.gaps) { near(gap.actual_gap_mm, expected); near(gap.residual_mm, 0); }
    assertRetained(before, result, input.instance_ids, axis);
  }
});

test('selected OBJ parts and binary PLY original bytes survive distribution and independent later editing', async () => {
  const input = request();
  input.layout.instances[1].source = { input_format: 'obj', units: 'mm', text: 'o panel\nv 0 0 0\nv 20 0 0\nv 0 10 0\nf 1 2 3\no omit\nv 500 0 0\nv 501 0 0\nv 500 1 0\nf 4 5 6\n', part_ids: ['object-1'] };
  input.layout.instances[2].source = { input_format: 'ply', units: 'mm', data_base64: (await readFile(new URL('../fixtures/reference-tetrahedron-be.ply', import.meta.url))).toString('base64') };
  const before = composeReferenceLayout(input.layout), result = distributeReferenceLayout(input);
  assertRetained(before, result, input.instance_ids, input.axis);
  assert.deepEqual(result.layout.instances[1].source.part_ids, ['object-1']);
  assert.deepEqual(result.parts[1].triangle_source_faces, before.parts[1].triangle_source_faces);
  const saved = JSON.parse(result.exports.layout), reopened = composeReferenceLayout(saved);
  assert.equal(reopened.layout_sha256, result.layout_sha256);
  assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(reopened.exports, result.exports);
  saved.instances[1].transform.translation_mm[0] += 7;
  const edited = composeReferenceLayout(saved);
  assert.deepEqual(edited.parts[2], result.parts[2]);
  near(edited.parts[1].bounds.min[0], result.parts[1].bounds.min[0] + 7);
  assert.notEqual(edited.layout_sha256, result.distribution.layout_sha256);
});

test('zero-gap packing is allowed; insufficient endpoint span rejects the whole edit without mutation', () => {
  const input = request(); input.layout.instances[3].transform.translation_mm[0] = 60;
  const result = distributeReferenceLayout(input);
  assert.equal(result.distribution.target_gap_mm, 0);
  assert.deepEqual(result.distribution.gaps.map(gap => gap.actual_gap_mm), [0, 0, 0]);
  input.layout.instances[3].transform.translation_mm[0] = 59;
  const snapshot = structuredClone(input);
  assert.throws(() => distributeReferenceLayout(input), /insufficient space/);
  assert.deepEqual(input, snapshot);
  assert.throws(() => distributeReferenceLayout({ ...request(), instance_ids: ['right', 'wide', 'left'] }), /insufficient space/);
});

test('bound spacing includes retained orphan vertices and reports gaps rather than surface clearance', () => {
  const input = request();
  input.layout.instances[1].source = { input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 5 0 0\nv 0 1 0\nv 20 50 50\nf 1 2 3\n' };
  const result = distributeReferenceLayout(input);
  assert.equal(result.distribution.interior_total_width_mm, 50);
  assert.equal(result.distribution.target_gap_mm, 20);
  assert.equal(result.parts[1].bounds.max[0], 50);
  assert.match(result.distribution.limits.join(' '), /not surface distances/);
});

test('same source and requested order reproduce byte-identical output; repeating the applied fixture is a no-op', () => {
  const result = distributeReferenceLayout(request());
  assert.deepEqual(distributeReferenceLayout(request()), result);
  const repeated = distributeReferenceLayout({ ...request(), layout: result.layout });
  assert.equal(repeated.layout_sha256, result.layout_sha256);
  assert.equal(repeated.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(repeated.distribution.instances.map(item => item.translation_delta_mm), [0, 0, 0, 0]);
});

test('complete CLI inspection, save, reopen and derived export journey preserves input and refuses overwrite', async () => {
  const dir = await mkdtemp(join(process.env.MOONMOLD_DISTRIBUTION_TEST_ROOT ?? tmpdir(), 'moonmold-distribution-'));
  const source = join(dir, 'source.layout.json'), output = join(dir, 'distributed.layout.json'), report = join(dir, 'distributed.report.json');
  const original = JSON.stringify(seed); await writeFile(source, original);
  const run = (script, args) => spawnSync(process.execPath, [join(root, 'bin', script), ...args], { encoding: 'utf8', cwd: dir });
  const args = ['--input', source, '--instances', 'left,wide,tall,right', '--axis', 'x'];
  const inspect = run('moonmold-reference-distribute.mjs', [...args, '--format', 'json', '--output', report]);
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspected = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(inspected.distribution.target_gap_mm, 20);
  const save = run('moonmold-reference-distribute.mjs', [...args, '--output', output]);
  assert.equal(save.status, 0, save.stderr);
  assert.equal(await readFile(output, 'utf8'), inspected.exports.layout);
  const reopen = run('moonmold-reference-layout.mjs', ['--input', output, '--format', 'json']);
  assert.equal(reopen.status, 0, reopen.stderr);
  assert.equal(JSON.parse(reopen.stdout).geometry_sha256, inspected.geometry_sha256);
  for (const format of ['obj', 'stl']) {
    const exported = run('moonmold-reference-distribute.mjs', [...args, '--format', format]);
    assert.equal(exported.status, 0, exported.stderr);
    const mesh = importReferenceMesh({ input_format: format, text: exported.stdout, units: 'mm' });
    assert.equal(mesh.triangle_count, inspected.triangle_count);
    mesh.bounds.min.forEach((value, i) => near(value, inspected.bounds.min[i]));
    mesh.bounds.max.forEach((value, i) => near(value, inspected.bounds.max[i]));
  }
  const clash = run('moonmold-reference-distribute.mjs', [...args, '--output', output]);
  assert.notEqual(clash.status, 0); assert.match(clash.stderr, /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), inspected.exports.layout);
  assert.equal(await readFile(source, 'utf8'), original);
  const invalidOutput = join(dir, 'invalid.layout.json');
  const invalid = run('moonmold-reference-distribute.mjs', [...args, '--axis', 'z', '--output', invalidOutput]);
  assert.notEqual(invalid.status, 0);
  assert.ok(!(await readdir(dir)).includes('invalid.layout.json'));
  console.log('Retained distribution journey:', dir);
});

test('request mistakes fail before any input mutation', () => {
  for (const input of [null, {}, { ...request(), extra: 1 }, { ...request(), axis: 'X' },
    { ...request(), instance_ids: ['left', 'right'] }, { ...request(), instance_ids: ['left', 'wide', 'wide', 'right'] },
    { ...request(), instance_ids: ['left', 'absent', 'right'] }]) {
    const before = structuredClone(input);
    assert.throws(() => distributeReferenceLayout(input));
    assert.deepEqual(input, before);
  }
});
