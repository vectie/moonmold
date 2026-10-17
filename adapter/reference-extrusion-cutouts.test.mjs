import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extrudeReferenceProfile, EXTRUSION_CUTOUT_CONTRACT } from './reference-extrusion.mjs';
import { canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { measureReferenceSurfaceArea } from './reference-surface-area.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-cutout.profile.json', import.meta.url);
const plate = JSON.parse(await readFile(fixture, 'utf8'));
const bracket = JSON.parse(await readFile(new URL('../fixtures/reference-cutout-bracket.profile.json', import.meta.url), 'utf8'));
const root = process.env.MOONMOLD_EXTRUSION_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-extrusion-tests');
await mkdir(root, { recursive: true });
const near = (value, expected) => assert.ok(Math.abs(value - expected) <= Math.max(1, Math.abs(expected)) * 1e-8, `${value} != ${expected}`);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function inside(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function oracle(result, expectedArea, expectedHeight) {
  const recipe = result.extrusion.recipe, factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[recipe.units];
  const outer = recipe.vertices.map(p => p.map(n => n * factor)), hole = recipe.cutout?.map(p => p.map(n => n * factor));
  const edges = new Map(); let top = 0, bottom = 0, volume = 0, innerWallTriangles = 0;
  for (const [index, face] of result.triangles.entries()) {
    const [a, b, c] = face.map(i => result.vertices[i]);
    const normal = cross(b.map((n, i) => n - a[i]), c.map((n, i) => n - a[i]));
    assert.ok(Math.hypot(...normal) > 0);
    const relative = [a, b, c].map(p => p.map((n, i) => n - result.vertices[0][i]));
    volume += relative[0].reduce((sum, n, i) => sum + n * cross(relative[1], relative[2])[i], 0) / 6;
    const lineage = result.extrusion.triangle_lineage[index];
    if (lineage.kind === 'top' || lineage.kind === 'bottom') {
      assert.ok(lineage.kind === 'top' ? normal[2] > 0 : normal[2] < 0);
      if (lineage.kind === 'top') top += normal[2] / 2; else bottom -= normal[2] / 2;
      const center = [0, 1].map(axis => (a[axis] + b[axis] + c[axis]) / 3);
      assert.ok(inside(center, outer), 'cap lies inside outer outline');
      if (hole) assert.ok(!inside(center, hole), 'cap never fills the opening');
    } else {
      assert.ok(normal[2] === 0);
      const [start, end] = lineage.profile_edge.map(i => result.vertices[i]);
      assert.ok(normal[0] * (end[1] - start[1]) - normal[1] * (end[0] - start[0]) > 0);
      if (lineage.ring === 'cutout') innerWallTriangles++;
    }
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = [Math.min(a, b), Math.max(a, b)].join(',');
      if (!edges.has(key)) edges.set(key, []); edges.get(key).push(a < b ? 1 : -1);
    }
  }
  for (const uses of edges.values()) assert.deepEqual(uses.sort(), [-1, 1], 'two opposite directed uses per mesh edge');
  near(top, expectedArea); near(bottom, expectedArea); near(volume, expectedArea * expectedHeight);
  assert.equal(innerWallTriangles, (hole?.length ?? 0) * 2);
  near(result.extrusion.profile_area_mm2, expectedArea);
  assert.equal(result.vertex_count - edges.size + result.triangle_count, hole ? 0 : 2, 'one through opening has Euler characteristic zero');
}

test('v2 plate retains an editable opening, net area, exact recipe lineage and outward inner walls', () => {
  const original = structuredClone(plate), result = extrudeReferenceProfile(plate);
  assert.deepEqual(plate, original); assert.deepEqual(result.bounds.size, [40, 30, 8]);
  assert.equal(result.vertex_count, 16); assert.equal(result.triangle_count, 32); assert.equal(result.extrusion.cap_triangle_count, 8);
  oracle(result, 1000, 8); assert.equal(result.extrusion.outer_area_mm2, 1200); assert.equal(result.extrusion.cutout_area_mm2, 200);
  assert.equal(result.extrusion.contract_id, 'moonmold.reference-profile-extrusion-report.v2');
  assert.equal(result.extrusion.recipe_sha256, createHash('sha256').update(canonicalJson(plate)).digest('hex'));
  assert.deepEqual(result.extrusion.profile_vertex_lineage, ['outer', 'cutout'].flatMap(ring => Array.from({ length: 4 }, (_, vertex_index) => ({ ring, vertex_index }))));
  assert.deepEqual(JSON.parse(result.exports.recipe), plate); assert.deepEqual(extrudeReferenceProfile(JSON.parse(result.exports.recipe)), result);
  assert.match(result.layout.instances[0].source.text, new RegExp(result.extrusion.recipe_sha256));
  assert.equal(result.extrusion.geometry_sha256, result.geometry_sha256); assert.equal(result.extrusion.physical_authority, false);
});

test('either ring winding and each cyclic start preserve net geometry and keep the authored order', () => {
  for (const reverseOuter of [false, true]) for (const reverseHole of [false, true]) for (let start = 0; start < 4; start++) {
    const vertices = reverseOuter ? [...plate.vertices].reverse() : plate.vertices;
    const base = reverseHole ? [...plate.cutout].reverse() : plate.cutout;
    const cutout = [...base.slice(start), ...base.slice(0, start)], recipe = { ...plate, vertices, cutout };
    const result = extrudeReferenceProfile(recipe); oracle(result, 1000, 8); assert.deepEqual(result.extrusion.recipe, recipe);
  }
});

test('concave outer and concave cutout polygons are triangulated without filling missing regions', () => {
  oracle(extrudeReferenceProfile({ ...plate, cutout: [[5,5],[25,5],[25,10],[10,10],[10,20],[5,20]] }), 1050, 8);
  oracle(extrudeReferenceProfile(bracket), 892, 6);
});

test('explicit units, large translations, minimum height and 128-point outer/hole rings are bounded', () => {
  for (const [units, factor] of Object.entries({ mm: 1, cm: 10, m: 1000, in: 25.4 })) oracle(extrudeReferenceProfile({ ...plate, units }), 1000 * factor * factor, 8 * factor);
  const translate = ring => ring.map(([x, y]) => [x + 900000, y - 900000]);
  oracle(extrudeReferenceProfile({ ...plate, vertices: translate(plate.vertices), cutout: translate(plate.cutout) }), 1000, 8);
  oracle(extrudeReferenceProfile({ ...plate, height: 1e-6 }), 1000, 1e-6);
  const ring = radius => Array.from({ length: 128 }, (_, i) => [radius * Math.cos(i * Math.PI / 64), radius * Math.sin(i * Math.PI / 64)]);
  const maximum = extrudeReferenceProfile({ ...plate, vertices: ring(100), cutout: ring(30) });
  oracle(maximum, 64 * (10000 - 900) * Math.sin(Math.PI / 64), 8); assert.equal(maximum.triangle_count, 1024);
});

test('editing outer boundary, opening and height creates independent source and geometry revisions', () => {
  const first = extrudeReferenceProfile(plate), revised = JSON.parse(first.exports.recipe);
  revised.cutout = [[8,10],[32,10],[32,20],[8,20]]; revised.height = 12;
  const second = extrudeReferenceProfile(revised); oracle(second, 960, 12);
  assert.notEqual(second.geometry_sha256, first.geometry_sha256); assert.notEqual(second.extrusion.recipe_sha256, first.extrusion.recipe_sha256);
  revised.vertices = [[0,0],[50,0],[50,30],[0,30]];
  const third = extrudeReferenceProfile(revised); oracle(third, 1260, 12); assert.notEqual(third.geometry_sha256, second.geometry_sha256);
  assert.deepEqual(first.extrusion.recipe, plate); assert.deepEqual(extrudeReferenceProfile(JSON.parse(second.exports.recipe)), second);
});

test('v1 stays strict, while explicit v2 null removes the opening without losing version intent', () => {
  const { cutout, ...rest } = plate;
  const v1 = { ...rest, contract_id: 'moonmold.reference-profile-extrusion.v1' };
  assert.throws(() => extrudeReferenceProfile({ ...v1, cutout }));
  assert.throws(() => extrudeReferenceProfile({ ...rest }), /requires cutout/);
  const solid = extrudeReferenceProfile({ ...plate, cutout: null }); oracle(solid, 1200, 8);
  assert.equal(solid.extrusion.recipe.contract_id, EXTRUSION_CUTOUT_CONTRACT); assert.equal(solid.extrusion.cutout_winding, null);
  assert.deepEqual(solid.vertices, extrudeReferenceProfile(v1).vertices); assert.deepEqual(solid.triangles, extrudeReferenceProfile(v1).triangles);
});

test('touching, crossing, outside, self-crossing, duplicate and ambiguous cutouts reject', () => {
  const invalid = [
    [[0,10],[10,10],[10,20],[0,20]], // coincident outer edge
    [[0,15],[5,10],[5,20]], // one vertex touches outer
    [[-1,10],[10,10],[10,20],[-1,20]],
    [[50,10],[60,10],[60,20],[50,20]],
    [[-10,-10],[50,-10],[50,40],[-10,40]], // surrounds outer
    [[10,10],[30,20],[30,10],[10,20]],
    [[10,10],[30,10],[30,20],[10,10]],
    [[10,10],[20,10],[30,10],[30,20],[10,20]],
    [[10,10],[20,10 + 1e-14],[30,10],[30,20],[10,20]],
    [[10,1e-12],[30,1e-12],[30,10],[10,10]],
  ];
  for (const cutout of invalid) assert.throws(() => extrudeReferenceProfile({ ...plate, cutout }), error => error.code === 'invalid-reference-extrusion', JSON.stringify(cutout));
  const u = [[0,0],[40,0],[40,40],[30,40],[30,10],[10,10],[10,40],[0,40]];
  assert.throws(() => extrudeReferenceProfile({ ...plate, vertices: u, cutout: [[5,20],[35,20],[35,30],[5,30]] }), /intersect/);
});

test('malformed or multiple cutouts and unknown fields cannot expand the bounded recipe', () => {
  for (const cutout of [undefined, [], {}, 'hole', [plate.cutout, plate.cutout], [[0,0],[1,1]], Array(129).fill([1,1]), [[1,1],[NaN,2],[2,3]], [[1,1],[2,2],[Infinity,3]], [[1,1],[2,2],[1000001,3]], [[1,1,0],[2,2],[3,1]]]) {
    assert.throws(() => extrudeReferenceProfile({ ...plate, cutout }), error => error.code === 'invalid-reference-extrusion');
  }
  for (const extra of [{ holes: [plate.cutout] }, { cutouts: [plate.cutout] }, { script: 'create_hole()' }]) assert.throws(() => extrudeReferenceProfile({ ...plate, ...extra }));
});

test('cutout layout, OBJ/STL, volume, surface area, drawing and GLB reuse existing geometry consumers', () => {
  const result = extrudeReferenceProfile(plate), layout = JSON.parse(result.exports.layout);
  assert.equal(composeReferenceLayout(layout).geometry_sha256, result.geometry_sha256);
  for (const input_format of ['obj', 'stl']) {
    const reopened = importReferenceMesh({ input_format, units: 'mm', text: result.exports[input_format] });
    assert.deepEqual(reopened.bounds, result.bounds); assert.equal(reopened.triangle_count, 32);
  }
  const volume = measureReferenceVolume({ layout, instance_ids: [plate.name] }); near(volume.shell_sum_volume_mm3, 8000);
  assert.deepEqual(volume.parts[0].topology, { boundary_edges: 0, nonmanifold_edges: 0, inconsistent_edges: 0, matching: 'exact-placed-coordinate-edges; no tolerance or source repair' });
  const area = measureReferenceSurfaceArea({ layout, instance_ids: [plate.name] }); near(area.total.triangle_sum_area_mm2, 3600);
  assert.match(drawReferenceLayout(layout).exports.svg, /<svg/); assert.equal(exportReferenceLayoutGlb(layout).readUInt32LE(0), 0x46546c67);
});

test('actual CLI saves and reopens cutout recipes, all mesh siblings, and preserves files on rejection', async () => {
  const dir = await mkdtemp(path.join(root, 'cutout-cli-')), cli = new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  for (const format of ['recipe', 'layout', 'obj', 'stl', 'json']) {
    const output = path.join(dir, format), args = ['--input', fixture.pathname, '--format', format, '--output', output];
    const execution = run(args); assert.equal(execution.status, 0, execution.stderr);
    const text = await readFile(output, 'utf8'); assert.ok(text.length > 0);
    if (format === 'recipe') assert.deepEqual(extrudeReferenceProfile(JSON.parse(text)), extrudeReferenceProfile(plate));
    if (format === 'layout') near(measureReferenceVolume({ layout: JSON.parse(text), instance_ids: [plate.name] }).shell_sum_volume_mm3, 8000);
    assert.equal(run(args).status, 1); assert.equal(await readFile(output, 'utf8'), text);
  }
  const invalid = path.join(dir, 'invalid.json'), output = path.join(dir, 'rejected.obj');
  await writeFile(invalid, JSON.stringify({ ...plate, cutout: [[0,10],[10,10],[10,20],[0,20]] }));
  assert.equal(run(['--input', invalid, '--output', output]).status, 1); await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('existing operator endpoint serves v2 plate and corrected revisions; rejected cutout stays rejected', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'cutout-http-')), server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve))); const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base + '/reference-profile')).text(); assert.match(html, /Optional cutout XY points/);
  const call = body => fetch(base + '/api/reference-profile/extrude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const first = await call(plate); assert.equal(first.status, 200); oracle(await first.json(), 1000, 8);
  const bad = await call({ ...plate, cutout: [[0,10],[10,10],[10,20],[0,20]] }); assert.equal(bad.status, 400); assert.match((await bad.json()).message, /strictly inside/);
  const edited = await call({ ...plate, height: 12 }); assert.equal(edited.status, 200); oracle(await edited.json(), 1000, 12);
});
