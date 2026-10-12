import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceGlbLayout } from './reference-glb-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const example = JSON.parse(await readFile(fixture('reference-drawing.layout.json'), 'utf8'));
const copy = value => structuredClone(value);
const testRoot = process.env.MOONMOLD_DRAWING_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-drawing-tests');
await mkdir(testRoot, { recursive: true });
const workdir = () => mkdtemp(path.join(testRoot, 'case-'));
const unxml = text => text.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const metadata = svg => JSON.parse(unxml(svg.match(/<metadata>([\s\S]*?)<\/metadata>/)[1]));
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} should be near ${b}`);
const paths = svg => [...svg.matchAll(/<path data-edge-count="(\d+)" d="([^"]*)"/g)].map(match => ({ count: Number(match[1]), edges: [...match[2].matchAll(/M([^L]+)L([^M]+)/g)].map(m => [m[1].split(' ').map(Number), m[2].split(' ').map(Number)]) }));

// Decode rendered path coordinates rather than comparing SVG only to a helper.
function verifyDrawing(layout) {
  const composition = composeReferenceLayout(layout), drawing = drawReferenceLayout(layout);
  const { exports, ...report } = drawing;
  assert.deepEqual(metadata(exports.svg), report);
  assert.equal(drawing.layout_sha256, composition.layout_sha256);
  assert.equal(drawing.geometry_sha256, composition.geometry_sha256);
  const parsed = paths(exports.svg);
  assert.equal(parsed.length, 3 * composition.parts.length);
  drawing.views.forEach((view, v) => {
    const axes = view.projected_axes.map(a => ['x', 'y', 'z'].indexOf(a));
    composition.parts.forEach((part, p) => {
      const seen = new Set(), expected = [];
      for (const face of composition.triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count)) {
        for (let i = 0; i < 3; i++) {
          const indices = [face[i], face[(i + 1) % 3]], key = [...indices].sort((a, b) => a - b).join(':');
          if (!seen.has(key)) { seen.add(key); expected.push(indices); }
        }
      }
      const observed = parsed[v * composition.parts.length + p];
      assert.equal(observed.count, expected.length); assert.equal(observed.edges.length, expected.length);
      expected.forEach((edge, e) => edge.forEach((index, end) => {
        const point = composition.vertices[index];
        near(observed.edges[e][end][0], view.sheet_center[0] + (point[axes[0]] - view.center_uv_mm[0]) * view.sheet_units_per_mm);
        near(observed.edges[e][end][1], view.sheet_center[1] - (point[axes[1]] - view.center_uv_mm[1]) * view.sheet_units_per_mm);
      }));
    });
  });
  return drawing;
}

test('three-view sheet uses literal mixed-unit placed dimensions and one common scale', () => {
  const original = copy(example), drawing = verifyDrawing(example);
  assert.deepEqual(example, original);
  assert.deepEqual(drawing.bounds, { min: [0, 0, 0], max: [120, 80, 27], size: [120, 80, 27] });
  assert.deepEqual(drawing.views.map(v => v.projected_axes), [['x', 'y'], ['x', 'z'], ['y', 'z']]);
  assert.equal(new Set(drawing.views.map(v => v.sheet_units_per_mm)).size, 1);
  assert.deepEqual(drawing.parts[1].bounds.size.map(n => Math.round(n)), [40, 60, 15]);
  assert.match(drawing.exports.svg, /X span 120 mm/); assert.match(drawing.exports.svg, /Y span 80 mm/); assert.match(drawing.exports.svg, /Z span 27 mm/);
  assert.equal(drawing.physical_authority, false); assert.match(drawing.backend, /no Blender/);
  assert.match(drawing.exports.svg, /NOT a print-scale template/);
});

test('adjacent triangles share index edges, distinct coincident instances remain distinct', () => {
  const source = { input_format: 'obj', units: 'mm', text: 'v 0 0 0\nv 4 0 0\nv 4 3 0\nv 0 3 0\nf 1 2 3\nf 1 3 4\n' };
  const drawing = verifyDrawing({ ...example, instances: [{ id: 'one', source }, { id: 'two', source }] });
  assert.deepEqual(drawing.parts.map(p => p.unique_index_edge_count), [5, 5]);
  assert.deepEqual(drawing.parts.map(p => p.bounds.size), [[4, 3, 0], [4, 3, 0]]);
  assert.match(drawing.exports.svg, /Z span 0 mm/); assert.ok(!drawing.exports.svg.includes('NaN'));
});

test('unreferenced vertices are shown as dots and included in bounds', () => {
  const layout = copy(example); layout.instances = [layout.instances[0]];
  layout.instances[0].source.text += 'v 200 -20 30\n';
  const drawing = verifyDrawing(layout);
  assert.equal(drawing.parts[0].unreferenced_vertex_count, 1);
  assert.deepEqual(drawing.bounds, { min: [0, -20, 0], max: [200, 80, 30], size: [200, 100, 30] });
  assert.equal((drawing.exports.svg.match(/<circle /g) ?? []).length, 3);
});

test('binary STL, PLY, named OBJ selections and transformed GLB nodes use the composer', async () => {
  const source = { input_format: 'obj', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'), 'utf8'), part_ids: ['object-2'] };
  const layout = { ...example, instances: [
    { id: 'obj-selected', source, transform: { scale: 1.5, rotation_deg: [30, -20, 80], center_and_ground: true, translation_mm: [10, -15, 25] } },
    { id: 'stl', source: { input_format: 'stl', units: 'in', data_base64: (await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') } },
    { id: 'ply', source: { input_format: 'ply', units: 'm', text: await readFile(fixture('reference-tetrahedron.ply'), 'utf8') } },
  ] };
  assert.deepEqual(verifyDrawing(layout).parts[0].selection.part_ids, ['object-2']);
  const imported = importReferenceGlbLayout({ name: 'scene', data_base64: (await readFile(fixture('reference-scene.glb'))).toString('base64') });
  const drawing = verifyDrawing(imported.layout);
  assert.ok(drawing.parts.every(p => p.glb_nodes.length));
  assert.equal(drawing.parts.length, 2);
});

test('save/reopen is deterministic; editing preserves unrelated parts and updates drawing identity', () => {
  const first = drawReferenceLayout(example), composed = composeReferenceLayout(example);
  const reopened = JSON.parse(composed.exports.layout);
  assert.deepEqual(drawReferenceLayout(reopened), first);
  reopened.instances[1].transform.translation_mm[1] += 45;
  const moved = verifyDrawing(reopened);
  assert.deepEqual(moved.parts[0], first.parts[0]);
  assert.equal(moved.parts[1].source_sha256, first.parts[1].source_sha256);
  assert.notEqual(moved.geometry_sha256, first.geometry_sha256);
  assert.equal(Math.round(moved.bounds.size[1]), 125);
  reopened.instances[1].transform.translation_mm[1] -= 45;
  reopened.instances[0].source.text += '# an original comment\n';
  const changed = drawReferenceLayout(reopened);
  assert.equal(changed.geometry_sha256, first.geometry_sha256);
  assert.notEqual(changed.layout_sha256, first.layout_sha256);
});

test('source metadata is escaped, source bytes omitted and SVG has no executable/external content', () => {
  const layout = copy(example); layout.instances[0].source.text += '# <script>alert(1)</script> & \\"\n';
  const drawing = drawReferenceLayout(layout);
  assert.deepEqual(metadata(drawing.exports.svg).parts[0].source_sha256, drawing.parts[0].source_sha256);
  assert.ok(!drawing.exports.svg.includes('alert(1)'));
  assert.doesNotMatch(drawing.exports.svg, /<script|<image|<foreignObject|\bhref=|\bonload=|data_base64|"text":/);
  assert.equal(metadata(drawing.exports.svg).physical_authority, false);
});

test('all 16 instances, tiny dimensions and large translations remain finite and readable', () => {
  const maximum = { ...example, instances: Array.from({ length: 16 }, (_, i) => ({ ...copy(example.instances[0]), id: `part-${i}` })) };
  const result = verifyDrawing(maximum); assert.equal(result.parts.length, 16);
  assert.equal((result.exports.svg.match(/data-legend-instance=/g) ?? []).length, 16);
  maximum.instances.push({ ...copy(example.instances[0]), id: 'part-17' });
  assert.throws(() => drawReferenceLayout(maximum), /1 through 16/);
  const tiny = copy(example); tiny.instances = [tiny.instances[0]];
  tiny.instances[0].transform = { scale: 0.000001, translation_mm: [999999000, -999999000, 100] };
  assert.doesNotMatch(verifyDrawing(tiny).exports.svg, /NaN|Infinity/);
});

test('invalid layout, unsupported fields and bad units reject before any output', () => {
  for (const bad of [null, {}, { ...example, instances: [] }, { ...example, url: 'https://example.com' }]) assert.throws(() => drawReferenceLayout(bad), { code: 'invalid-reference-layout' });
  const bad = copy(example); bad.instances[0].source.units = 'guess';
  assert.throws(() => drawReferenceLayout(bad), { code: 'invalid-reference-layout' });
});

test('CLI SVG/stdout/JSON agree; existing files, malformed UTF-8, bad flags and oversized inputs remain safe', async () => {
  const dir = await workdir(), output = path.join(dir, 'sheet.svg');
  const cli = new URL('../bin/moonmold-reference-drawing.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const args = ['--input', fixture('reference-drawing.layout.json').pathname];
  const stdout = run(args); assert.equal(stdout.status, 0, stdout.stderr); assert.equal(stdout.stdout, drawReferenceLayout(example).exports.svg);
  assert.equal(run([...args, '--output', output]).status, 0); assert.equal(await readFile(output, 'utf8'), stdout.stdout);
  assert.equal(run([...args, '--output', output]).status, 1); assert.equal(await readFile(output, 'utf8'), stdout.stdout);
  const json = run([...args, '--format', 'json']); assert.equal(json.status, 0, json.stderr); assert.deepEqual(JSON.parse(json.stdout), metadata(stdout.stdout));
  for (const extra of [['--format', 'obj'], ['--input', 'duplicate'], ['--url', 'x'], ['--format']]) assert.equal(run([...args, ...extra]).status, 1);
  for (const [name, contents] of [['bad.json', '{broken'], ['utf8.json', Buffer.from([0xff])], ['oversized.json', ' '.repeat(3000001)]]) {
    const file = path.join(dir, name), absent = path.join(dir, `${name}.svg`); await writeFile(file, contents);
    assert.equal(run(['--input', file, '--output', absent]).status, 1); await assert.rejects(access(absent));
  }
});

test('real HTTP serves identical drawing and production page; invalid requests return 400', async t => {
  const server = createOperatorServer({ workspaceRoot: await workdir() });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(`${base}/api/reference-layout/drawing`, { method: 'POST', body });
  const response = await send(JSON.stringify(example)); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), drawReferenceLayout(example));
  for (const bad of ['{broken', JSON.stringify({ ...example, instances: [] }), ' '.repeat(3000001)]) assert.equal((await send(bad)).status, 400);
  const html = await (await fetch(`${base}/reference-layout`)).text(); assert.match(html, /Prepare three-view drawing/);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('served UI draws only applied data, clears changed downloads and handles repeats, failures and last removal', async () => {
  const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [];
  let serial = 0, fail = false, mismatch = false, hold = null;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  el('preview').width = 1000; el('preview').height = 400;
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(example) }];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (hold) await new Promise(resolve => { hold = resolve; });
      if (fail) return { ok: false, json: async () => ({ message: 'Drawing unavailable' }) };
      if (url.endsWith('/drawing')) { const result = drawReferenceLayout(input); if (mismatch) result.layout_sha256 = '0'.repeat(64); return { ok: true, json: async () => result }; }
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} };
  await el('drawing-export').handlers.click(); assert.equal(calls.length, 0);
  await el('load-form').handlers.submit(event); assert.equal(el('drawing-export').disabled, false);
  await el('drawing-export').handlers.click();
  let links = el('drawing-download').children.filter(c => c.href); assert.equal(links.length, 2);
  assert.equal(links[0].download, `${example.name}.drawing.svg`);
  assert.equal(await blobs.get(links[0].href).text(), drawReferenceLayout(example).exports.svg);
  assert.deepEqual(JSON.parse(await blobs.get(links[1].href).text()), metadata(await blobs.get(links[0].href).text()));
  const first = links[0].href;
  el('tx').value = '500'; el('tx').handlers.input(); assert.equal(el('drawing-export').disabled, true);
  assert.ok(revoked.includes(first)); assert.equal(el('drawing-download').children.length, 0);
  const count = calls.length; await el('drawing-export').handlers.click(); assert.equal(calls.length, count);
  await el('edit-form').handlers.submit(event); await el('drawing-export').handlers.click();
  links = el('drawing-download').children.filter(c => c.href); const second = links[0].href;
  assert.equal(metadata(await blobs.get(second).text()).parts[0].transform.translation_mm[0], 500);
  for (const mode of ['failure', 'mismatch']) {
    fail = mode === 'failure'; mismatch = mode === 'mismatch'; await el('drawing-export').handlers.click();
    assert.equal(el('drawing-download').children.filter(c => c.href)[0].href, second); assert.match(el('status').textContent, /Drawing unavailable|does not match/);
  }
  fail = false; mismatch = false; hold = true;
  const pending = el('drawing-export').handlers.click(), pendingCount = calls.length;
  await el('drawing-export').handlers.click(); assert.equal(calls.length, pendingCount);
  assert.equal(el('drawing-export').disabled, true); const release = hold; hold = null; release(); await pending;
  assert.ok(revoked.includes(second));
  while (!el('drawing-export').disabled) await el('remove').handlers.click();
  assert.equal(el('drawing-download').children.length, 0); assert.match(el('status').textContent, /Layout is empty/);
  await el('load-form').handlers.submit(event); await el('drawing-export').handlers.click();
  assert.equal(metadata(await blobs.get(el('drawing-download').children[0].href).text()).layout_sha256, composeReferenceLayout(example).layout_sha256);
});
