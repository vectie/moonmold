import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extrudeReferenceProfile, EXTRUSION_CONTRACT } from './reference-extrusion.mjs';
import { canonicalJson } from './protocol.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-extrusion.profile.json', import.meta.url);
const recipe = JSON.parse(await readFile(fixture, 'utf8'));
const root = process.env.MOONMOLD_EXTRUSION_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-extrusion-tests');
await mkdir(root, { recursive: true });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function geometryOracle(result, area, height) {
  const edges = new Map(); let volume = 0, topArea = 0, bottomArea = 0;
  for (const [index, face] of result.triangles.entries()) {
    const [a, b, c] = face.map(i => result.vertices[i]), normal = cross(b.map((v, i) => v - a[i]), c.map((v, i) => v - a[i]));
    assert.ok(Math.hypot(...normal) > 0);
    const [va, vb, vc] = [a, b, c].map(p => p.map((v, i) => v - result.vertices[0][i]));
    volume += va.reduce((sum, v, i) => sum + v * cross(vb, vc)[i], 0) / 6;
    const lineage = result.extrusion.triangle_lineage[index];
    if (lineage.kind === 'top') { assert.ok(normal[2] > 0); topArea += normal[2] / 2; assert.ok([a, b, c].every(p => p[2] === height)); }
    else if (lineage.kind === 'bottom') { assert.ok(normal[2] < 0); bottomArea -= normal[2] / 2; assert.ok([a, b, c].every(p => p[2] === 0)); }
    else {
      const [start, end] = lineage.profile_edge.map(i => result.vertices[i]);
      assert.ok(normal[0] * (end[1] - start[1]) - normal[1] * (end[0] - start[0]) > 0, 'side points outward from CCW boundary');
      assert.ok(normal[2] === 0);
    }
    for (let j = 0; j < 3; j++) { const x = face[j], y = face[(j + 1) % 3], key = [Math.min(x, y), Math.max(x, y)].join(','); if (!edges.has(key)) edges.set(key, []); edges.get(key).push(x < y ? 1 : -1); }
  }
  for (const uses of edges.values()) { assert.equal(uses.length, 2, 'closed indexed mesh'); assert.equal(uses[0] + uses[1], 0, 'consistent directed edges'); }
  near(topArea, area); near(bottomArea, area); near(volume, area * height);
}

test('concave profile becomes capped geometry with outward normals and exact editable lineage', () => {
  const original = structuredClone(recipe), result = extrudeReferenceProfile(recipe);
  assert.deepEqual(recipe, original); assert.deepEqual(result.bounds, { min: [0, 0, 0], max: [40, 30, 8], size: [40, 30, 8] });
  assert.equal(result.vertex_count, 12); assert.equal(result.triangle_count, 20); assert.equal(result.extrusion.profile_area_mm2, 700);
  geometryOracle(result, 700, 8);
  assert.equal(result.extrusion.recipe_sha256, createHash('sha256').update(canonicalJson(recipe)).digest('hex'));
  assert.equal(result.extrusion.layout_sha256, result.layout_sha256); assert.equal(result.extrusion.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(JSON.parse(result.exports.recipe), recipe); assert.match(result.layout.instances[0].source.text, new RegExp(result.extrusion.recipe_sha256));
  assert.equal(result.physical_authority, false); assert.equal(result.extrusion.physical_authority, false);
  assert.equal(result.layout.instances[0].source.units, 'mm');
});

test('clockwise input retains authored point order in recipe and normalizes output winding', () => {
  const cw = { ...recipe, vertices: [...recipe.vertices].reverse() }, result = extrudeReferenceProfile(cw);
  assert.equal(result.extrusion.source_winding, 'clockwise'); assert.deepEqual(result.extrusion.recipe.vertices, cw.vertices);
  geometryOracle(result, 700, 8); assert.deepEqual(result, extrudeReferenceProfile(JSON.parse(result.exports.recipe)));
});

test('deep U-shaped concavity does not get filled by a naive triangle fan', () => {
  const result = extrudeReferenceProfile({ ...recipe, vertices: [[0, 0], [8, 0], [8, 8], [6, 8], [6, 2], [2, 2], [2, 8], [0, 8]], height: 3 });
  geometryOracle(result, 40, 3);
  for (const [i, face] of result.triangles.entries()) if (result.extrusion.triangle_lineage[i].kind === 'top') {
    const center = [0, 1].map(a => face.reduce((sum, v) => sum + result.vertices[v][a], 0) / 3);
    assert.ok(!(center[0] > 2 && center[0] < 6 && center[1] > 2), 'cap centroid cannot lie in the U opening');
  }
});

test('all explicit unit choices scale XY and height consistently and edited height rebuilds from the profile', () => {
  for (const [units, factor] of Object.entries({ mm: 1, cm: 10, m: 1000, in: 25.4 })) {
    const result = extrudeReferenceProfile({ ...recipe, units }); geometryOracle(result, 700 * factor * factor, 8 * factor);
    near(result.bounds.size[0], 40 * factor); assert.equal(result.extrusion.recipe.units, units);
  }
  const first = extrudeReferenceProfile(recipe), edited = extrudeReferenceProfile({ ...JSON.parse(first.exports.recipe), height: 12 });
  assert.notEqual(first.geometry_sha256, edited.geometry_sha256); assert.notEqual(first.extrusion.recipe_sha256, edited.extrusion.recipe_sha256);
  geometryOracle(edited, 700, 12); assert.deepEqual(first.extrusion.recipe, recipe);
});

test('triangle, maximum point ring, translated profile and minimum height remain nondegenerate', () => {
  const triangle = extrudeReferenceProfile({ ...recipe, vertices: [[0, 0], [5, 0], [0, 4]], height: 1e-6 }); geometryOracle(triangle, 10, 1e-6);
  const vertices = Array.from({ length: 128 }, (_, i) => [Math.cos(i * Math.PI / 64) * 100, Math.sin(i * Math.PI / 64) * 100]);
  const maximum = extrudeReferenceProfile({ ...recipe, vertices }); geometryOracle(maximum, 64 * 10000 * Math.sin(Math.PI / 64), 8);
  const translated = extrudeReferenceProfile({ ...recipe, vertices: recipe.vertices.map(([x, y]) => [x + 900000, y - 900000]) }); geometryOracle(translated, 700, 8);
});

test('unsupported schema, ambiguous units/frame and nonfinite or out-of-range dimensions reject', () => {
  for (const patch of [{ contract_id: 'other' }, { script: 'print(1)' }, { name: '../file' }, { units: null }, { units: 'meters' }, { coordinate_frame: 'y-up' }, { height: 0 }, { height: -1 }, { height: '8' }, { height: Infinity }, { height: NaN }, { height: 1e7 }, { height: 1e-8 }, { vertices: [] }, { vertices: [[0, 0, 0], [1, 0], [0, 1]] }, { vertices: [[0, 0], [Infinity, 1], [2, 0]] }, { vertices: [[0, 0], [1e6 + 1, 1], [2, 0]] }, { vertices: Array(129).fill([0, 0]) }]) assert.throws(() => extrudeReferenceProfile({ ...recipe, ...patch }), error => error.code === 'invalid-reference-extrusion');
  for (const field of Object.keys(recipe)) { const incomplete = { ...recipe }; delete incomplete[field]; assert.throws(() => extrudeReferenceProfile(incomplete)); }
  for (const invalid of [null, [], 'recipe']) assert.throws(() => extrudeReferenceProfile(invalid));
});

test('crossings, nonadjacent touches, closing repetition, collinear and near-collinear corners reject', () => {
  for (const vertices of [
    [[0, 0], [4, 4], [0, 4], [4, 0]],
    [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]],
    [[0, 0], [4, 0], [4, 4], [0, 0]],
    [[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]],
    [[0, 0], [2, 1e-14], [4, 0], [4, 4], [0, 4]],
  ]) assert.throws(() => extrudeReferenceProfile({ ...recipe, vertices }), /intersect|touch|Repeated|Collinear/);
});

test('strict shallow crossings are rejected even inside the scale-relative orientation band', () => {
  assert.throws(() => extrudeReferenceProfile({ ...recipe, vertices: [[-1, 0], [1, 0], [1000000, 1000000], [0, -0.0001], [0, 0.0001], [-1000000, 1000000]] }), /edges intersect/);
});

test('OBJ, STL, layout and existing volume, GLB and drawing consumers use the emitted geometry', () => {
  const result = extrudeReferenceProfile(recipe), layout = JSON.parse(result.exports.layout);
  assert.equal(composeReferenceLayout(layout).geometry_sha256, result.geometry_sha256);
  for (const input_format of ['obj', 'stl']) {
    const imported = importReferenceMesh({ input_format, units: 'mm', text: result.exports[input_format] });
    assert.deepEqual(imported.bounds, result.bounds); assert.equal(imported.triangle_count, result.triangle_count);
  }
  const volume = measureReferenceVolume({ layout, instance_ids: [recipe.name] });
  near(volume.shell_sum_volume_mm3, 5600); assert.equal(volume.parts[0].components[0].winding, 'positive');
  assert.deepEqual(volume.parts[0].topology, { boundary_edges: 0, nonmanifold_edges: 0, inconsistent_edges: 0, matching: 'exact-placed-coordinate-edges; no tolerance or source repair' });
  assert.equal(exportReferenceLayoutGlb(layout).readUInt32LE(0), 0x46546c67); assert.match(drawReferenceLayout(layout).exports.svg, /<svg/);
});

test('actual CLI creates new portable files, reopens profile and refuses overwrites/malformed UTF-8', async () => {
  const dir = await mkdtemp(path.join(root, 'cli-')), cli = new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  for (const format of ['layout', 'recipe', 'json', 'obj', 'stl']) {
    const file = path.join(dir, format), execution = run(['--input', fixture.pathname, '--format', format, '--output', file]);
    assert.equal(execution.status, 0, execution.stderr); const text = await readFile(file, 'utf8'); assert.ok(text.length > 0);
    if (format === 'recipe') assert.deepEqual(extrudeReferenceProfile(JSON.parse(text)).geometry_sha256, extrudeReferenceProfile(recipe).geometry_sha256);
    if (['obj', 'stl'].includes(format)) assert.deepEqual(importReferenceMesh({ input_format: format, units: 'mm', text }).bounds.size, [40, 30, 8]);
    assert.equal(run(['--input', fixture.pathname, '--format', format, '--output', file]).status, 1); assert.equal(await readFile(file, 'utf8'), text);
  }
  const bad = path.join(dir, 'invalid.json'); await writeFile(bad, Buffer.from([0xff])); assert.equal(run(['--input', bad]).status, 1);
  const large = path.join(dir, 'large.json'); await writeFile(large, ' '.repeat(32001)); assert.match(run(['--input', large]).stderr, /32000/);
  assert.equal(run(['--input', dir]).status, 1); assert.equal(run(['--input', fixture.pathname, '--format', 'gcode']).status, 1);
});

test('operator serves the usable page, accepts profile and rejects invalid/oversized requests over real HTTP', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'http-')), server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve))); const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/reference-profile'); assert.equal(page.status, 200); assert.match(await page.text(), /Build reference mesh/);
  const call = body => fetch(base + '/api/reference-profile/extrude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await call(recipe); assert.equal(response.status, 200); assert.equal((await response.json()).geometry_sha256, extrudeReferenceProfile(recipe).geometry_sha256);
  const bad = await call({ ...recipe, height: -1 }); assert.equal(bad.status, 400); assert.match((await bad.json()).message, /height/);
  const oversized = await call({ ...recipe, padding: 'x'.repeat(32000) }); assert.equal(oversized.status, 400);
});
