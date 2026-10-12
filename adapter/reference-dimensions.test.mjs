import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drawReferenceDimensions, DIMENSIONS_CONTRACT } from './reference-dimensions.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { measureReferenceLayout } from './reference-measurement.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const seed = JSON.parse(await readFile(fixture('reference-measurement.layout.json'), 'utf8'));
const example = JSON.parse(await readFile(fixture('reference-drawing.layout.json'), 'utf8'));
const exampleSet = JSON.parse(await readFile(fixture('reference-drawing.dimensions.json'), 'utf8'));
const copy = value => structuredClone(value);
const endpoint = (instance_id, vertex_index) => ({ instance_id, vertex_index });
const pair = (name, a = endpoint('triangle', 0), b = endpoint('triangle', 1)) => ({ name, endpoint_a: a, endpoint_b: b });
function request(layout = seed, dimensions = [pair('Diagonal')]) {
 const c = composeReferenceLayout(layout);
 return { layout: copy(layout), dimensions: { contract_id: DIMENSIONS_CONTRACT, expected_layout_sha256: c.layout_sha256, expected_geometry_sha256: c.geometry_sha256, dimensions } };
}
const unxml = text => text.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const metadata = svg => JSON.parse(unxml(svg.match(/<metadata>([\s\S]*?)<\/metadata>/)[1]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('named literal 3–4–5 and cross-instance 13 mm dimensions coexist with exact metadata and sources', () => {
 const input = request(seed, [pair('Diagonal'), pair('Lift', endpoint('triangle', 0), endpoint('translated', 0)), pair('Reverse', endpoint('triangle', 1), endpoint('triangle', 0)), pair('Same point', endpoint('triangle', 0), endpoint('triangle', 0))]);
 const before = copy(input), sheet = drawReferenceDimensions(input), { exports, ...report } = sheet;
 assert.deepEqual(input, before); assert.deepEqual(sheet.dimensions.map(d => d.distance_mm), [5, 13, 5, 0]);
 assert.deepEqual(sheet.dimensions[2].delta_b_minus_a_mm, { x: -3, y: -4, z: 0 });
 assert.deepEqual(metadata(exports.svg), report); assert.deepEqual(JSON.parse(exports.dimensions), input.dimensions);
 assert.equal(sheet.dimensions[0].endpoint_a.source_sha256, sha(seed.instances[0].source.text));
 assert.equal(sheet.physical_authority, false); assert.match(exports.svg, /true 3D distance/); assert.match(exports.svg, /no Blender execution/);
 assert.equal((exports.svg.match(/data-named-dimension="D1"/g) ?? []).length, 3);
 assert.equal((exports.svg.match(/data-dimension-row=/g) ?? []).length, 4);
 assert.match(exports.svg, /D1. Diagonal · 3D distance 5 mm/);
 assert.doesNotMatch(exports.svg, /NaN|Infinity/);
});

test('zero projected length stays distinct from nonzero true 3D distance', () => {
 const layout = copy(seed); layout.instances[1].transform = { translation_mm: [0, 0, 12] };
 const sheet = drawReferenceDimensions(request(layout, [pair('Vertical', endpoint('triangle', 0), endpoint('translated', 0))]));
 assert.equal(sheet.dimensions[0].distance_mm, 12);
 const top = sheet.exports.svg.split('<g id="view-top"')[1].split('<g id="view-front"')[0];
 const line = top.match(/data-named-dimension="D1"[\s\S]*?<path d="M([^L]+)L([^"]+)"/);
 assert.equal(line[1], line[2]); assert.match(sheet.named_dimension_policy, /may collapse or overlap/);
});

test('mixed units, rotation, grounding, selected OBJ provenance and binary imports use placed source coordinates', async () => {
 for (const [units, multiplier] of [['mm', 1], ['cm', 10], ['m', 1000], ['in', 25.4]]) {
  const layout = copy(seed); layout.instances = [layout.instances[0]]; layout.instances[0].source.units = units;
  layout.instances[0].transform = { scale: 2, rotation_deg: [30, 60, 90], center_and_ground: true, translation_mm: [10, -20, 30] };
  const sheet = drawReferenceDimensions(request(layout)); close(sheet.dimensions[0].distance_mm, 10 * multiplier);
  assert.equal(sheet.dimensions[0].endpoint_a.source_units, units);
 }
 const selected = JSON.parse(await readFile(fixture('reference-alignment.layout.json'), 'utf8'));
 const a = endpoint('panel', 0), b = endpoint('panel', 2), input = request(selected, [pair('Panel', a, b)]);
 const actual = drawReferenceDimensions(input).dimensions[0];
 const single = measureReferenceLayout({ layout: selected, endpoint_a: a, endpoint_b: b, expected_layout_sha256: input.dimensions.expected_layout_sha256, expected_geometry_sha256: input.dimensions.expected_geometry_sha256 });
 assert.deepEqual(actual.endpoint_a, single.endpoint_a); assert.deepEqual(actual.endpoint_b, single.endpoint_b);
 assert.deepEqual(actual.endpoint_a.selection.part_ids, ['object-1']);
 const binary = copy(seed); binary.instances = [{ id: 'triangle', source: { input_format: 'stl', units: 'in', data_base64: (await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') } }];
 const measured = drawReferenceDimensions(request(binary)); assert.equal(measured.dimensions[0].endpoint_a.source_encoding, 'binary'); close(measured.dimensions[0].distance_mm, 76.2);
});

test('deterministic companion reopen, reordered keys and changed names preserve geometry but update set identity', () => {
 const first = drawReferenceDimensions({ layout: example, dimensions: exampleSet });
 const reopened = JSON.parse(composeReferenceLayout(example).exports.layout);
 assert.deepEqual(drawReferenceDimensions({ layout: reopened, dimensions: JSON.parse(first.exports.dimensions) }), first);
 const input = { layout: reopened, dimensions: copy(exampleSet) }; input.dimensions.dimensions[0].name = 'Renamed base';
 const next = drawReferenceDimensions(input); assert.notEqual(next.dimension_set_sha256, first.dimension_set_sha256);
 assert.equal(next.layout_sha256, first.layout_sha256); assert.equal(next.geometry_sha256, first.geometry_sha256);
 const reordered = { dimensions: [...exampleSet.dimensions], expected_geometry_sha256: exampleSet.expected_geometry_sha256, expected_layout_sha256: exampleSet.expected_layout_sha256, contract_id: exampleSet.contract_id };
 assert.deepEqual(drawReferenceDimensions({ layout: example, dimensions: reordered }), first);
 assert.equal(sha(drawReferenceLayout(example).exports.svg), '199c1ee8fc6251150cebe62521b938e0aaab90da932c342bdcc0dc9ddef34262');
});

test('source-only comments, placement, order, selection and hash tampering all reject stale sets', () => {
 for (const mutate of [input => input.layout.instances[0].source.text += '# comment\n', input => input.layout.instances[0].source.units = 'cm', input => input.layout.instances[0].transform = { scale: 2 }, input => input.layout.instances.reverse(), input => input.layout.name = 'renamed', input => input.dimensions.expected_layout_sha256 = '0'.repeat(64), input => input.dimensions.expected_geometry_sha256 = '0'.repeat(64)]) {
  const input = request(); mutate(input); const before = copy(input); assert.throws(() => drawReferenceDimensions(input), /Stale dimension set/); assert.deepEqual(input, before);
 }
 const input = request(); input.layout.instances[0].source.text += '# comment\n';
 assert.equal(composeReferenceLayout(input.layout).geometry_sha256, input.dimensions.expected_geometry_sha256);
 assert.throws(() => drawReferenceDimensions(input), /Stale dimension set/);
});

test('strict bounded companions reject stored values, unknown fields, names, endpoints and unsupported contracts', () => {
 for (const bad of [null, [], {}, { ...request(), extra: true }]) assert.throws(() => drawReferenceDimensions(bad), { code: 'invalid-reference-dimensions' });
 for (const mutate of [input => input.dimensions.contract_id = 'other', input => input.dimensions.dimensions = [], input => input.dimensions.dimensions = Array.from({ length: 13 }, (_, i) => pair(`Pair ${i}`)), input => input.dimensions.dimensions.push(pair('Diagonal')), input => input.dimensions.dimensions[0].distance_mm = 777, input => input.dimensions.dimensions[0].endpoint_a.coordinates_mm = [0, 0, 0], input => input.dimensions.dimensions[0].endpoint_b.vertex_index = 99, input => input.dimensions.dimensions[0].endpoint_b.instance_id = 'missing', input => input.dimensions.expected_layout_sha256 = 'abc', input => input.dimensions.file = '/tmp/secret']) {
  const input = request(); mutate(input); assert.throws(() => drawReferenceDimensions(input), { code: 'invalid-reference-dimensions' });
 }
 for (const name of ['', ' trailing ', 'x'.repeat(61), 'control\n', '\uFFFE', '\uFFFF', '\uD800', '\uDC00', null, 4]) { const input = request(seed, [pair(name)]); assert.throws(() => drawReferenceDimensions(input), { code: 'invalid-reference-dimensions' }); }
 const maximum = drawReferenceDimensions(request(seed, Array.from({ length: 12 }, (_, i) => pair(`Pair ${i + 1}`)))); assert.equal(maximum.dimension_count, 12);
 assert.equal((maximum.exports.svg.match(/data-dimension-row=/g) ?? []).length, 12);
});

test('names preserve valid supplementary Unicode but reject XML-forbidden characters before SVG generation', () => {
 const valid = drawReferenceDimensions(request(seed, [pair('Support 🚀')]));
 assert.equal(metadata(valid.exports.svg).dimensions[0].name, 'Support 🚀');
 for (const character of ['\uFFFE', '\uFFFF', '\uD800', '\uDC00', '\u0000', '\u001F']) {
  const input = request(seed, [pair(`Name ${character} end`)]), before = copy(input);
  assert.throws(() => drawReferenceDimensions(input), /XML-compatible/); assert.deepEqual(input, before);
 }
});

test('SVG escapes labels, omits source bytes and stays finite for tiny or coincident coordinates', () => {
 const input = request(seed, [pair('<script>alert("x")</script> & test')]), sheet = drawReferenceDimensions(input);
 assert.doesNotMatch(sheet.exports.svg, /<script|<image|<foreignObject|\bhref=|onload=|data_base64|"text":/);
 assert.match(sheet.exports.svg, /&lt;script&gt;/); assert.equal(metadata(sheet.exports.svg).dimensions[0].name, input.dimensions.dimensions[0].name);
 const layout = copy(seed); layout.instances[0].transform = { scale: 0.000001, translation_mm: [999999000, -999999000, 100] };
 assert.doesNotMatch(drawReferenceDimensions(request(layout)).exports.svg, /NaN|Infinity/);
});

test('CLI exports real SVG/report and rejects overwrite, stale companions, UTF-8, sizes and flags without output', async () => {
 const dir = await mkdtemp(path.join(tmpdir(), 'dimensions-cli-')), cli = new URL('../bin/moonmold-reference-dimensions.mjs', import.meta.url).pathname;
 const layoutFile = path.join(dir, 'layout.json'), setFile = path.join(dir, 'set.json'), output = path.join(dir, 'drawing.svg');
 const input = request(); await writeFile(layoutFile, JSON.stringify(input.layout)); await writeFile(setFile, JSON.stringify(input.dimensions));
 const args = ['--input', layoutFile, '--dimensions', setFile], run = extra => spawnSync(process.execPath, [cli, ...args, ...extra], { encoding: 'utf8' });
 const sheet = drawReferenceDimensions(input); assert.equal(run([]).stdout, sheet.exports.svg);
 assert.equal(run(['--output', output]).status, 0); assert.equal(await readFile(output, 'utf8'), sheet.exports.svg);
 assert.equal(run(['--output', output]).status, 1); assert.equal(await readFile(output, 'utf8'), sheet.exports.svg);
 assert.deepEqual(JSON.parse(run(['--format', 'json']).stdout), metadata(sheet.exports.svg));
 for (const args of [['--format', 'obj'], ['--input', layoutFile], ['--other', 'value'], ['--output']]) assert.equal(run(args).status, 1);
 for (const bad of [Buffer.from([0xff]), '{broken', ' '.repeat(32001), JSON.stringify(request(seed, [pair('Invalid \uFFFE')]).dimensions), JSON.stringify({ ...input.dimensions, expected_layout_sha256: '0'.repeat(64) })]) {
  await writeFile(setFile, bad); const absent = path.join(dir, 'absent.svg'); assert.equal(run(['--output', absent]).status, 1); await assert.rejects(access(absent));
 }
});

async function serverFor(t) {
 const dir = await mkdtemp(path.join(tmpdir(), 'dimensions-http-')), server = createOperatorServer({ workspaceRoot: dir });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 t.after(() => new Promise(resolve => server.close(resolve))); return `http://127.0.0.1:${server.address().port}`;
}
test('real HTTP returns bound SVG and companion; rejects malformed, stale and oversized requests', async t => {
 const base = await serverFor(t), input = request(), post = body => fetch(base + '/api/reference-layout/dimension-drawing', { method: 'POST', body });
 const response = await post(JSON.stringify(input)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), drawReferenceDimensions(input));
 for (const body of ['{broken', JSON.stringify(request(seed, [pair('Invalid \uFFFF')])), JSON.stringify({ ...input, dimensions: { ...input.dimensions, expected_layout_sha256: '0'.repeat(64) } }), ' '.repeat(3_100_001)]) assert.equal((await post(body)).status, 400);
 const html = await (await fetch(base + '/reference-layout')).text(); assert.match(html, /Prepare named dimension sheet/);
 const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' }); assert.equal(syntax.status, 0, syntax.stderr);
});

async function uiHarness() {
 const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
 const elements = new Map(), blobs = new Map(), revoked = [], calls = []; let serial = 0, fail = false, mismatch = false, pending = null;
 function el(id) { if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, children: [], textContent: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); } }); return elements.get(id); }
 el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} }); el('preview').width = 1000; el('preview').height = 400;
 const context = { document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob, TextDecoder,
 URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
 fetch: async (url, options) => { const input = JSON.parse(options.body); calls.push({ url, input }); if (pending) await new Promise(resolve => { pending = resolve; });
  if (fail) return { ok: false, json: async () => ({ message: 'Injected failure' }) };
  try { let result = url.endsWith('/dimension-drawing') ? drawReferenceDimensions(input) : url.endsWith('/measure') ? measureReferenceLayout(input) : composeReferenceLayout(input);
   if (mismatch && url.endsWith('/dimension-drawing')) result = { ...result, layout_sha256: '0'.repeat(64) };
   return { ok: true, json: async () => result }; } catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
 } };
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], context);
 const fire = (id, type = 'click') => el(id).handlers[type]({ preventDefault() {} });
 const load = async (layout = seed) => { el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(layout) }]; await fire('load-form', 'submit'); };
 const measure = async (bi = '1') => { for (const side of ['a', 'b']) { el(`measure-${side}-instance`).value = 'triangle'; await fire(`measure-${side}-instance`, 'change'); el(`measure-${side}-vertex`).value = side === 'a' ? '0' : bi; await fire(`measure-${side}-vertex`, 'input'); } await fire('measure-form', 'submit'); };
 const named = async name => { el('dimension-name').value = name; await fire('dimension-add'); };
 const saved = async () => JSON.parse(await blobs.get(el('dimension-save').children[0].href).text());
 return { el, blobs, revoked, calls, fire, load, measure, named, saved, context, fail(value) { fail = value; }, mismatch(value) { mismatch = value; }, hold() { pending = true; }, release() { const resolve = pending; pending = null; resolve(); } };
}

test('operator adds multiple pairs, preserves them while remeasuring, saves/reopens and removes with immutable layout', async () => {
 const h = await uiHarness(); await h.load(); await h.measure(); await h.named('Diagonal'); const first = await h.saved();
 await h.measure('3'); await h.named('Long diagonal'); assert.equal((await h.saved()).dimensions.length, 2); assert.equal(h.el('dimension-list').children.length, 2);
 await h.named('Long diagonal'); assert.match(h.el('dimension-status').textContent, /unique/); assert.equal((await h.saved()).dimensions.length, 2);
 await h.fire('dimension-export'); const links = h.el('dimension-download').children; assert.equal(links.length, 2);
 const svg = await h.blobs.get(links[0].href).text(); assert.deepEqual(metadata(svg).dimensions.map(d => d.distance_mm), [5, 13]);
 const set = await h.saved(), editable = JSON.parse(await h.blobs.get(h.el('downloads').children[0].href).text()); assert.equal(editable.dimensions, undefined);
 await h.fire('dimension-clear'); assert.equal(h.el('dimension-save').children.length, 0);
 const reordered = { dimensions: set.dimensions, expected_geometry_sha256: set.expected_geometry_sha256, expected_layout_sha256: set.expected_layout_sha256, contract_id: set.contract_id };
 h.el('dimension-file').files = [{ size: 1000, text: async () => JSON.stringify(reordered) }]; await h.fire('dimension-open'); assert.deepEqual(await h.saved(), set);
 h.el('dimension-list').value = '1'; await h.fire('dimension-remove'); assert.deepEqual(await h.saved(), first);
 await h.fire('dimension-remove'); assert.equal(h.el('dimension-list').children.length, 0); assert.equal(h.el('dimension-export').disabled, true);
});

test('operator rejects XML-forbidden names without changing a valid collection and accepts emoji', async () => {
 const h = await uiHarness(); await h.load(); await h.measure(); await h.named('Support 🚀'); const original = await h.saved();
 for (const character of ['\uFFFE', '\uFFFF', '\uD800', '\uDC00']) {
  await h.named(`Name ${character} end`); assert.match(h.el('dimension-status').textContent, /XML-compatible/); assert.deepEqual(await h.saved(), original);
 }
 await h.fire('dimension-export'); assert.equal(metadata(await h.blobs.get(h.el('dimension-download').children[0].href).text()).dimensions[0].name, 'Support 🚀');
});

test('operator keeps valid exports on failure/mismatch, prevents repeats, and invalidates applied or pending changes', async () => {
 const h = await uiHarness(); await h.load(); await h.measure(); await h.named('Diagonal'); await h.fire('dimension-export'); const original = h.el('dimension-download').children[0].href;
 h.fail(true); await h.fire('dimension-export'); assert.equal(h.el('dimension-download').children[0].href, original); h.fail(false);
 h.mismatch(true); await h.fire('dimension-export'); assert.equal(h.el('dimension-download').children[0].href, original); assert.match(h.el('status').textContent, /does not match/); h.mismatch(false);
 h.hold(); const pending = h.fire('dimension-export'), count = h.calls.length; await h.fire('dimension-export'); assert.equal(h.calls.length, count); h.release(); await pending;
 assert.ok(h.revoked.includes(original));
 h.el('scale').value = '2'; await h.fire('scale', 'input'); assert.equal(h.el('dimension-export').disabled, true); assert.equal(h.el('dimension-download').children.length, 0);
 await h.fire('edit-form', 'submit'); assert.equal(h.el('dimension-save').children.length, 0); assert.match(h.el('dimension-status').textContent, /Applied layout changed/);
 await h.measure(); await h.named('New diagonal'); await h.fire('dimension-export'); assert.equal(metadata(await h.blobs.get(h.el('dimension-download').children[0].href).text()).dimensions[0].distance_mm, 10);
 await h.fire('remove'); assert.equal(h.el('dimension-save').children.length, 0); await h.fire('remove'); assert.equal(h.el('dimension-controls').disabled, true);
});

test('late sheet or reopen results cannot replace a newer collection; stale and malformed files retain it', async () => {
 const h = await uiHarness(); await h.load(); await h.measure(); await h.named('First'); const first = await h.saved();
 h.hold(); const pending = h.fire('dimension-export'); runInNewContext("clearDimensions('Newer selection');", h.context); h.release(); await pending; assert.equal(h.el('dimension-download').children.length, 0);
 await h.named('Second'); const second = await h.saved();
 for (const contents of ['{broken', JSON.stringify({ ...first, expected_layout_sha256: '0'.repeat(64) })]) { h.el('dimension-file').files = [{ size: 1000, text: async () => contents }]; await h.fire('dimension-open'); assert.deepEqual(await h.saved(), second); }
 h.el('dimension-file').files = [{ size: 1000, text: async () => JSON.stringify(first) }]; h.hold(); const open = h.fire('dimension-open'); await new Promise(resolve => setTimeout(resolve, 0)); runInNewContext("clearDimensions('Newer selection');", h.context); h.release(); await open; assert.equal(h.el('dimension-save').children.length, 0);
});
