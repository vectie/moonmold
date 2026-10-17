import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureReferenceSurfaceArea, SURFACE_AREA_COLUMNS } from './reference-surface-area.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceGlbLayout } from './reference-glb-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const layout = JSON.parse(await readFile(fixture('reference-surface-area.layout.json'), 'utf8'));
const copy = value => structuredClone(value);
const measure = (value = layout, instance_ids = value.instances.map(item => item.id)) => measureReferenceSurfaceArea({ layout: value, instance_ids });
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} should equal ${b}`);
const vectorNear = (a, b) => a.forEach((n, axis) => near(n, b[axis]));
const one = (source, transform) => ({ contract_id: layout.contract_id, name: 'one-reference', instances: [{ id: 'part', source, ...(transform ? { transform } : {}) }] });
const triangle = { input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 4 0 0\nv 0 3 0\nf 1 2 3\n' };

// Literal geometry expectations are independent of the implementation's formula.
test('mixed-unit scaled panels produce a source-bound 1850 mm2 schedule without changing the layout', () => {
  const input = copy(layout), before = copy(input), result = measure(input), composed = composeReferenceLayout(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.parts.map(part => part.triangle_sum_area_mm2), [200, 1350, 300]);
  assert.equal(result.total.triangle_sum_area_mm2, 1850); assert.equal(result.total.triangle_sum_area_m2, 0.00185);
  vectorNear(result.parts[0].surface_centroid_mm, [10, 5, 0]);
  vectorNear(result.parts[1].surface_centroid_mm, [122.5, 20, 20]);
  vectorNear(result.parts[2].surface_centroid_mm, [-30, 20 / 3, 0]);
  vectorNear(result.total.surface_centroid_mm, [158375 / 1850, 30000 / 1850, 27000 / 1850]);
  assert.equal(result.total.triangle_count, 5);
  assert.equal(result.layout_sha256, composed.layout_sha256); assert.equal(result.geometry_sha256, composed.geometry_sha256);
  assert.equal(result.physical_authority, false);
  result.parts.forEach((part, i) => {
    assert.equal(part.source_sha256, composed.parts[i].source_sha256);
    assert.deepEqual(part.transform, composed.parts[i].transform);
    assert.deepEqual(part.triangle_range, composed.parts[i].triangle_range);
  });
  assert.deepEqual(result.parts[2].part_ids, ['object-1']);
  assert.doesNotMatch(result.exports.json, /source\.text|"text"|data_base64/);
});

test('chosen parts use layout order and exclude offcuts and unreferenced vertices', () => {
  const result = measure(layout, ['selected-bracket', 'base']);
  assert.deepEqual(result.instance_ids, ['base', 'selected-bracket']);
  assert.equal(result.instance_count, 2); assert.equal(result.layout_instance_count, 3);
  assert.equal(result.total.triangle_sum_area_mm2, 500);
  assert.deepEqual(measure(layout, ['base', 'selected-bracket']), result);
  const changed = copy(layout); changed.instances[0].source.text = changed.instances[0].source.text.replace('v 99 99 99\n', '');
  assert.equal(measure(changed).parts[0].triangle_sum_area_mm2, 200);
  assert.notEqual(measure(changed).layout_sha256, result.layout_sha256);
});

test('rigid placement preserves area; uniform scale squares area; centroid follows the actual composed placement', () => {
  const original = measure(one(triangle)); assert.equal(original.total.triangle_sum_area_mm2, 6);
  const transformed = one(triangle, { scale: 2.5, rotation_deg: [25, -40, 70], center_and_ground: true, translation_mm: [70, -90, 120] });
  const result = measure(transformed), composed = composeReferenceLayout(transformed);
  near(result.total.triangle_sum_area_mm2, 37.5);
  vectorNear(result.total.surface_centroid_mm, [0, 1, 2].map(axis => composed.vertices.reduce((sum, point) => sum + point[axis], 0) / 3));
  const translated = copy(transformed); translated.instances[0].transform.translation_mm = [80, -70, 150];
  const moved = measure(translated);
  near(moved.total.triangle_sum_area_mm2, result.total.triangle_sum_area_mm2);
  vectorNear(moved.total.surface_centroid_mm, result.total.surface_centroid_mm.map((n, axis) => n + [10, 20, 30][axis]));
});

test('duplicate, reversed and coincident faces count separately, without exterior union or inferred second sides', () => {
  const source = { ...triangle, text: triangle.text + 'f 3 2 1\n' };
  const duplicated = one(source); duplicated.instances.push({ id: 'overlap', source: copy(source) });
  const result = measure(duplicated);
  assert.deepEqual(result.parts.map(part => part.triangle_sum_area_mm2), [12, 12]);
  assert.equal(result.total.triangle_sum_area_mm2, 24);
  assert.equal(measure(one(triangle)).total.triangle_sum_area_mm2, 6);
  assert.match(result.qualification, /Not exposed exterior area/);
  assert.match(result.limitations.join(' '), /Duplicate, overlapping, internal and coincident/);
});

test('binary STL, binary PLY and imported GLB selections measure through ordinary layout composition', async () => {
  const stl = one({ input_format: 'stl', units: 'in', data_base64: (await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') });
  const ply = one({ input_format: 'ply', units: 'mm', data_base64: (await readFile(fixture('reference-tetrahedron-be.ply'))).toString('base64') });
  // Fixtures both contain the axis tetrahedron with intercepts 2, 3 and 4; the STL uses inch conversion.
  near(measure(ply).total.triangle_sum_area_mm2, 13 + Math.sqrt(61));
  near(measure(stl).total.triangle_sum_area_mm2, (13 + Math.sqrt(61)) * 25.4 ** 2);
  const imported = importReferenceGlbLayout({ name: 'scene', data_base64: (await readFile(fixture('reference-scene.glb'))).toString('base64') });
  const first = measure(imported.layout), reopened = measure(JSON.parse(composeReferenceLayout(imported.layout).exports.layout));
  assert.deepEqual(first, reopened); assert.equal(first.parts.length, 2);
  first.parts.forEach((part, i) => assert.deepEqual(part.node_ids, imported.layout.instances[i].source.node_ids));
  assert.ok(first.total.triangle_sum_area_mm2 > 0);
});

test('report and CSV reopen consistently; later edits require a new exact-layout observation', () => {
  const first = measure(), { exports, ...report } = first;
  assert.deepEqual(JSON.parse(exports.json), report);
  const rows = exports.csv.trim().split('\r\n').map(row => row.split(','));
  assert.deepEqual(rows.shift(), [...SURFACE_AREA_COLUMNS]);
  rows.forEach((row, i) => {
    const values = Object.fromEntries(SURFACE_AREA_COLUMNS.map((column, j) => [column, row[j]]));
    assert.equal(values.layout_sha256, first.layout_sha256);
    assert.equal(values.geometry_sha256, first.geometry_sha256);
    assert.equal(values.source_sha256, first.parts[i].source_sha256);
    assert.equal(Number(values.triangle_sum_area_mm2), first.parts[i].triangle_sum_area_mm2);
    assert.equal(Number(values.surface_centroid_x_mm), first.parts[i].surface_centroid_mm[0]);
    assert.equal(values.physical_authority, 'false');
  });
  assert.equal(rows.reduce((sum, row) => sum + Number(row[SURFACE_AREA_COLUMNS.indexOf('triangle_sum_area_mm2')]), 0), first.total.triangle_sum_area_mm2);
  const reopened = JSON.parse(composeReferenceLayout(layout).exports.layout); assert.deepEqual(measure(reopened), first);
  reopened.instances[0].transform.scale = 2;
  const edited = measure(reopened); assert.equal(edited.parts[0].triangle_sum_area_mm2, 800);
  assert.notEqual(edited.layout_sha256, first.layout_sha256); assert.notEqual(edited.geometry_sha256, first.geometry_sha256);
  assert.deepEqual(edited.parts[1], first.parts[1]); assert.deepEqual(measure(), first);
  const comment = copy(layout); comment.instances[2].source.text += '# revised provenance\n';
  const selected = measure(layout, ['base']), after = measure(comment, ['base']);
  assert.notEqual(after.layout_sha256, selected.layout_sha256); assert.equal(after.geometry_sha256, selected.geometry_sha256);
});

test('empty or stale instance choices and collapsed triangles reject rather than fabricate a schedule', () => {
  const snapshot = copy(layout);
  for (const instance_ids of [[], ['unknown'], ['base', 'base'], null]) assert.throws(() => measureReferenceSurfaceArea({ layout, instance_ids }), { code: 'invalid-reference-surface-area' });
  assert.throws(() => measureReferenceSurfaceArea({ layout, instance_ids: ['base'], thickness: 2 }), /only layout and instance_ids/);
  const small = { ...triangle, text: 'v 0 0 0\nv 0.000001 0 0\nv 0 0.000001 0\nf 1 2 3\n' };
  assert.throws(() => measure(one(small, { scale: 0.000001, translation_mm: [999999000, 999999000, 999999000] })), /collapses a triangle/);
  assert.deepEqual(layout, snapshot);
});

test('CLI exports real files and stdout, reopens the editable source, and never replaces existing outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moonmold-area-files-'));
  const source = join(dir, 'panels.layout.json'), report = join(dir, 'area.json'), csv = join(dir, 'area.csv');
  await writeFile(source, composeReferenceLayout(layout).exports.layout);
  const sourceBefore = await readFile(source);
  const cli = new URL('../bin/moonmold-reference-area.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const args = ['--input', source];
  const all = run([...args, '--output', report]); assert.equal(all.status, 0, all.stderr);
  assert.equal(await readFile(report, 'utf8'), measure().exports.json);
  const selected = run([...args, '--instances', 'base,selected-bracket', '--format', 'csv', '--output', csv]); assert.equal(selected.status, 0, selected.stderr);
  assert.equal(await readFile(csv, 'utf8'), measure(layout, ['base', 'selected-bracket']).exports.csv);
  const stdout = run(args); assert.equal(stdout.status, 0); assert.equal(stdout.stdout, await readFile(report, 'utf8'));
  assert.equal(run([...args, '--output', source]).status, 1); assert.deepEqual(await readFile(source), sourceBefore);
  assert.equal(run([...args, '--output', report]).status, 1); assert.equal(await readFile(report, 'utf8'), stdout.stdout);
  const invalid = join(dir, 'bad.json'), absent = join(dir, 'absent.csv'); await writeFile(invalid, Buffer.from([0xff]));
  assert.equal(run(['--input', invalid, '--output', absent]).status, 1); await assert.rejects(access(absent));
  assert.equal(run([...args, '--instances', 'unknown', '--output', absent]).status, 1); await assert.rejects(access(absent));
  assert.equal(run([...args, '--format', 'obj']).status, 1); assert.equal(run([...args, '--input', source]).status, 1);
});

test('operator HTTP serves exact JSON/CSV observation and selectable page without persisting model state', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'moonmold-area-http-'));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = input => fetch(`${base}/api/reference-layout/surface-area`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const response = await request({ layout, instance_ids: ['upright'] }); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), measure(layout, ['upright']));
  assert.equal((await request({ layout, instance_ids: ['removed'] })).status, 400);
  const html = await (await fetch(`${base}/reference-layout`)).text();
  assert.match(html, /Calculate measurement schedule/); assert.match(html, /id="surface-area-targets" multiple/);
  assert.match(html, /id="measurement-mode"/); assert.match(html, /Algebraic closed-shell volume and centroid/);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr); assert.deepEqual(await readdir(workspace), []);
});
