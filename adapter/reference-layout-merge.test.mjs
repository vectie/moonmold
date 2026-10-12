import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeReferenceLayouts } from './reference-layout-merge.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { canonicalJson } from './protocol.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const base = JSON.parse(await readFile(fixture('reference-merge-base.layout.json'), 'utf8'));
const incoming = JSON.parse(await readFile(fixture('reference-merge-incoming.layout.json'), 'utf8'));
const copy = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const request = { layout: base, incoming_layout: incoming, id_prefix: 'left', translation_mm: [30, 40, 10] };
const merge = (overrides = {}) => mergeReferenceLayouts({ ...request, ...overrides });
const near = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-9, `${actual} != ${expected}`));
const root = process.env.MOONMOLD_MERGE_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-merge-tests');
await mkdir(root, { recursive: true });
const workdir = () => mkdtemp(path.join(root, 'case-'));
const cli = new URL('../bin/moonmold-reference-merge.mjs', import.meta.url).pathname;
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const args = ['--input', fixture('reference-merge-base.layout.json').pathname, '--incoming', fixture('reference-merge-incoming.layout.json').pathname, '--prefix', 'left', '--translation-mm', '30,40,10'];

test('merge reuses two placed sources, preserving current geometry and exact originals with explicit prefixed identities', () => {
  const original = copy(request), result = merge(), before = composeReferenceLayout(base), imported = composeReferenceLayout(incoming);
  assert.deepEqual(request, original);
  assert.equal(result.layout.name, base.name);
  assert.deepEqual(result.layout.instances.map(item => item.id), ['panel', 'left.panel', 'left.rear']);
  assert.deepEqual(result.layout.instances[0], before.layout.instances[0]);
  assert.deepEqual(result.vertices.slice(0, 4), before.vertices);
  const expected = [[55, 10, 15], [55, 70, 15], [25, 70, 15], [25, 10, 15], [70, 90, 18], [50, 90, 18], [50, 80, 18], [70, 80, 18]];
  result.vertices.slice(4).forEach((point, i) => near(point, expected[i]));
  assert.deepEqual(result.triangles, [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [8, 9, 10], [8, 10, 11]]);
  assert.deepEqual(result.bounds.min, [0, 0, 0]); assert.deepEqual(result.bounds.max, [160, 120, 18]);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(result.layout.instances[i + 1].source, imported.layout.instances[i].source);
    assert.equal(result.parts[i + 1].source_sha256, sha(incoming.instances[i].source.text));
    assert.deepEqual(result.parts[i + 1].transform.rotation_deg, imported.parts[i].transform.rotation_deg);
    assert.equal(result.parts[i + 1].transform.scale, imported.parts[i].transform.scale);
    assert.equal(result.parts[i + 1].transform.center_and_ground, imported.parts[i].transform.center_and_ground);
  }
  assert.equal(result.merge.parent_layout_sha256, before.layout_sha256);
  assert.equal(result.merge.parent_geometry_sha256, before.geometry_sha256);
  assert.equal(result.merge.incoming_layout_sha256, imported.layout_sha256);
  assert.equal(result.merge.incoming_geometry_sha256, imported.geometry_sha256);
  assert.equal(result.merge.layout_sha256, sha(canonicalJson(result.layout)));
  assert.equal(result.merge.geometry_sha256, sha(canonicalJson({ units: 'mm', vertices: result.vertices, triangles: result.triangles })));
  assert.equal(result.physical_authority, false);
  assert.deepEqual(result.merge.instances[0], { incoming_instance_id: 'panel', instance_id: 'left.panel', before_translation_mm: [10, 0, 5], after_translation_mm: [40, 40, 15] });
});

test('zero/negative offsets, repeat import with a new prefix and independent post-merge edits retain the arrangement', () => {
  const unchanged = merge({ translation_mm: [0, 0, 0] }), imported = composeReferenceLayout(incoming);
  assert.deepEqual(unchanged.vertices.slice(4), imported.vertices);
  const result = merge({ layout: merge().layout, id_prefix: 'right', translation_mm: [-30, -40, -10] });
  assert.equal(result.instance_count, 5);
  imported.vertices.forEach((point, i) => near(result.vertices[i + 12], point.map((n, axis) => n + [-30, -40, -10][axis])));
  const edited = copy(result.layout); edited.instances[1].transform.translation_mm[2] += 7;
  const recomposed = composeReferenceLayout(edited);
  assert.deepEqual(recomposed.vertices.slice(8), result.vertices.slice(8));
  near(recomposed.vertices[4], [55, 10, 22]);
});

test('binary sources and selected OBJ/GLB content retain original bytes and selections after merge and reopen', async () => {
  const sources = [{ input_format: 'obj', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'), 'utf8'), part_ids: ['object-2'] }];
  for (const [file, input_format, units] of [['reference-tetrahedron-binary.stl', 'stl', 'cm'], ['reference-tetrahedron-be.ply', 'ply', 'in'], ['reference-scene.glb', 'glb', 'm']]) {
    const data_base64 = (await readFile(fixture(file))).toString('base64');
    const source = { input_format, units, data_base64 };
    if (input_format === 'glb') source.node_ids = [importReferenceMesh(source).glb_nodes[0].node_index];
    sources.push(source);
  }
  const portable = { contract_id: base.contract_id, name: 'mixed-sources', instances: sources.map((source, i) => ({ id: `part-${i}`, source })) };
  const result = merge({ incoming_layout: portable }), normalized = composeReferenceLayout(portable);
  assert.deepEqual(result.layout.instances.slice(1).map(item => item.source), normalized.layout.instances.map(item => item.source));
  assert.deepEqual(result.parts.slice(1).map(item => item.source_sha256), normalized.parts.map(item => item.source_sha256));
  assert.deepEqual(composeReferenceLayout(JSON.parse(result.exports.layout)).layout, result.layout);
});

test('merged editable layout and all existing derived formats reopen with the same source and geometry identities', () => {
  const result = merge(), reopened = composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.equal(reopened.layout_sha256, result.layout_sha256); assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  assert.deepEqual(reopened.exports, result.exports);
  const obj = importReferenceMesh({ input_format: 'obj', units: 'mm', text: result.exports.obj });
  assert.deepEqual(obj.vertices, result.vertices); assert.deepEqual(obj.triangles, result.triangles);
  const stl = importReferenceMesh({ input_format: 'stl', units: 'mm', text: result.exports.stl });
  near(stl.bounds.max, [160, 120, 18]); assert.equal(stl.triangle_count, 6);
  const drawing = drawReferenceLayout(reopened.layout);
  assert.equal(drawing.layout_sha256, result.layout_sha256); assert.equal(drawing.geometry_sha256, result.geometry_sha256);
  assert.equal(drawing.exports.svg, drawReferenceLayout(result.layout).exports.svg);
  const glb = exportReferenceLayoutGlb(reopened.layout);
  assert.deepEqual(glb, exportReferenceLayoutGlb(result.layout));
  const chunk = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8').trim());
  assert.deepEqual(chunk.nodes.map(node => node.name), ['panel', 'left.panel', 'left.rear']);
});

test('prefix collisions and invalid/oversized merged geometry reject without mutating either input', () => {
  const original = copy(request);
  for (const id_prefix of ['', null, 2, 'has space', '.starts-dot', 'a'.repeat(80)]) assert.throws(() => merge({ id_prefix }), { code: 'invalid-reference-layout-merge' });
  for (const translation_mm of [null, [], [0, 0], [0, 0, 0, 0], [0, '1', 0], [NaN, 0, 0], [Infinity, 0, 0], [1e9 + 1, 0, 0]]) assert.throws(() => merge({ translation_mm }), { code: 'invalid-reference-layout-merge' });
  for (const input of [null, [], {}, { ...request, url: 'https://invalid' }]) assert.throws(() => mergeReferenceLayouts(input));
  assert.throws(() => merge({ layout: merge().layout }), /already exists/);
  assert.throws(() => merge({ id_prefix: 'a'.repeat(79) }), /80 characters/);
  assert.throws(() => merge({ translation_mm: [1e9, 0, 0] }), /1000000000|1e9|1e\+9|coordinate/i);
  const full = { ...base, instances: Array.from({ length: 15 }, (_, i) => ({ ...copy(base.instances[0]), id: `part-${i}` })) };
  assert.throws(() => merge({ layout: full }), /16 instances/);
  const heavy = { ...base, instances: Array.from({ length: 3 }, (_, i) => ({ id: `heavy-${i}`, source: { ...base.instances[0].source, text: base.instances[0].source.text + '#' + 'x'.repeat(350000) } })) };
  assert.throws(() => merge({ layout: heavy, incoming_layout: heavy }), /2000000/);
  assert.throws(() => merge({ incoming_layout: { ...incoming, instances: [] } }), /1 through 16/);
  assert.deepEqual(request, original);
});

test('actual CLI exports, default zero offset, no-clobber files and diagnostics agree with API', async () => {
  const dir = await workdir(), output = path.join(dir, 'merged.layout.json');
  let result = run([...args, '--output', output]); assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(output, 'utf8'), merge().exports.layout);
  result = run([...args, '--output', output]); assert.equal(result.status, 1); assert.match(result.stderr, /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), merge().exports.layout);
  for (const format of ['layout', 'json', 'obj', 'stl']) {
    result = run([...args, '--format', format]); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, format === 'json' ? JSON.stringify(merge(), null, 2) + '\n' : merge().exports[format]);
  }
  result = run(args.slice(0, 6)); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, merge({ translation_mm: [0, 0, 0] }).exports.layout);
  for (const extra of [['--format', 'svg'], ['--prefix', 'duplicate'], ['--url', 'bad'], ['--output']]) assert.equal(run([...args, ...extra]).status, 1);
  for (const value of ['1,,3', '0x10,0,0', 'NaN,0,0', '0,0', '1,2,3,4', '1e999,0,0']) assert.equal(run([...args.slice(0, 6), '--translation-mm', value]).status, 1);
  assert.equal(run([...args.slice(0, 6), '--translation-mm', '-3e1,+4.0e1,.5']).status, 0);
});

test('CLI rejects malformed UTF-8, JSON and oversized incoming files without creating outputs', async () => {
  const dir = await workdir();
  for (const [name, bytes] of [['bad.json', Buffer.from([255])], ['huge.json', Buffer.alloc(3000001, 32)], ['syntax.json', '{broken']]) {
    const file = path.join(dir, name), output = path.join(dir, `${name}.out`); await writeFile(file, bytes);
    const result = run(['--input', args[1], '--incoming', file, '--prefix', 'new', '--output', output]);
    assert.equal(result.status, 1); await assert.rejects(access(output));
  }
});

test('real loopback HTTP merge is the same workflow; useful failures and served script syntax are verified', async t => {
  const server = createOperatorServer({ workspaceRoot: await workdir() });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(`${url}/api/reference-layout/merge`, { method: 'POST', body });
  const response = await send(JSON.stringify(request)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), merge());
  for (const body of ['{broken', '{}', ' '.repeat(3000001), JSON.stringify({ ...request, layout: merge().layout })]) assert.equal((await send(body)).status, 400);
  const html = await (await fetch(`${url}/reference-layout`)).text(); assert.match(html, /Merge saved arrangement/);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('actual UI merge handlers preserve edits and failures, clear stale outputs, ignore repeated clicks and reopen editable downloads', async () => {
  const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [];
  let serial = 0, fail = false, hold = null, mismatch = false;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); },
      get selectedOptions() { return this.children.filter(c => c.selected); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  el('preview').width = 1000; el('preview').height = 400;
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(base) }];
  const file = { name: 'incoming.layout.json', size: 2000, arrayBuffer: async () => Uint8Array.from(Buffer.from(JSON.stringify(incoming))).buffer };
  el('merge-file').files = [file]; el('merge-prefix').value = 'left';
  ['merge-x', 'merge-y', 'merge-z'].forEach((id, i) => el(id).value = String(request.translation_mm[i]));
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob, TextDecoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (url.endsWith('/merge')) {
        if (hold) await new Promise(resolve => { hold = resolve; });
        if (fail) return { ok: false, json: async () => ({ message: 'Merge unavailable' }) };
        try {
          const next = mergeReferenceLayouts(input); if (mismatch) next.merge.parent_layout_sha256 = '0'.repeat(64);
          return { ok: true, json: async () => next };
        } catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
      }
      if (url.endsWith('/drawing')) return { ok: true, json: async () => drawReferenceLayout(input) };
      if (url.endsWith('/glb')) return { ok: true, arrayBuffer: async () => exportReferenceLayoutGlb(input) };
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} }, submit = () => el('merge-form').handlers.submit(event);
  await submit(); assert.equal(calls.length, 0);
  await el('load-form').handlers.submit(event); assert.equal(el('merge-controls').disabled, false);
  await el('drawing-export').handlers.click(); await el('glb-export').handlers.click();
  const originalLinks = el('downloads').children, drawingUrl = el('drawing-download').children[0].href, glbUrl = el('glb-download').children[0].href;
  for (const mode of ['failure', 'mismatch']) {
    fail = mode === 'failure'; mismatch = mode === 'mismatch'; await submit();
    assert.equal(el('downloads').children, originalLinks); assert.equal(el('drawing-download').children[0].href, drawingUrl);
    assert.match(el('status').textContent, /Merge unavailable|does not match/);
  }
  fail = false; mismatch = false;
  el('tx').value = '7'; el('tx').handlers.input(); const count = calls.length;
  assert.equal(el('merge-controls').disabled, true); await submit(); assert.equal(calls.length, count);
  await el('edit-form').handlers.submit(event);
  hold = true; const pending = submit(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(el('merge-controls').disabled, true); const pendingCount = calls.length;
  await submit(); assert.equal(calls.length, pendingCount);
  const release = hold; hold = null; release(); await pending;
  assert.deepEqual(calls.findLast(c => c.url.endsWith('/merge')).input.translation_mm, [30, 40, 10]);
  const savedLink = el('downloads').children.find(c => c.download.endsWith('.layout.json'));
  const saved = JSON.parse(await blobs.get(savedLink.href).text());
  assert.equal(saved.instances[0].transform.translation_mm[0], 7);
  assert.equal(saved.instances[1].source.text, incoming.instances[0].source.text);
  assert.deepEqual(saved.instances.map(item => item.id), ['panel', 'left.panel', 'left.rear']);
  assert.equal(el('selected').value, 'left.panel'); assert.match(el('status').textContent, /Merged 2 instances/);
  assert.equal(el('drawing-download').children.length, 0); assert.equal(el('glb-download').children.length, 0);
  assert.ok(revoked.includes(drawingUrl)); assert.ok(revoked.includes(glbUrl));
  assert.equal(el('measure-a-instance').value, ''); assert.equal(el('measure-a-vertex').value, '');
  const report = el('downloads').children.find(c => c.download.endsWith('.report.json'));
  assert.equal(JSON.parse(await blobs.get(report.href).text()).merge.added_instance_count, 2);
  const lastGood = el('downloads').children;
  await submit(); assert.equal(el('downloads').children, lastGood); assert.match(el('status').textContent, /already exists/);
  el('merge-prefix').value = 'right'; await submit(); assert.match(el('status').textContent, /right.panel, right.rear/);
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(saved) }];
  await el('load-form').handlers.submit(event); await el('drawing-export').handlers.click();
  assert.equal(await blobs.get(el('drawing-download').children[0].href).text(), drawReferenceLayout(saved).exports.svg);
  const reopenedLinks = el('downloads').children;
  for (const bad of [{ ...file, arrayBuffer: async () => Uint8Array.from([255]).buffer }, { ...file, size: 3000001 }]) {
    el('merge-file').files = [bad]; await submit(); assert.equal(el('downloads').children, reopenedLinks);
    assert.match(el('status').textContent, /encoded data|encoding|3000000/i);
  }
  while (el('merge-controls').disabled === false) await el('remove').handlers.click();
  assert.equal(el('merge-controls').disabled, true);
});
