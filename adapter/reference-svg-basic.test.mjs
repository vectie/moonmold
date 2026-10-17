import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectReferenceSvg, importReferenceSvgProfile } from './reference-svg-profile.mjs';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-basic-shapes.svg', import.meta.url);
const text = await readFile(fixture, 'utf8');
const options = { text, element: 2, units: 'mm', units_per_svg_unit: 1, coordinate_convention: 'svg-y-down-to-xy-y-up', height: 5, name: 'basic-shape' };
const root = process.env.MOONMOLD_BASIC_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-basic-tests');
await mkdir(root, { recursive: true });
const shape = (tag, extra = {}) => importReferenceSvgProfile({ ...options, text: `<svg>${tag}</svg>`, ...extra });

test('basic shape inventory and exact rectangle retain source and editable representation lineage', () => {
  const inventory = inspectReferenceSvg({ text });
  assert.deepEqual(inventory.candidates.map(c => [c.element_type, c.supported, c.requires_tolerance]), [['rect', true, false], ['circle', true, true], ['ellipse', true, true]]);
  const built = importReferenceSvgProfile(options);
  assert.deepEqual(built.bounds, { min: [5, -30, 0], max: [45, -10, 5], size: [40, 20, 5] });
  assert.equal(built.extrusion.profile_area_mm2, 800);
  assert.equal(measureReferenceVolume({ layout: JSON.parse(built.exports.layout), instance_ids: ['basic-shape'] }).shell_sum_volume_mm3, 4000);
  assert.equal(built.svg_import.contract_id, 'moonmold.reference-svg-profile-import.v3');
  assert.deepEqual(built.svg_import.source_basic_shape, { x: 5, y: 10, width: 40, height: 20 });
  assert.equal(Buffer.from(built.svg_import.source.bytes, 'base64').toString(), text);
  assert.equal(built.svg_import.approximation, undefined);
  assert.deepEqual(shape('<rect width="2e1" height="10" rx="0"/>').bounds.size, [20, 10, 5]);
});

test('circle and ellipse chord bounds hold on dense samples with deterministic cardinal extrema and scaling', () => {
  for (const element of [3, 4]) for (const [units, factor] of Object.entries({ mm: 1, cm: 10, m: 1000, in: 25.4 })) {
    const built = importReferenceSvgProfile({ ...options, element, units, units_per_svg_unit: 0.5, max_error: 0.05 });
    const again = importReferenceSvgProfile({ ...options, element, units, units_per_svg_unit: 0.5, max_error: 0.05 });
    assert.equal(built.geometry_sha256, again.geometry_sha256);
    const record = built.svg_import, a = record.approximation, s = record.source_basic_shape, points = a.vertices;
    assert.ok(a.vertex_count <= 128 && a.vertex_count % 4 === 0); assert.ok(a.maximum_accepted_bound <= 0.05);
    assert.equal(a.units, units); assert.equal(record.physical_authority, false);
    [s.rx * factor, s.ry * factor, 5 * factor].forEach((expected, i) => assert.ok(Math.abs(built.bounds.size[i] - expected) < 1e-9));
    for (let i = 0; i < points.length; i++) for (let j = 0; j <= 32; j++) {
      const t = 2 * Math.PI * (i + j / 32) / points.length;
      const p = [(s.cx + s.rx * Math.cos(t)) * 0.5, -(s.cy + s.ry * Math.sin(t)) * 0.5];
      const q = points[i], r = points[(i + 1) % points.length], dx = r[0] - q[0], dy = r[1] - q[1];
      const u = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (dx * dx + dy * dy)));
      assert.ok(Math.hypot(p[0] - q[0] - u * dx, p[1] - q[1] - u * dy) <= a.maximum_accepted_bound);
    }
    const recipe = JSON.parse(built.exports.recipe); recipe.height = 8; recipe.vertices = recipe.vertices.map(([x, y]) => [x + 1, y]);
    const revised = extrudeReferenceProfile(JSON.parse(JSON.stringify(recipe)));
    const reopened = composeReferenceLayout(JSON.parse(revised.exports.layout));
    assert.equal(reopened.geometry_sha256, revised.geometry_sha256);
    assert.notEqual(revised.geometry_sha256, built.geometry_sha256); assert.equal(revised.svg_import, undefined);
    assert.equal(record.recipe.height, 5);
  }
});

test('invalid, transformed, rounded, degenerate and over-budget shapes reject without guesses', () => {
  for (const tag of ['<rect width="0" height="5"/>', '<rect width="-1" height="5"/>', '<rect width="5px" height="5"/>', '<rect width="5"/>', '<rect width="5" height="5" rx="1"/>', '<rect width="5" height="5" ry="-1"/>', '<circle r="0"/>', '<circle r="NaN"/>', '<circle r="1e-400"/>', '<ellipse rx="4"/>', '<ellipse rx="4" ry="-1"/>', '<circle r="4" transform="scale(2)"/>', '<g transform="scale(2)"><circle r="4"/></g>', '<defs><ellipse rx="3" ry="2"/></defs>']) {
    const drawing = `<svg>${tag}</svg>`;
    const candidate = inspectReferenceSvg({ text: drawing }).candidates[0];
    assert.equal(candidate.supported, false, tag);
    assert.throws(() => importReferenceSvgProfile({ ...options, text: drawing, element: candidate.element_index, max_error: 0.1 }));
  }
  assert.throws(() => shape('<circle r="10"/>'), /max_error/);
  assert.throws(() => shape('<circle r="10"/>', { max_error: 0.000001 }), /128/);
  assert.throws(() => shape('<circle cx="1000000" r="10"/>', { max_error: 0.1 }), /1000000/);
  assert.throws(() => shape('<rect width="10" height="5"/>', { max_error: 0.1 }), /omit/);
});

test('CLI saves circle recipe, edits height, reopens through extrusion and layout with source unchanged', async () => {
  const dir = await mkdtemp(path.join(root, 'cli-'));
  const recipePath = path.join(dir, 'circle.json'), revisedPath = path.join(dir, 'revised.json');
  const imported = spawnSync(process.execPath, [new URL('../bin/moonmold-reference-svg.mjs', import.meta.url).pathname, '--input', fixture.pathname, '--element', '3', '--units', 'mm', '--units-per-svg-unit', '1', '--coordinate-convention', options.coordinate_convention, '--max-error', '0.1', '--height', '5', '--name', options.name, '--format', 'recipe', '--output', recipePath], { encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  const recipe = JSON.parse(await readFile(recipePath, 'utf8')); recipe.height = 9;
  await writeFile(revisedPath, JSON.stringify(recipe));
  const reopened = spawnSync(process.execPath, [new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname, '--input', revisedPath, '--format', 'layout'], { encoding: 'utf8' });
  assert.equal(reopened.status, 0, reopened.stderr);
  assert.deepEqual(composeReferenceLayout(JSON.parse(reopened.stdout)).bounds.size, [20, 20, 9]);
  assert.equal(await readFile(fixture, 'utf8'), text);
});

test('operator HTTP imports ellipse into existing editable profile endpoint and serves curve-aware controls', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'http-')), server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(base + '/reference-profile')).text(); assert.match(page, /paths, circles, ellipses/); assert.match(page, /\?\.requires_tolerance/);
  const call = async (route, body) => { const response = await fetch(base + '/api/reference-profile/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, 200); return response.json(); };
  const built = await call('svg-import', { ...options, element: 4, max_error: 0.1 });
  assert.deepEqual(built.bounds.size, [40, 16, 5]);
  const edited = await call('extrude', { ...built.extrusion.recipe, height: 12 });
  assert.deepEqual(composeReferenceLayout(JSON.parse(edited.exports.layout)).bounds.size, [40, 16, 12]);
});
