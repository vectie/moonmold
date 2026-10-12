import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { replaceReferenceSources } from './reference-replacement.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { canonicalJson } from './protocol.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const example = JSON.parse(await readFile(fixture('reference-replacement.layout.json'), 'utf8'));
const revisionBytes = await readFile(fixture('reference-revised-panel.obj'));
const source = { input_format: 'obj', units: 'cm', name: 'reference-revised-panel.obj', text: revisionBytes.toString('utf8') };
const copy = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const revise = (overrides = {}) => replaceReferenceSources({ layout: example, instance_ids: ['left', 'right'], source, ...overrides });
const near = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-9, `${actual} != ${expected}`));
const partVertices = (result, id) => { const range = result.parts.find(p => p.id === id).vertex_range; return result.vertices.slice(range.start, range.start + range.count); };
const root = process.env.MOONMOLD_REPLACEMENT_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-replacement-tests');
await mkdir(root, { recursive: true });
const workdir = () => mkdtemp(path.join(root, 'case-'));
const cli = new URL('../bin/moonmold-reference-replace.mjs', import.meta.url).pathname;
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const args = ['--input', fixture('reference-replacement.layout.json').pathname, '--instances', 'left,right', '--mesh', fixture('reference-revised-panel.obj').pathname, '--units', 'cm'];

test('explicit source revisions preserve placement recipes, ids, order and untouched shared source instances', () => {
  const original = copy(example), newSource = copy(source), before = composeReferenceLayout(example);
  const after = revise({ instance_ids: ['right', 'left'] });
  assert.deepEqual(example, original); assert.deepEqual(source, newSource);
  assert.deepEqual(after.layout.instances.map(p => p.id), ['left', 'right', 'untouched']);
  assert.deepEqual(after.layout.instances.map(p => p.transform), before.layout.instances.map(p => p.transform));
  assert.deepEqual(after.layout.instances[2], before.layout.instances[2]);
  assert.deepEqual(partVertices(after, 'untouched'), partVertices(before, 'untouched'));
  assert.equal(after.layout.instances[0].source.text, revisionBytes.toString('utf8'));
  assert.equal(after.layout.instances[0].source.part_ids, undefined);
  assert.equal(after.parts[0].source_sha256, sha(revisionBytes));
  near(after.parts[0].bounds.min, [70, -60, 5]); near(after.parts[0].bounds.max, [130, 100, 5]);
  near(after.parts[1].bounds.min, [-90, -5, 2]); near(after.parts[1].bounds.max, [-50, 10, 2]);
  assert.deepEqual(after.replacement.instance_ids, ['left', 'right']);
  assert.deepEqual(after.replacement.changes[0].before.part_ids, ['object-1']);
  assert.equal(after.replacement.changes[0].after.part_ids, undefined);
  assert.equal(after.replacement.parent_layout_sha256, before.layout_sha256);
  assert.equal(after.replacement.parent_geometry_sha256, before.geometry_sha256);
  assert.equal(after.replacement.layout_sha256, sha(canonicalJson(after.layout)));
  assert.equal(after.replacement.geometry_sha256, sha(canonicalJson({ units: 'mm', vertices: after.vertices, triangles: after.triangles })));
  assert.equal(after.physical_authority, false);
});

test('same bytes with explicit new units change geometry; comment-only source revisions change lineage alone', () => {
  const before = composeReferenceLayout(example);
  const commentSource = { ...example.instances[0].source, text: example.instances[0].source.text + '# source revision only\n' };
  const comments = revise({ instance_ids: ['left'], source: commentSource });
  assert.equal(comments.geometry_sha256, before.geometry_sha256); assert.notEqual(comments.layout_sha256, before.layout_sha256);
  const units = revise({ instance_ids: ['left'], source: { ...example.instances[0].source, units: 'mm' } });
  assert.equal(units.parts[0].source_sha256, before.parts[0].source_sha256);
  near(units.parts[0].bounds.size, [8, 12, 0]); assert.notEqual(units.geometry_sha256, before.geometry_sha256);
});

test('new selections are explicit; origin changes are respected and grounding is recomputed', async () => {
  const selected = revise({ instance_ids: ['right'], source: { input_format: 'obj', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'), 'utf8'), part_ids: ['object-2'] } });
  assert.deepEqual(selected.layout.instances[1].source.part_ids, ['object-2']);
  assert.deepEqual(selected.replacement.changes[0].after.part_ids, ['object-2']);
  const movedSource = { ...source, text: source.text.replace('v 0 0 0', 'v 10 0 0').replace('v 8 0 0', 'v 18 0 0').replace('v 8 3 0', 'v 18 3 0').replace('v 0 3 0', 'v 10 3 0') };
  const shifted = revise({ source: movedSource });
  near(shifted.parts[0].bounds.min, [70, -60, 5]);
  near(shifted.parts[1].bounds.min, [-140, -5, 2]);
  assert.match(shifted.replacement.semantics, /center\/ground is recomputed/);
});

test('binary STL and PLY and selected GLB nodes retain exact new source bytes', async () => {
  for (const [file, format, units] of [['reference-tetrahedron-binary.stl', 'stl', 'cm'], ['reference-tetrahedron-le.ply', 'ply', 'cm'], ['reference-scene.glb', 'glb', 'm']]) {
    const bytes = await readFile(fixture(file));
    const imported = importReferenceMesh({ input_format: format, units, data_base64: bytes.toString('base64') });
    const node_ids = format === 'glb' ? [imported.glb_nodes[0].node_index] : undefined;
    const replacement = { input_format: format, units, data_base64: bytes.toString('base64'), ...(node_ids ? { node_ids } : {}) };
    const after = revise({ instance_ids: ['left'], source: replacement });
    assert.equal(after.parts[0].source_sha256, sha(bytes));
    assert.equal(after.layout.instances[0].source.data_base64, bytes.toString('base64'));
    assert.deepEqual(after.replacement.changes[0].after.node_ids, node_ids);
    assert.deepEqual(composeReferenceLayout(JSON.parse(after.exports.layout)).layout, after.layout);
    assert.deepEqual(partVertices(after, 'right'), partVertices(composeReferenceLayout(example), 'right'));
  }
});

test('save/reopen and regenerated OBJ/STL/drawing/GLB use revised geometry and stable identities', () => {
  const after = revise(), saved = JSON.parse(after.exports.layout), reopened = composeReferenceLayout(saved);
  assert.deepEqual(reopened.layout, after.layout); assert.equal(reopened.geometry_sha256, after.geometry_sha256);
  assert.equal(reopened.exports.obj, after.exports.obj); assert.equal(reopened.exports.stl, after.exports.stl);
  const obj = importReferenceMesh({ input_format: 'obj', units: 'mm', text: after.exports.obj });
  assert.deepEqual(obj.vertices, after.vertices); assert.deepEqual(obj.triangles, after.triangles);
  const stl = importReferenceMesh({ input_format: 'stl', units: 'mm', text: after.exports.stl });
  near(stl.bounds.min, after.bounds.min); near(stl.bounds.max, after.bounds.max);
  const drawing = drawReferenceLayout(saved);
  assert.equal(drawing.layout_sha256, after.layout_sha256); assert.equal(drawing.geometry_sha256, after.geometry_sha256);
  assert.notEqual(drawing.exports.svg, drawReferenceLayout(example).exports.svg);
  assert.equal(drawReferenceLayout(reopened.layout).exports.svg, drawing.exports.svg);
  assert.deepEqual(exportReferenceLayoutGlb(saved), exportReferenceLayoutGlb(reopened.layout));
  const glb = importReferenceMesh({ input_format: 'glb', units: 'm', data_base64: exportReferenceLayoutGlb(saved).toString('base64') });
  assert.equal(glb.triangle_count, after.triangle_count);
  glb.bounds.min.forEach((n, i) => assert.ok(Math.abs(n - after.bounds.min[i]) < 1e-4));
  glb.bounds.max.forEach((n, i) => assert.ok(Math.abs(n - after.bounds.max[i]) < 1e-4));
});

test('invalid targets, units, selections, payloads and oversized resulting layout reject atomically', () => {
  const original = copy(example);
  for (const instance_ids of [[], ['left', 'left'], ['missing'], ['left', 'missing'], [1], null]) assert.throws(() => revise({ instance_ids }), { code: 'invalid-reference-replacement' });
  for (const input of [null, {}, { layout: example, instance_ids: ['left'], source, url: 'file:///tmp/model' }]) assert.throws(() => replaceReferenceSources(input));
  for (const replacement of [null, {}, { ...source, units: 'guess' }, { ...source, path: 'mesh.obj' }, { ...source, text: 'broken' }, { ...source, part_ids: ['object-999'] }, { ...source, text: '#'.repeat(400001) }, { ...source, text: '\ud800' }]) assert.throws(() => revise({ source: replacement }));
  const large = { ...source, text: source.text + '#' + 'x'.repeat(399000) };
  const many = { ...example, instances: Array.from({ length: 6 }, (_, i) => ({ ...copy(example.instances[0]), id: `part-${i}` })) };
  assert.throws(() => revise({ layout: many, instance_ids: many.instances.map(i => i.id), source: large }), /2000000/);
  assert.deepEqual(example, original);
});

test('CLI supports file and portable source revisions, exact outputs and exclusive creation', async () => {
  const dir = await workdir();
  const result = run(args); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, revise().exports.layout);
  const output = path.join(dir, 'revised.layout.json');
  assert.equal(run([...args, '--output', output]).status, 0);
  assert.equal(run([...args, '--output', output]).status, 1); assert.equal(await readFile(output, 'utf8'), result.stdout);
  for (const format of ['json', 'obj', 'stl']) {
    const result = run([...args, '--format', format]); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, format === 'json' ? JSON.stringify(revise(), null, 2) + '\n' : revise().exports[format]);
  }
  const portable = path.join(dir, 'source.json'); await writeFile(portable, JSON.stringify(source));
  const fromSource = run(args.slice(0, 4).concat(['--source', portable]));
  assert.equal(fromSource.status, 0, fromSource.stderr); assert.equal(fromSource.stdout, result.stdout);
  const selected = run([...args, '--parts', 'object-1']); assert.equal(selected.status, 1);
  for (const extra of [['--format', 'svg'], ['--input', 'duplicate'], ['--url', 'bad'], ['--units'], ['--source', portable], ['--nodes', '-1']]) assert.equal(run([...args, ...extra]).status, 1);
});

test('CLI rejects malformed UTF-8 and oversized files without creating output', async () => {
  const dir = await workdir();
  for (const [name, bytes] of [['bad.obj', Buffer.from([0xff])], ['huge.obj', Buffer.alloc(400001, 35)]]) {
    const file = path.join(dir, name), output = path.join(dir, `${name}.out`); await writeFile(file, bytes);
    const result = run([...args.slice(0, 4), '--mesh', file, '--units', 'cm', '--output', output]);
    assert.equal(result.status, 1); await assert.rejects(access(output));
  }
});

test('real HTTP replacement and served production UI agree with CLI; invalid requests return 400', async t => {
  const server = createOperatorServer({ workspaceRoot: await workdir() });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(`${base}/api/reference-layout/replace-source`, { method: 'POST', body });
  const response = await send(JSON.stringify({ layout: example, instance_ids: ['left', 'right'], source }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), revise());
  for (const bad of ['{broken', '{}', ' '.repeat(3000001), JSON.stringify({ layout: example, instance_ids: ['missing'], source })]) assert.equal((await send(bad)).status, 400);
  const html = await (await fetch(`${base}/reference-layout`)).text(); assert.match(html, /Replace chosen sources/);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('served UI replacement keeps applied transforms, clears old outputs, retains failures and ignores repeated submits', async () => {
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
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(example) }];
  const file = { name: 'reference-revised-panel.obj', size: revisionBytes.length, arrayBuffer: async () => Uint8Array.from(revisionBytes).buffer };
  el('replace-file').files = [file]; el('replace-units').value = 'cm';
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob, TextDecoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (url.endsWith('/replace-source')) {
        if (hold) await new Promise(resolve => { hold = resolve; });
        if (fail) return { ok: false, json: async () => ({ message: 'Replacement unavailable' }) };
        const next = replaceReferenceSources(input); if (mismatch) next.replacement.parent_layout_sha256 = '0'.repeat(64);
        return { ok: true, json: async () => next };
      }
      if (url.endsWith('/drawing')) return { ok: true, json: async () => drawReferenceLayout(input) };
      if (url.endsWith('/glb')) return { ok: true, arrayBuffer: async () => exportReferenceLayoutGlb(input) };
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} }, submit = () => el('replace-form').handlers.submit(event);
  await submit(); assert.equal(calls.length, 0);
  await el('load-form').handlers.submit(event);
  assert.equal(el('replace-controls').disabled, false);
  assert.deepEqual(el('replace-targets').selectedOptions.map(c => c.value), ['left']);
  el('replace-targets').children[1].selected = true;
  await el('drawing-export').handlers.click(); await el('glb-export').handlers.click();
  const originalLinks = el('downloads').children, drawingUrl = el('drawing-download').children[0].href, glbUrl = el('glb-download').children[0].href;
  for (const mode of ['failure', 'mismatch']) {
    fail = mode === 'failure'; mismatch = mode === 'mismatch'; await submit();
    assert.equal(el('downloads').children, originalLinks); assert.equal(el('drawing-download').children[0].href, drawingUrl);
    assert.match(el('status').textContent, /Replacement unavailable|does not match/);
  }
  fail = false; mismatch = false;
  el('tx').value = '123'; el('tx').handlers.input(); const count = calls.length;
  assert.equal(el('replace-controls').disabled, true); await submit(); assert.equal(calls.length, count);
  await el('edit-form').handlers.submit(event);
  el('replace-targets').children[1].selected = true;
  hold = true;
  const pending = submit();
  // Reading a real local file is asynchronous before the replacement request.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el('replace-controls').disabled, true); const pendingCount = calls.length;
  await submit(); assert.equal(calls.length, pendingCount);
  const release = hold; hold = null; release(); await pending;
  const request = calls.findLast(c => c.url.endsWith('/replace-source')).input;
  assert.deepEqual(request.instance_ids, ['left', 'right']); assert.equal(request.layout.instances[0].transform.translation_mm[0], 123);
  const savedLink = el('downloads').children.find(c => c.download.endsWith('.layout.json'));
  const saved = JSON.parse(await blobs.get(savedLink.href).text());
  assert.equal(saved.instances[0].transform.translation_mm[0], 123);
  assert.equal(saved.instances[0].source.text, source.text); assert.equal(saved.instances[1].source.text, source.text);
  assert.deepEqual(saved.instances[2].source, composeReferenceLayout(example).layout.instances[2].source);
  assert.equal(el('drawing-download').children.length, 0); assert.equal(el('glb-download').children.length, 0);
  assert.ok(revoked.includes(drawingUrl)); assert.ok(revoked.includes(glbUrl));
  assert.equal(el('measure-a-instance').value, ''); assert.equal(el('measure-a-vertex').value, '');
  assert.equal(el('replace-units').value, ''); assert.match(el('status').textContent, /Replaced sources: left, right/);
  const report = el('downloads').children.find(c => c.download.endsWith('.report.json'));
  assert.equal(JSON.parse(await blobs.get(report.href).text()).replacement.instance_ids.length, 2);
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(saved) }];
  await el('load-form').handlers.submit(event); await el('drawing-export').handlers.click();
  assert.equal(await blobs.get(el('drawing-download').children[0].href).text(), drawReferenceLayout(saved).exports.svg);
  const lastGood = el('downloads').children;
  el('replace-units').value = 'cm'; el('replace-file').files = [{ ...file, arrayBuffer: async () => Uint8Array.from([255]).buffer }];
  await submit(); assert.equal(el('downloads').children, lastGood); assert.match(el('status').textContent, /encoded data|encoding/i);
  while (el('replace-controls').disabled === false) await el('remove').handlers.click();
  assert.equal(el('replace-targets').children.length, 0); assert.equal(el('replace-controls').disabled, true);
});
