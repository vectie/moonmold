import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseAbsolutePath, flattenAbsolutePath } from './reference-svg-path.mjs';
import { inspectReferenceSvg, importReferenceSvgProfile } from './reference-svg-profile.mjs';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-curved-outline.svg', import.meta.url), text = await readFile(fixture, 'utf8');
const options = { text, element: 2, units: 'mm', units_per_svg_unit: 1, coordinate_convention: 'svg-y-down-to-xy-y-up', max_error: 0.25, height: 8, name: 'curved-outline' };
const root = process.env.MOONMOLD_SVG_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-svg-tests');
await mkdir(root, { recursive: true });
const svg = d => `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
const build = (d, extra = {}) => importReferenceSvgProfile({ ...options, text: svg(d), ...extra });
const distance = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const evaluate = (controls, t) => {
  let row = controls; while (row.length > 1) row = row.slice(1).map((p, i) => [row[i][0] * (1 - t) + p[0] * t, row[i][1] * (1 - t) + p[1] * t]); return row[0];
};

test('quadratic and cubic paths flatten deterministically inside declared error, with source/approximation/recipe identities', () => {
  const inventory = inspectReferenceSvg({ text }); assert.equal(inventory.contract_id, 'moonmold.reference-svg-inventory.v2');
  assert.deepEqual(inventory.candidates.map(c => [c.supported, c.requires_tolerance, c.source_segment_count, c.vertex_count]), [[true, true, 3, null]]);
  const built = importReferenceSvgProfile(options), record = built.svg_import;
  assert.deepEqual(built.bounds.size, [45, 39, 8]); assert.equal(record.contract_id, 'moonmold.reference-svg-profile-import.v2');
  assert.deepEqual(Buffer.from(record.source.bytes, 'base64'), Buffer.from(text)); assert.equal(record.source.sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(record.source_points, null); assert.equal(record.approximation.units, 'mm'); assert.equal(record.approximation.max_error, 0.25);
  assert.ok(record.approximation.maximum_accepted_bound <= 0.25); assert.notEqual(record.approximation_sha256, record.recipe_sha256);
  assert.deepEqual(importReferenceSvgProfile(options), built);
  const points = built.extrusion.recipe.vertices.map(([x, y]) => [x, -y]);
  for (const controls of [[[0, 0], [40, 0]], [[40, 0], [50, 15], [40, 30]], [[40, 30], [30, 42], [10, 42], [0, 30]]]) {
    for (let step = 0; step <= 1000; step++) {
      const sample = evaluate(controls, step / 1000), error = Math.min(...points.map((point, index) => distance(sample, point, points[(index + 1) % points.length])));
      assert.ok(error <= 0.25, `Geometric sample deviation ${error}`);
    }
  }
  const fine = importReferenceSvgProfile({ ...options, max_error: 0.05 });
  assert.ok(fine.extrusion.recipe.vertices.length > points.length); assert.notEqual(fine.svg_import.approximation_sha256, record.approximation_sha256);
  assert.notEqual(fine.extrusion.recipe_sha256, record.recipe_sha256); assert.equal(fine.svg_import.source.sha256, record.source.sha256);
  assert.equal(composeReferenceLayout(JSON.parse(built.exports.layout)).geometry_sha256, built.geometry_sha256);
  for (const input_format of ['obj', 'stl']) assert.deepEqual(importReferenceMesh({ input_format, text: built.exports[input_format], units: 'mm' }).bounds, built.bounds);
});

test('absolute repeated groups, comma/sign/exponent grammar, units and closure are explicit', () => {
  const value = build('M0,0 4e1,0 Q50 15 40 30 C30 42 10 42 0 30 Z'); assert.deepEqual(value.bounds.size, [45, 39, 8]);
  const repeat = parseAbsolutePath('M0 0 L10 0 10 10 Q5 15 0 10 -5 5 0 0 Z'); assert.equal(repeat.segments.length, 4);
  assert.equal(build('M0 0L40 0L40 30L0 30L0 0Z').svg_import.removed_closing_endpoint, true);
  const cm = importReferenceSvgProfile({ ...options, units: 'cm', units_per_svg_unit: 0.1, max_error: 0.025, height: 0.8 });
  assert.deepEqual(cm.bounds.size, [45, 39, 8]); assert.equal(cm.svg_import.approximation.units, 'cm');
  assert.equal(cm.svg_import.approximation.vertex_count, value.svg_import.approximation.vertex_count);
  assert.throws(() => importReferenceSvgProfile({ ...options, max_error: undefined }), /max_error/);
});

test('relative commands, arcs, implicit closure, compound contours, bad numbers and unsupported source semantics reject', () => {
  for (const d of ['m0 0 L40 0 L0 30 Z', 'M0 0 A1 1 0 0 0 40 0 L0 30 Z', 'M0 0 H40 V30 Z', 'M0 0 Q20 20 40 0 L0 30', 'M0 0 L40 0 L0 30 Z M5 5 L6 5 L5 6 Z', 'M0 0 L40 0 Z L0 30 Z', 'M0 0 Q1 2 3 Z', 'M0,,0 L40 0 L0 30 Z', 'M,0 0 L40 0 L0 30 Z', 'M0 0 L40 0 L0 30, Z', 'M0 0 L40 0 L0 30 Z,', 'M0 0 L1e400 0 L0 30 Z', 'M0 0 L1e-400 0 L0 30 Z', 'M0 0 LNaN 0 L0 30 Z', 'M0 0 C0 0 0 0 0 0 Z']) assert.throws(() => build(d), undefined, d);
  for (const changed of [text.replace('<path ', '<path transform="scale(2)" '), text.replace('<path ', '<path fill-rule="evenodd" '), text.replace('<path ', '<path style="fill:none" '), text.replace('<path ', '<path xmlns="urn:foreign" ')]) assert.throws(() => importReferenceSvgProfile({ ...options, text: changed }), /Unsupported|unsupported/);
  assert.throws(() => build('M0 0 L40 30 L0 30 L40 0 Z'), /cross|intersect|area|simple|degenerate/i);
  assert.throws(() => build('M0 0 L40 0 L0 0 L0 30 Z'), /duplicate|repeated|touch|intersect/i);
  assert.throws(() => build('M0 0 C30 30 -20 30 10 0 L10 -20 L0 -20 Z', { max_error: 100 }), /cross|touch|simple|subdivision/i);
});

test('resource/precision limits never silently relax tolerance or repair degenerate geometry', () => {
  for (const max_error of [0, -1, NaN, Infinity, '0.1', 1e-20]) assert.throws(() => importReferenceSvgProfile({ ...options, max_error }), /max_error|tolerance/);
  assert.throws(() => importReferenceSvgProfile({ ...options, max_error: 1e-6 }), /128|subdivision/);
  assert.throws(() => importReferenceSvgProfile({ ...options, units_per_svg_unit: 1e308 }), /controls/);
  assert.throws(() => build('M0 0 Q20 0 40 0 L0 0 Z'), /3–128|collinear|area|degenerate/i);
  assert.throws(() => parseAbsolutePath('M0 0 ' + Array.from({ length: 513 }, (_, i) => `L${i + 1} 1`).join(' ') + ' Z'), /512/);
  const parsed = parseAbsolutePath('M0 0 Q50 15 40 30 L0 30 Z');
  assert.throws(() => flattenAbsolutePath(parsed, { scale: 1, units: 'bad', max_error: 0.1 }), /units/);
});

test('real curved SVG CLI saves recipe/layout/OBJ/STL, reopens edited points and keeps import identity separate', async () => {
  const dir = await mkdtemp(path.join(root, 'path-cli-')), cli = new URL('../bin/moonmold-reference-svg.mjs', import.meta.url).pathname;
  const base = ['--input', fixture.pathname, '--element', '2', '--units', 'mm', '--units-per-svg-unit', '1', '--coordinate-convention', options.coordinate_convention, '--max-error', '0.25', '--height', '8', '--name', options.name];
  const runs = [];
  const run = (program, args) => { const result = spawnSync(program, args, { encoding: 'utf8' }); runs.push({ program, args, status: result.status, stderr: result.stderr }); return result; };
  for (const format of ['recipe', 'layout', 'import', 'obj', 'stl']) {
    const file = path.join(dir, format); const result = run(process.execPath, [cli, ...base, '--format', format, '--output', file]); assert.equal(result.status, 0, result.stderr);
    const bytes = await readFile(file); assert.ok(bytes.length); assert.equal(run(process.execPath, [cli, ...base, '--format', format, '--output', file]).status, 1); assert.deepEqual(await readFile(file), bytes);
  }
  const imported = JSON.parse(await readFile(path.join(dir, 'import'), 'utf8')), recipe = JSON.parse(await readFile(path.join(dir, 'recipe'), 'utf8'));
  assert.deepEqual(Buffer.from(imported.source.bytes, 'base64'), await readFile(fixture));
  recipe.height = 12; recipe.vertices[0][0] = -2;
  const revised = path.join(dir, 'revised.profile.json'); await writeFile(revised, JSON.stringify(recipe));
  const cli2 = new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname, layout = path.join(dir, 'revised.layout.json');
  const reopened = run(process.execPath, [cli2, '--input', revised, '--format', 'layout', '--output', layout]); assert.equal(reopened.status, 0, reopened.stderr);
  const model = composeReferenceLayout(JSON.parse(await readFile(layout, 'utf8'))); assert.deepEqual(model.bounds.size, [47, 39, 12]);
  assert.notEqual(extrudeReferenceProfile(recipe).extrusion.recipe_sha256, imported.recipe_sha256); assert.equal(extrudeReferenceProfile(recipe).svg_import, undefined);
  assert.equal(await readFile(fixture, 'utf8'), text); await writeFile(path.join(dir, 'commands.json'), JSON.stringify(runs, null, 2));
});

test('actual loopback HTTP imports curved profiles, exposes tolerance and preserves rejection detail', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'path-http-')), server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve))); const base = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(base + '/reference-profile')).text(); assert.match(page, /svg-max-error/); assert.match(page, /formnovalidate>Inspect SVG outlines/);
  const call = (route, body) => fetch(base + '/api/reference-profile/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const inspected = await call('svg-inspect', { text }); assert.equal(inspected.status, 200); assert.equal((await inspected.json()).candidates[0].requires_tolerance, true);
  const response = await call('svg-import', options); assert.equal(response.status, 200); const built = await response.json(); assert.deepEqual(built.bounds.size, [45, 39, 8]);
  const revised = await call('extrude', { ...built.extrusion.recipe, height: 12 }); assert.equal(revised.status, 200); assert.deepEqual((await revised.json()).bounds.size, [45, 39, 12]);
  const refused = await call('svg-import', { ...options, max_error: undefined }); assert.equal(refused.status, 400); assert.match((await refused.json()).message, /max_error/);
  await writeFile(path.join(workspaceRoot, 'http-checks.json'), JSON.stringify({ host: '127.0.0.1', inspect: 200, import: 200, edit: 200, missing_tolerance: 400, recipe_sha256: built.extrusion.recipe_sha256, approximation_sha256: built.svg_import.approximation_sha256, graphical_browser: false }, null, 2));
});
