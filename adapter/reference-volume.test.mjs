import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measureReferenceVolume } from './reference-volume.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL('../fixtures/' + name, import.meta.url);
const layout = JSON.parse(await readFile(fixture('reference-volume.layout.json'), 'utf8'));
const measure = (value = layout, ids = value.instances.map(i => i.id)) => measureReferenceVolume({ layout: value, instance_ids: ids });
const one = (source, transform) => ({ contract_id: 'moonmold.reference-layout.v1', name: 'test-volume', instances: [{ id: 'part', source, ...(transform ? { transform } : {}) }] });
const near = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-10, `${a} != ${b}`);

test('mixed closed, reversed and open references retain per-part results and no invented overall total', () => {
  const result = measure();
  assert.equal(result.parts[0].shell_sum_volume_mm3, 4000);
  assert.deepEqual(result.parts[0].volume_centroid_mm, [5, 7.5, 10]);
  assert.equal(result.parts[1].shell_sum_volume_mm3, 32);
  assert.equal(result.parts[1].components[0].signed_volume_mm3, -32);
  assert.deepEqual(result.parts[1].volume_centroid_mm, [101, -18.5, 32]);
  assert.equal(result.parts[2].status, 'unavailable-topology');
  assert.equal(result.parts[2].topology.boundary_edges, 3);
  assert.equal(result.shell_sum_volume_mm3, null);
  assert.equal(result.physical_authority, false);
  assert.deepEqual(measure(), result);
  assert.equal(measure(layout, ['reversed-tetra', 'tetra-cm']).shell_sum_volume_mm3, 4032);
});

test('rotation translation and scale preserve analytic tetrahedron volume and volume centroid', () => {
  const source = layout.instances[0].source;
  const result = measure(one(source, { scale: 3, rotation_deg: [20, -35, 78], translation_mm: [1e6, -2e6, 3e6] }));
  near(result.shell_sum_volume_mm3, 108000);
  const composed = composeReferenceLayout(one(source, { scale: 3, rotation_deg: [20, -35, 78], translation_mm: [1e6, -2e6, 3e6] }));
  result.parts[0].volume_centroid_mm.forEach((n, axis) => near(n, composed.vertices.reduce((total, point) => total + point[axis], 0) / 4));
});

test('binary STL and binary PLY triangle sources use declared units and exact-position closure', async () => {
  for (const [name, input_format] of [['reference-tetrahedron-binary.stl', 'stl'], ['reference-tetrahedron-be.ply', 'ply']]) {
    const data_base64 = (await readFile(fixture(name))).toString('base64');
    const result = measure(one({ input_format, units: 'in', data_base64 }));
    near(result.shell_sum_volume_mm3, 4 * 25.4 ** 3);
    assert.equal(result.parts[0].components.length, 1);
    assert.equal(result.parts[0].topology.boundary_edges, 0);
  }
});

test('inconsistent winding and nonmanifold duplicate faces are unavailable without repair', () => {
  const source = structuredClone(layout.instances[0].source);
  source.text = source.text.replace('f 1 3 2', 'f 2 3 1');
  const reversed = measure(one(source));
  assert.equal(reversed.parts[0].status, 'unavailable-topology');
  assert.equal(reversed.parts[0].topology.inconsistent_edges, 3);
  source.text = layout.instances[0].source.text + 'f 1 3 2\n';
  const duplicate = measure(one(source));
  assert.equal(duplicate.parts[0].topology.nonmanifold_edges, 3);
  assert.equal(duplicate.shell_sum_volume_mm3, null);
});

test('nested or overlapping instances count separately with explicit no-union semantics', () => {
  const source = layout.instances[0].source, value = one(source);
  value.instances.push({ id: 'nested', source: structuredClone(source), transform: { scale: 0.5 } });
  assert.equal(measure(value).shell_sum_volume_mm3, 4500);
  value.instances[1].transform.scale = 1;
  assert.equal(measure(value).shell_sum_volume_mm3, 8000);
  assert.match(measure(value).qualification, /Not Boolean union, cavity-aware volume, mass/);
  assert.match(measure(value).limitations.join(' '), /no collision or self-intersection test/);
});

test('multiple disconnected shells in one source retain signed components and zero-volume closed sheets are unavailable', () => {
  const source = { input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 2 0 0\nv 0 3 0\nv 0 0 4\nv 10 0 0\nv 12 0 0\nv 10 3 0\nv 10 0 4\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4\nf 6 7 5\nf 8 6 5\nf 8 7 6\nf 8 5 7\n' };
  const result = measure(one(source));
  assert.equal(result.parts[0].components.length, 2);
  assert.deepEqual(result.parts[0].components.map(c => c.signed_volume_mm3), [4, -4]);
  assert.equal(result.shell_sum_volume_mm3, 8);
  assert.deepEqual(result.parts[0].volume_centroid_mm, [5.5, 0.75, 1]);
  const sheet = { input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3\nf 3 2 1\n' };
  assert.equal(measure(one(sheet)).parts[0].status, 'unavailable-zero-or-nonfinite-volume');
});

test('JSON CSV and saved editable source retain exact identity; edits require a distinct calculation', () => {
  const first = measure(), { exports, ...report } = first;
  assert.deepEqual(JSON.parse(exports.json), report);
  assert.match(exports.csv, /open-panel,unavailable-topology/);
  assert.doesNotMatch(exports.json, /"text"|data_base64/);
  assert.deepEqual(measure(JSON.parse(composeReferenceLayout(layout).exports.layout)), first);
  const changed = structuredClone(layout); changed.instances[0].transform = { scale: 2 };
  const next = measure(changed);
  assert.notEqual(first.layout_sha256, next.layout_sha256);
  assert.equal(next.parts[0].shell_sum_volume_mm3, 32000);
  for (const ids of [[], ['missing'], ['tetra-cm', 'tetra-cm']]) assert.throws(() => measure(layout, ids), { code: 'invalid-reference-volume' });
  assert.throws(() => measureReferenceVolume({ layout, instance_ids: ['tetra-cm'], density: 1 }), /only layout and instance_ids/);
});

test('actual loopback operator endpoint serves volume and rejects invalid selection', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'moonmold-volume-'));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = { layout, instance_ids: ['tetra-cm', 'reversed-tetra'] };
  const response = await fetch(base + '/api/reference-layout/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), measureReferenceVolume(input));
  const invalid = await fetch(base + '/api/reference-layout/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout, instance_ids: ['missing'] }) });
  assert.equal(invalid.status, 400);
});

test('existing measurement CLI selects volume JSON and CSV and refuses unknown modes', () => {
  const cli = new URL('../bin/moonmold-reference-area.mjs', import.meta.url).pathname;
  const input = fixture('reference-volume.layout.json').pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, '--input', input, ...args], { encoding: 'utf8' });
  const json = run('--measure', 'volume', '--instances', 'tetra-cm,reversed-tetra');
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).shell_sum_volume_mm3, 4032);
  const csv = run('--measure', 'volume', '--format', 'csv');
  assert.equal(csv.status, 0, csv.stderr);
  assert.equal(csv.stdout, measure().exports.csv);
  assert.match(csv.stdout, /contract_id,layout_sha256,geometry_sha256/);
  assert.equal(run('--measure', 'mass').status, 1);
});
