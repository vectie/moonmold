import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { alignReferenceLayout } from './reference-alignment.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { createOperatorServer } from './operator-server.mjs';

const seed = JSON.parse(await readFile(new URL('../fixtures/reference-alignment.layout.json', import.meta.url), 'utf8'));
const request = () => ({ layout: structuredClone(seed), instance_id: 'panel', reference_id: 'stand', axis: 'z', moving_anchor: 'min', reference_anchor: 'max', offset_mm: 5 });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const anchor = (bounds, name, axis) => name === 'center' ? (bounds.min[axis] + bounds.max[axis]) / 2 : bounds[name][axis];

test('aligns a rotated scaled named OBJ panel above PLY bounds while preserving exact sources and lineage', () => {
  const input = request(), snapshot = structuredClone(input), before = composeReferenceLayout(input.layout);
  const result = alignReferenceLayout(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result.parts[0].bounds.size, before.parts[0].bounds.size);
  assert.deepEqual(result.layout.instances[0].transform, { ...before.layout.instances[0].transform, translation_mm: [100, 20, 45] });
  assert.deepEqual(result.parts[1], before.parts[1]);
  for (const [index, part] of result.parts.entries()) {
    assert.deepEqual(result.layout.instances[index].source, before.layout.instances[index].source);
    assert.equal(part.source_sha256, before.parts[index].source_sha256);
  }
  assert.deepEqual(result.parts[0].selection.part_ids, ['object-1']);
  assert.deepEqual(result.parts[0].triangle_source_faces, before.parts[0].triangle_source_faces);
  assert.deepEqual(result.parts[0].source_faces, before.parts[0].source_faces);
  assert.equal(result.alignment.parent_layout_sha256, before.layout_sha256);
  assert.equal(result.alignment.translation_delta_mm, 40);
  assert.equal(result.alignment.actual_offset_mm, 5);
  assert.equal(result.alignment.residual_mm, 0);
  assert.equal(result.physical_authority, false);
  assert.match(result.alignment.semantics, /No persistent constraint/);
});

test('all three world axes and min/center/max anchor pairs obey signed offsets on transformed bounds', () => {
  for (const [axisIndex, axis] of ['x', 'y', 'z'].entries()) for (const moving_anchor of ['min', 'center', 'max']) for (const reference_anchor of ['min', 'center', 'max']) {
    const input = { ...request(), axis, moving_anchor, reference_anchor, offset_mm: axisIndex % 2 ? -7.25 : 9.5 };
    input.layout.instances[0].transform.rotation_deg = [25, -30, 63];
    input.layout.instances[1].transform = { scale: 0.8, rotation_deg: [-17, 41, 10], translation_mm: [-20, 35, 12] };
    const before = composeReferenceLayout(input.layout), result = alignReferenceLayout(input);
    close(anchor(result.parts[0].bounds, moving_anchor, axisIndex), anchor(before.parts[1].bounds, reference_anchor, axisIndex) + input.offset_mm);
    assert.deepEqual(result.layout.instances[1], before.layout.instances[1]);
    for (let i = 0; i < 3; i++) if (i !== axisIndex) assert.equal(result.parts[0].transform.translation_mm[i], before.parts[0].transform.translation_mm[i]);
    for (let v = 0; v < before.parts[0].vertex_range.count; v++) for (let i = 0; i < 3; i++) close(result.vertices[v][i], before.vertices[v][i] + (i === axisIndex ? result.alignment.translation_delta_mm : 0));
  }
});

test('saved aligned layout reopens, derived OBJ/STL reimport, and later reference edits do not move the aligned part', () => {
  const aligned = alignReferenceLayout(request()), saved = JSON.parse(aligned.exports.layout);
  const reopened = composeReferenceLayout(saved);
  assert.equal(reopened.layout_sha256, aligned.layout_sha256);
  assert.equal(reopened.geometry_sha256, aligned.geometry_sha256);
  for (const input_format of ['obj', 'stl']) {
    const imported = importReferenceMesh({ input_format, text: aligned.exports[input_format], units: 'mm' });
    assert.equal(imported.triangle_count, aligned.triangle_count);
    imported.bounds.min.forEach((n, i) => close(n, aligned.bounds.min[i]));
    imported.bounds.max.forEach((n, i) => close(n, aligned.bounds.max[i]));
  }
  saved.instances[1].transform.translation_mm[2] += 50;
  const edited = composeReferenceLayout(saved);
  assert.deepEqual(edited.parts[0], aligned.parts[0]);
  assert.equal(edited.parts[1].bounds.max[2], aligned.parts[1].bounds.max[2] + 50);
  const repeat = alignReferenceLayout({ ...request(), layout: aligned.layout });
  assert.equal(repeat.alignment.translation_delta_mm, 0);
  assert.equal(repeat.layout_sha256, aligned.layout_sha256);
});

test('binary STL in inches remains byte-identical and a third untouched placement stays unchanged', async () => {
  const input = request(), bytes = await readFile(new URL('../fixtures/reference-tetrahedron-binary.stl', import.meta.url));
  input.layout.instances[0].source = { input_format: 'stl', units: 'in', data_base64: bytes.toString('base64') };
  input.layout.instances.push({ ...structuredClone(input.layout.instances[1]), id: 'untouched' });
  const before = composeReferenceLayout(input.layout), result = alignReferenceLayout(input);
  assert.equal(result.layout.instances[0].source.data_base64, bytes.toString('base64'));
  assert.equal(result.parts[0].source_units, 'in');
  assert.equal(result.parts[0].source_encoding, 'binary');
  assert.equal(result.parts[0].source_sha256, before.parts[0].source_sha256);
  assert.deepEqual(result.parts.slice(1), before.parts.slice(1));
  assert.equal(composeReferenceLayout(JSON.parse(result.exports.layout)).geometry_sha256, result.geometry_sha256);
});

test('bounds include orphan vertices and floating-point residual is exposed rather than a contact claim', () => {
  const input = request();
  input.layout.instances[1].source = { input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 100\nf 1 2 3\n' };
  const result = alignReferenceLayout(input);
  assert.equal(result.parts[0].bounds.min[2], 105);
  assert.equal(result.alignment.reference_anchor_mm, 100);
  input.axis = 'x'; input.offset_mm = 1e-20; input.layout.instances[1].transform.translation_mm = [1e8, 0, 0];
  const tiny = alignReferenceLayout(input);
  assert.equal(tiny.alignment.offset_mm, 1e-20);
  assert.equal(tiny.alignment.actual_offset_mm, 0);
  assert.equal(tiny.alignment.residual_mm, -1e-20);
});

test('invalid anchors, identities, offsets and out-of-range results reject without mutating the request', () => {
  for (const input of [null, [], {}, { ...request(), extra: true }, { ...request(), axis: 'X' }, { ...request(), instance_id: 'missing' }, { ...request(), reference_id: 'panel' }, { ...request(), reference_id: null }]) assert.throws(() => alignReferenceLayout(input));
  for (const key of ['moving_anchor', 'reference_anchor']) for (const value of [null, 'middle', [], 1]) assert.throws(() => alignReferenceLayout({ ...request(), [key]: value }), { code: 'invalid-reference-alignment' });
  for (const offset_mm of [undefined, null, '5', NaN, Infinity, -1e10]) assert.throws(() => alignReferenceLayout({ ...request(), offset_mm }), { code: 'invalid-reference-alignment' });
  const input = { ...request(), offset_mm: 1e9 }, original = structuredClone(input);
  assert.throws(() => alignReferenceLayout(input), /coordinate exceeds/);
  assert.deepEqual(input, original);
  const malformed = request(); malformed.layout.instances[0].source.units = 'guess';
  assert.throws(() => alignReferenceLayout(malformed), /units/);
});

test('CLI writes real editable source and reports/OBJ/STL, reopens, and refuses overwrites and malformed input', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moonmold-alignment-cli-'));
  const cli = new URL('../bin/moonmold-reference-align.mjs', import.meta.url).pathname;
  const input = new URL('../fixtures/reference-alignment.layout.json', import.meta.url).pathname;
  const args = ['--input', input, '--instance', 'panel', '--reference', 'stand', '--axis', 'z', '--moving-anchor', 'min', '--reference-anchor', 'max', '--offset-mm', '5'];
  const run = extra => spawnSync(process.execPath, [cli, ...args, ...extra], { encoding: 'utf8' });
  const baseline = alignReferenceLayout(request()), stdout = run([]);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.equal(composeReferenceLayout(JSON.parse(stdout.stdout)).layout_sha256, baseline.layout_sha256);
  for (const format of ['layout', 'json', 'obj', 'stl']) {
    const output = path.join(dir, `aligned.${format}`), written = run(['--format', format, '--output', output]);
    assert.equal(written.status, 0, written.stderr);
    const text = await readFile(output, 'utf8');
    assert.equal(text, format === 'json' ? JSON.stringify(baseline, null, 2) + '\n' : baseline.exports[format]);
    assert.equal(run(['--format', format, '--output', output]).status, 1);
    assert.equal(await readFile(output, 'utf8'), text);
  }
  for (const extra of [['--format', 'svg'], ['--axis', 'x'], ['--wrong', 'x']]) assert.equal(run(extra).status, 1);
  const negative = spawnSync(process.execPath, [cli, ...args.slice(0, -1), '-2.5e1'], { encoding: 'utf8' });
  assert.equal(negative.status, 0, negative.stderr);
  assert.equal(JSON.parse(negative.stdout).instances[0].transform.translation_mm[2], 15);
  const bad = path.join(dir, 'bad.json'); await writeFile(bad, Buffer.from([0xff]));
  const badArgs = [cli, ...args]; badArgs[2] = bad;
  assert.equal(spawnSync(process.execPath, badArgs).status, 1);
  await writeFile(bad, ' '.repeat(3_000_001));
  assert.match(spawnSync(process.execPath, badArgs, { encoding: 'utf8' }).stderr, /exceeds 3000000/);
});

async function serverFor(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moonmold-alignment-http-'));
  const server = createOperatorServer({ workspaceRoot: dir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP aligns and reopens output; invalid requests fail with useful 400 response', async t => {
  const base = await serverFor(t);
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/api/reference-layout/align', request()); assert.equal(response.status, 200);
  const result = await response.json(); assert.deepEqual(result, alignReferenceLayout(request()));
  const reopened = await post('/api/reference-layout/compose', JSON.parse(result.exports.layout));
  assert.equal((await reopened.json()).geometry_sha256, result.geometry_sha256);
  const bad = await post('/api/reference-layout/align', { ...request(), reference_id: 'panel' });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).code, 'invalid-reference-alignment');
  assert.equal((await fetch(base + '/api/reference-layout/align', { method: 'POST', body: ' '.repeat(3_000_001) })).status, 400);
});

test('served UI aligns last applied placement, saves/reopens, updates reference choices, and retains outputs on errors', async t => {
  const base = await serverFor(t), html = await (await fetch(base + '/reference-layout')).text();
  const elements = new Map(), blobs = new Map(), calls = []; let serial = 0, hold = null;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', textContent: '', children: [], handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  el('preview').width = 1000; el('preview').height = 400;
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}) }, Blob, Uint8Array, btoa,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    fetch: async (route, options) => { calls.push({ route, body: JSON.parse(options.body) }); if (hold) await new Promise(resolve => { hold = resolve; }); return fetch(base + route, options); }
  });
  const event = { preventDefault() {} }, saved = async () => JSON.parse(await blobs.get(el('downloads').children[0].href).text());
  el('layout-file').files = [{ size: 2000, text: async () => JSON.stringify(seed) }];
  await el('load-form').handlers.submit(event);
  assert.equal(el('align-controls').disabled, false); assert.equal(el('align-reference').value, 'stand');
  el('align-axis').value = 'z'; el('moving-anchor').value = 'min'; el('reference-anchor').value = 'max'; el('align-offset').value = '5';
  el('tz').value = '999'; // Do not incorporate unapplied placement fields.
  hold = true; const pending = el('align-form').handlers.submit(event), count = calls.length;
  assert.equal(el('align-controls').disabled, true); await el('align-form').handlers.submit(event);
  assert.equal(calls.length, count); hold(); hold = null; await pending;
  const aligned = await saved(); assert.deepEqual(aligned, alignReferenceLayout(request()).layout);
  assert.equal(el('selected').value, 'panel'); assert.equal(el('tz').value, '45'); assert.match(el('status').textContent, /actual: 5 mm/);
  const report = JSON.parse(await blobs.get(el('downloads').children[3].href).text()); assert.equal(report.alignment.offset_mm, 5);
  const old = el('downloads').children[0].href; el('align-offset').value = '1000000000'; await el('align-form').handlers.submit(event);
  assert.equal(el('downloads').children[0].href, old); assert.match(el('status').textContent, /unchanged/);
  el('align-offset').value = ''; await el('align-form').handlers.submit(event); assert.equal(el('downloads').children[0].href, old);
  el('selected').value = 'stand'; el('selected').handlers.change();
  assert.equal(el('align-reference').value, 'panel'); assert.deepEqual(el('align-reference').children.map(option => option.value), ['panel']);
  el('layout-file').files = [{ size: 3000, text: async () => JSON.stringify(aligned) }]; await el('load-form').handlers.submit(event);
  assert.deepEqual(await saved(), aligned);
  el('tx').value = '120'; await el('edit-form').handlers.submit(event); assert.equal((await saved()).instances[0].transform.translation_mm[0], 120);
  await el('remove').handlers.click(); assert.equal(el('align-controls').disabled, true);
  await el('remove').handlers.click(); assert.equal(el('align-reference').children.length, 0); assert.equal(el('downloads').children.length, 0);
});
