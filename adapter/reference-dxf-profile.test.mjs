import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectReferenceDxf, importReferenceDxfProfile } from './reference-dxf-profile.mjs';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-outlines.dxf', import.meta.url);
const text = await readFile(fixture, 'utf8');
const options = { text, entity: 1, units: 'mm', height: 8, name: 'drawing-outline' };
const root = process.env.MOONMOLD_DXF_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-dxf-tests');
await mkdir(root, { recursive: true });
const changeEntity = (extra, head = '90\n3\n70\n1\n', points = '10\n0\n20\n0\n10\n20\n20\n0\n10\n0\n20\n20\n') => `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n${head}${extra}${points}0\nENDSEC\n0\nEOF\n`;
const importText = value => importReferenceDxfProfile({ ...options, text: value });

test('inspect drawing candidates and omissions without choosing or inferring units', () => {
  const review = inspectReferenceDxf({ text });
  assert.equal(review.entity_count, 3); assert.deepEqual(review.entity_type_counts, { LWPOLYLINE: 2, LINE: 1 });
  assert.deepEqual(review.candidates.map(c => [c.entity_index, c.layer, c.vertex_count, c.supported]), [[1, 'STEPPED', 6, true], [3, 'TRIANGLE', 3, true]]);
  assert.deepEqual(review.omitted_sections, ['HEADER']); assert.equal(review.physical_authority, false);
  assert.equal(review.source_sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal('vertices' in review.candidates[0], false); assert.equal('units' in review, false);
});

test('selected concave outline becomes editable profile and a measured capped mesh', () => {
  const built = importReferenceDxfProfile(options);
  assert.deepEqual(built.bounds.size, [40, 30, 8]); assert.equal(built.triangle_count, 20);
  assert.equal(built.extrusion.profile_area_mm2, 700);
  assert.equal(built.dxf_import.entity_index, 1); assert.equal(built.dxf_import.layer, 'STEPPED');
  assert.equal(built.dxf_import.omitted_entity_count, 2); assert.equal(built.dxf_import.source_units, 'mm');
  assert.equal(built.dxf_import.recipe_sha256, built.extrusion.recipe_sha256); assert.equal(built.dxf_import.physical_authority, false);
  const recipe = JSON.parse(built.exports.recipe);
  assert.equal(extrudeReferenceProfile(recipe).geometry_sha256, built.geometry_sha256);
  const layout = JSON.parse(built.exports.layout); assert.equal(composeReferenceLayout(layout).geometry_sha256, built.geometry_sha256);
  const volume = measureReferenceVolume({ layout, instance_ids: [options.name] }); assert.equal(volume.shell_sum_volume_mm3, 5600);
  for (const input_format of ['obj', 'stl']) assert.deepEqual(importReferenceMesh({ input_format, text: built.exports[input_format], units: 'mm' }).bounds.size, [40, 30, 8]);
  const edited = extrudeReferenceProfile({ ...recipe, height: 12 }); assert.deepEqual(edited.bounds.size, [40, 30, 12]);
  assert.notEqual(edited.extrusion.recipe_sha256, built.dxf_import.recipe_sha256); assert.equal(edited.dxf_import, undefined);
});

test('select another layer, reinterpret explicit units and retain original byte identity', () => {
  const triangle = importReferenceDxfProfile({ ...options, entity: 3, units: 'cm', height: 2 });
  assert.deepEqual(triangle.bounds.size, [200, 200, 20]); assert.equal(triangle.triangle_count, 8);
  for (const [units, factor] of Object.entries({ mm: 1, cm: 10, m: 1000, in: 25.4 })) {
    const result = importReferenceDxfProfile({ ...options, units });
    assert.deepEqual(result.bounds.size, [40 * factor, 30 * factor, 8 * factor]);
  }
  const crlf = text.replaceAll('\n', '\r\n'); const built = importText(crlf);
  assert.equal(built.geometry_sha256, importText(text).geometry_sha256);
  assert.notEqual(built.dxf_import.source_sha256, importText(text).dxf_import.source_sha256);
  assert.deepEqual(importText(text.trimEnd()).bounds.size, [40, 30, 8]);
});

test('no automatic closing, curve flattening, width erasure, OCS flattening or paper-space import', () => {
  for (const [extra, head, points] of [
    ['', '90\n3\n70\n0\n'], ['38\n2\n'], ['39\n1\n'], ['43\n1\n'], ['210\n1\n'], ['230\n-1\n'], ['67\n1\n'], ['410\nLayout1\n'],
    ['', undefined, '10\n0\n20\n0\n42\n0.5\n10\n20\n20\n0\n10\n0\n20\n20\n'],
    ['', undefined, '10\n0\n20\n0\n40\n1\n10\n20\n20\n0\n10\n0\n20\n20\n'],
    ['', undefined, '10\n0\n20\n0\n42\n1e-400\n10\n20\n20\n0\n10\n0\n20\n20\n'],
    ['102\n{ACAD_REACTORS\n'], ['1001\nEXTENSION\n'],
  ]) {
    const drawing = changeEntity(extra, head, points); const candidate = inspectReferenceDxf({ text: drawing }).candidates[0];
    assert.equal(candidate.supported, false, drawing); assert.ok(candidate.reason); assert.throws(() => importText(drawing));
  }
});

test('malformed selected entity groups and invalid geometry reject without repair', () => {
  for (const drawing of [
    changeEntity('', '90\n4\n70\n1\n'), changeEntity('90\n3\n'), changeEntity('8\nA\n8\nB\n'),
    changeEntity('20\n0\n'), changeEntity('', undefined, '10\n0\n20\n0\n20\n1\n10\n20\n20\n0\n10\n0\n20\n20\n'),
    changeEntity('', undefined, '10\n0\n20\n0\n10\n20\n20\n0\n10\n0\n'),
    changeEntity('', undefined, '10\n0\n20\n0\n10\n20\n20\n0\n10\n0\n20\n0\n'),
    changeEntity('', undefined, '10\n0\n20\n0\n10\n10\n20\n0\n10\n20\n20\n0\n'),
    changeEntity('', '90\n4\n70\n1\n', '10\n0\n20\n0\n10\n20\n20\n20\n10\n0\n20\n20\n10\n20\n20\n0\n'),
    changeEntity('', undefined, '10\n0\n20\n0\n10\nNaN\n20\n0\n10\n0\n20\n20\n'),
  ]) assert.throws(() => importText(drawing));
});

test('drawing structure, resource limits and explicit selection reject unsupported input', () => {
  for (const drawing of ['', text.slice(0, -6), text + '0\nEOF\n', text + '999\ncomment\n', text.replace('0\nENDSEC', '0\nSECTION'), text.replace('2\nENTITIES', '2\nBLOCKS'), 'AutoCAD Binary DXF\r\n\x1a\0', '\u00e9', ' '.repeat(400001), '999\nx\n'.repeat(20001), '0\nSECTION\n2\nENTITIES\n' + '0\nPOINT\n'.repeat(1001) + '0\nENDSEC\n0\nEOF\n']) assert.throws(() => inspectReferenceDxf({ text: drawing }));
  for (const patch of [{ entity: 2 }, { entity: 4 }, { entity: 0 }, { entity: 1.5 }, { entity: '1' }, { units: undefined }, { height: undefined }, { name: undefined }, { script: 'eval' }]) assert.throws(() => importReferenceDxfProfile({ ...options, ...patch }));
  assert.throws(() => inspectReferenceDxf({ text, units: 'mm' }));
  assert.throws(() => importText(text.replace('90\n6', '90\n129')));
});

test('blocks and nonselected unsupported polylines are accounted for without execution or hidden geometry', () => {
  const withBlocks = text.replace('0\nSECTION\n2\nENTITIES', '0\nSECTION\n2\nBLOCKS\n0\nINSERT\n2\nexternal-file\n0\nENDSEC\n0\nSECTION\n2\nENTITIES').replace('70\n129', '70\n0');
  const inventory = inspectReferenceDxf({ text: withBlocks }); assert.equal(inventory.candidates[1].supported, false);
  const result = importText(withBlocks); assert.deepEqual(result.bounds.size, [40, 30, 8]);
  assert.deepEqual(result.dxf_import.omitted_sections, ['HEADER', 'BLOCKS']); assert.equal(result.dxf_import.omitted_entity_count, 2);
});

test('real CLI writes only new files and reopens editable profile/layout with original input intact', async () => {
  const dir = await mkdtemp(path.join(root, 'cli-')), cli = new URL('../bin/moonmold-reference-dxf.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const base = ['--input', fixture.pathname, '--entity', '1', '--units', 'mm', '--height', '8', '--name', options.name];
  assert.equal(JSON.parse(run(['--input', fixture.pathname]).stdout).entity_count, 3);
  for (const format of ['recipe', 'layout', 'json', 'obj', 'stl']) {
    const file = path.join(dir, format); const execution = run([...base, '--format', format, '--output', file]);
    assert.equal(execution.status, 0, execution.stderr); const output = await readFile(file, 'utf8');
    if (format === 'recipe') assert.deepEqual(extrudeReferenceProfile(JSON.parse(output)).bounds.size, [40, 30, 8]);
    if (format === 'layout') assert.deepEqual(composeReferenceLayout(JSON.parse(output)).bounds.size, [40, 30, 8]);
    assert.equal(run([...base, '--format', format, '--output', file]).status, 1); assert.equal(await readFile(file, 'utf8'), output);
  }
  for (const args of [base, [...base, '--format', 'mesh'], [...base, '--format', 'obj', '--entity', '3'], ['--input', fixture.pathname, '--bad', 'value'], ['--input', dir]]) assert.equal(run(args).status, 1);
  const bad = path.join(dir, 'bad.dxf'); await writeFile(bad, Buffer.from([0xff])); assert.equal(run(['--input', bad]).status, 1);
  assert.equal(await readFile(fixture, 'utf8'), text);
});

test('actual operator HTTP supports inspect/import and preserves clear errors', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'http-')); const server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve))); const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/reference-profile'); assert.match(await page.text(), /Inspect drawing outlines/);
  const call = (route, body) => fetch(base + '/api/reference-profile/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const inspect = await call('dxf-inspect', { text }); assert.equal(inspect.status, 200); assert.equal((await inspect.json()).candidates.length, 2);
  const build = await call('dxf-import', options); assert.equal(build.status, 200); assert.deepEqual((await build.json()).bounds.size, [40, 30, 8]);
  assert.equal((await call('dxf-import', { ...options, entity: 2 })).status, 400);
  assert.equal((await call('dxf-inspect', { text: ' '.repeat(400001) })).status, 400);
});
