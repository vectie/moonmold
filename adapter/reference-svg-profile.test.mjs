import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectReferenceSvg, importReferenceSvgProfile } from './reference-svg-profile.mjs';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-outlines.svg', import.meta.url);
const text = await readFile(fixture, 'utf8');
const options = { text, element: 4, units: 'mm', units_per_svg_unit: 1, coordinate_convention: 'svg-y-down-to-xy-y-up', height: 8, name: 'svg-outline' };
const root = process.env.MOONMOLD_SVG_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-svg-tests');
await mkdir(root, { recursive: true });
const svg = (shape, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${shape}</svg>`;
const polygon = (points = '0,0 40,0 40,30 0,30', attrs = '') => `<polygon points="${points}" ${attrs}/>`;
const from = (drawing, extra = {}) => importReferenceSvgProfile({ ...options, text: drawing, element: 2, ...extra });

test('inventory lists stable element indices and useful closed/open diagnostics without unit inference', () => {
  const inventory = inspectReferenceSvg({ text });
  assert.equal(inventory.element_count, 7); assert.equal(inventory.drawing_element_count, 4);
  assert.deepEqual(inventory.drawing_element_type_counts, { polygon: 1, polyline: 2, path: 1 });
  assert.deepEqual(inventory.candidates.map(c => [c.element_index, c.element_id, c.vertex_count, c.supported]), [[4, 'stepped', 6, true], [5, 'triangle', 3, true], [6, 'open-guide', null, false], [7, 'curve-needs-tolerance', null, true]]);
  assert.match(inventory.candidates[2].reason, /explicitly repeat/); assert.equal(inventory.viewport_hints.width, '80mm');
  assert.equal(inventory.source_sha256, createHash('sha256').update(text).digest('hex')); assert.equal(inventory.physical_authority, false);
  assert.equal('units' in inventory, false);
});

test('concave SVG becomes real editable extrusion, layout, OBJ/STL and measurable volume', () => {
  const built = importReferenceSvgProfile(options);
  assert.deepEqual(built.bounds, { min: [0, -30, 0], max: [40, 0, 8], size: [40, 30, 8] });
  assert.equal(built.extrusion.profile_area_mm2, 700); assert.equal(built.triangle_count, 20);
  const record = built.svg_import;
  assert.equal(record.element_index, 4); assert.equal(record.element_type, 'polygon'); assert.equal(record.omitted_drawing_element_count, 3);
  assert.equal(record.recipe_sha256, built.extrusion.recipe_sha256); assert.equal(record.physical_authority, false);
  assert.deepEqual(Buffer.from(record.source.bytes, 'base64'), Buffer.from(text));
  assert.equal(record.source.sha256, createHash('sha256').update(Buffer.from(record.source.bytes, 'base64')).digest('hex'));
  const recipe = JSON.parse(built.exports.recipe), layout = JSON.parse(built.exports.layout);
  assert.deepEqual(record.recipe, recipe); assert.equal(extrudeReferenceProfile(recipe).geometry_sha256, built.geometry_sha256);
  assert.equal(composeReferenceLayout(layout).geometry_sha256, built.geometry_sha256);
  assert.equal(measureReferenceVolume({ layout, instance_ids: [options.name] }).shell_sum_volume_mm3, 5600);
  for (const input_format of ['obj', 'stl']) assert.deepEqual(importReferenceMesh({ input_format, text: built.exports[input_format], units: 'mm' }).bounds, built.bounds);
  const changed = { ...recipe, height: 12, vertices: recipe.vertices.map(([x, y]) => [x * 2, y]) };
  const revised = extrudeReferenceProfile(JSON.parse(JSON.stringify(changed)));
  assert.deepEqual(revised.bounds.size, [80, 30, 12]); assert.equal(revised.extrusion.profile_area_mm2, 1400);
  assert.notEqual(revised.extrusion.recipe_sha256, record.recipe_sha256); assert.notEqual(revised.geometry_sha256, built.geometry_sha256);
  assert.equal(revised.svg_import, undefined); assert.deepEqual(record.recipe, recipe);
});

test('closed polyline and explicit scaling retain origin; viewport hints never alter raw coordinates', () => {
  const triangle = importReferenceSvgProfile({ ...options, element: 5, units: 'cm', units_per_svg_unit: 0.1, height: 2 });
  assert.deepEqual(triangle.bounds, { min: [50, -20, 0], max: [70, 0, 20], size: [20, 20, 20] });
  assert.equal(triangle.svg_import.removed_closing_endpoint, true); assert.equal(triangle.svg_import.source_points.length, 3);
  assert.deepEqual(triangle.extrusion.recipe.vertices, [[5, 0], [7, 0], [5, -2]]);
  for (const [units, factor] of Object.entries({ mm: 1, cm: 10, m: 1000, in: 25.4 })) {
    const built = importReferenceSvgProfile({ ...options, units, units_per_svg_unit: 2 });
    assert.deepEqual(built.bounds.size, [80 * factor, 60 * factor, 8 * factor]);
  }
  const changedHints = text.replace('width="80mm"', 'width="400in"').replace('viewBox="0 0 80 60"', 'viewBox="-100 -100 5 5"');
  assert.equal(importReferenceSvgProfile({ ...options, text: changedHints }).geometry_sha256, importReferenceSvgProfile(options).geometry_sha256);
});

test('normal XML quoting, entities, BOM, CRLF, exponents and explicit polygon closure preserve source bytes', () => {
  const drawing = '\ufeff<?xml version="1.0" encoding="UTF-8"?>\r\n' + svg("<!-- café -->\r\n<polygon id='A&amp;B' points='0 0, 4e1 0, 40 3e1, 0 30, 0 0'></polygon>");
  const result = from(drawing);
  assert.deepEqual(Buffer.from(result.svg_import.source.bytes, 'base64'), Buffer.from(drawing));
  assert.equal(result.svg_import.element_id, 'A&B'); assert.equal(result.svg_import.removed_closing_endpoint, true);
  assert.deepEqual(result.bounds.size, [40, 30, 8]);
  const other = from(drawing.replaceAll('\r\n', '\n'));
  assert.notEqual(other.svg_import.source.sha256, result.svg_import.source.sha256); assert.equal(other.geometry_sha256, result.geometry_sha256);
});

test('transforms, CSS, clipping and hidden-definition contexts report unsupported rather than guessed geometry', () => {
  for (const drawing of [
    svg(polygon(undefined, 'transform="translate(10,20)"')),
    svg(`<g transform="scale(2)">${polygon()}</g>`),
    svg(polygon(), 'transform="scale(2)"'),
    svg(polygon(undefined, 'style="transform:scale(2)"')),
    svg(polygon(undefined, 'clip-path="url(#clip)"')),
    svg(`<defs>${polygon()}</defs>`),
    svg(polygon(undefined, 'class="scaled"')),
  ]) {
    const candidate = inspectReferenceSvg({ text: drawing }).candidates[0]; assert.equal(candidate.supported, false); assert.ok(candidate.reason);
    assert.throws(() => from(drawing, { element: candidate.element_index }), /Unsupported|unsupported/);
  }
  assert.throws(() => from(svg('<path d="M0 0 L40 0 L0 30 Z"/>')), /max_error/);
  assert.throws(() => from(svg('<polyline points="0 0 40 0 0 30"/>')), /explicitly repeat/);
});

test('malformed XML, executable SVG, ambiguous units and invalid geometry reject with clear diagnostics', () => {
  for (const drawing of ['', '<svg>', '<svg><g></svg>', '<svg/><svg/>', '<!DOCTYPE svg><svg/>', svg('<script>ignored()</script>'), svg('<style>polygon{transform:scale(2)}</style>'), svg('<svg/>'), svg(polygon(undefined, 'onclick="run()"')), svg(polygon(undefined, 'points="1 2"')), svg(polygon('0 0 1')), svg(polygon('0 0,40 0,,0 30')), svg(polygon('0 0 NaN 0 0 30')), svg(polygon('0 0 1e-400 0 0 30')), svg(polygon('0 0 20 20 0 20 20 0')), svg(polygon('0 0 20 0 40 0')), ' '.repeat(400001)]) assert.throws(() => from(drawing), undefined, drawing.slice(0, 100));
  for (const patch of [{ element: 0 }, { element: 7 }, { element: 8 }, { units: undefined }, { units_per_svg_unit: undefined }, { units_per_svg_unit: 0 }, { units_per_svg_unit: -1 }, { units_per_svg_unit: Infinity }, { units_per_svg_unit: '1' }, { coordinate_convention: undefined }, { coordinate_convention: 'xy-z-up' }, { height: undefined }, { name: undefined }, { code: 'run' }]) assert.throws(() => importReferenceSvgProfile({ ...options, ...patch }));
  assert.throws(() => inspectReferenceSvg({ text, units: 'mm' }), /Expected/);
});

test('real CLI imports, saves exact original bytes, revises recipe and reopens through existing extrusion CLI', async () => {
  const dir = await mkdtemp(path.join(root, 'cli-')), cli = new URL('../bin/moonmold-reference-svg.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const base = ['--input', fixture.pathname, '--element', '4', '--units', 'mm', '--units-per-svg-unit', '1', '--coordinate-convention', options.coordinate_convention, '--height', '8', '--name', options.name];
  assert.equal(JSON.parse(run(['--input', fixture.pathname]).stdout).candidates.length, 4);
  for (const format of ['recipe', 'layout', 'json', 'import', 'obj', 'stl']) {
    const file = path.join(dir, format); const executed = run([...base, '--format', format, '--output', file]); assert.equal(executed.status, 0, executed.stderr);
    const output = await readFile(file, 'utf8'); assert.ok(output.length > 0);
    if (format === 'import') assert.deepEqual(Buffer.from(JSON.parse(output).source.bytes, 'base64'), await readFile(fixture));
    assert.equal(run([...base, '--format', format, '--output', file]).status, 1); assert.equal(await readFile(file, 'utf8'), output);
  }
  const profile = JSON.parse(await readFile(path.join(dir, 'recipe'), 'utf8'));
  profile.height = 12; profile.vertices = profile.vertices.map(([x, y]) => [2 * x, y]);
  const revisedFile = path.join(dir, 'revised.profile.json'); await writeFile(revisedFile, JSON.stringify(profile, null, 2) + '\n');
  const extrudeCli = new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname;
  for (const format of ['layout', 'recipe', 'json', 'obj', 'stl']) {
    const file = path.join(dir, `revised.${format}`);
    const execution = spawnSync(process.execPath, [extrudeCli, '--input', revisedFile, '--format', format, '--output', file], { encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
  }
  const reopened = composeReferenceLayout(JSON.parse(await readFile(path.join(dir, 'revised.layout'), 'utf8'))); assert.deepEqual(reopened.bounds.size, [80, 30, 12]);
  const revised = JSON.parse(await readFile(path.join(dir, 'revised.json'), 'utf8')); assert.equal(revised.geometry_sha256, reopened.geometry_sha256);
  const record = JSON.parse(await readFile(path.join(dir, 'import'), 'utf8')); assert.notEqual(record.recipe_sha256, revised.extrusion.recipe_sha256);
  assert.equal(await readFile(fixture, 'utf8'), text);
  for (const args of [base, [...base, '--format', 'mesh'], [...base, '--format', 'recipe', '--element', '5'], ['--input', dir]]) assert.equal(run(args).status, 1);
  const invalid = path.join(dir, 'invalid.svg'); await writeFile(invalid, Buffer.from([255])); assert.equal(run(['--input', invalid]).status, 1);
});

test('actual operator HTTP serves SVG intake, imports the source, and preserves meaningful rejection errors', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'http-')); const server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve))); const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/reference-profile'); assert.match(await page.text(), /Inspect SVG outlines/);
  const call = (route, body) => fetch(base + '/api/reference-profile/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const inspected = await call('svg-inspect', { text }); assert.equal(inspected.status, 200); assert.equal((await inspected.json()).candidates.length, 4);
  const imported = await call('svg-import', options); assert.equal(imported.status, 200); const built = await imported.json(); assert.deepEqual(built.bounds.size, [40, 30, 8]);
  const revised = await call('extrude', { ...built.extrusion.recipe, height: 12 }); assert.equal(revised.status, 200); assert.deepEqual((await revised.json()).bounds.size, [40, 30, 12]);
  const invalid = await call('svg-import', { ...options, element: 6 }); assert.equal(invalid.status, 400); assert.match((await invalid.json()).message, /explicitly repeat/);
});
