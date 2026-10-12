import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const example = JSON.parse(await readFile(fixture('reference-layout.json'), 'utf8'));
const copy = value => structuredClone(value);
const testRoot = process.env.MOONMOLD_GLB_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-glb-tests');
await mkdir(testRoot, { recursive: true });
const workdir = () => mkdtemp(path.join(testRoot, 'case-'));

// Independent consumer of the emitted container and accessor bytes, not an
// exporter helper. Assert chunk framing, typed ranges and actual stored bounds.
function decode(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(jsonLength % 4, 0); assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const offset = 20 + jsonLength, binaryLength = bytes.readUInt32LE(offset);
  assert.equal(bytes.readUInt32LE(offset + 4), 0x004e4942);
  assert.equal(binaryLength % 4, 0); assert.equal(offset + 8 + binaryLength, bytes.length);
  const binary = bytes.subarray(offset + 8);
  assert.equal(gltf.asset.version, '2.0'); assert.equal(gltf.buffers.length, 1);
  assert.equal(gltf.buffers[0].byteLength, binaryLength); assert.equal(gltf.buffers[0].uri, undefined);
  function values(id) {
    const a = gltf.accessors[id], view = gltf.bufferViews[a.bufferView];
    assert.equal(view.buffer, 0); assert.equal(view.byteOffset % 4, 0);
    assert.ok(view.byteOffset + view.byteLength <= binary.length);
    const width = a.type === 'VEC3' ? 3 : 1, size = a.componentType === 5126 ? 4 : 2;
    assert.equal(a.count * width * size, view.byteLength);
    const vals = Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, c) => {
      const p = view.byteOffset + (i * width + c) * size;
      return a.componentType === 5126 ? binary.readFloatLE(p) : binary.readUInt16LE(p);
    }));
    if (a.type === 'VEC3') {
      assert.deepEqual(a.min, [0, 1, 2].map(axis => Math.min(...vals.map(p => p[axis])) || 0));
      assert.deepEqual(a.max, [0, 1, 2].map(axis => Math.max(...vals.map(p => p[axis])) || 0));
    }
    return vals;
  }
  return { gltf, parts: gltf.nodes.map(node => {
    const primitive = gltf.meshes[node.mesh].primitives[0];
    assert.equal(primitive.mode, 4);
    const positions = values(primitive.attributes.POSITION), indices = values(primitive.indices).flat();
    assert.ok(indices.every(i => i < positions.length)); assert.equal(indices.length % 3, 0);
    return { node, positions, indices };
  }) };
}
function assertGeometry(input) {
  const composition = composeReferenceLayout(input), { gltf, parts } = decode(exportReferenceLayoutGlb(input));
  assert.deepEqual(gltf.scenes[0].nodes, composition.parts.map((_, i) => i));
  assert.equal(gltf.scene, 0); assert.equal(parts.length, composition.parts.length);
  let error = 0;
  parts.forEach((part, index) => {
    const source = composition.parts[index];
    assert.equal(part.node.name, source.id);
    assert.equal(part.node.extras.moonmold.source_sha256, source.source_sha256);
    assert.equal(part.node.extras.moonmold.source_units, source.source_units);
    assert.deepEqual(part.node.extras.moonmold.applied_transform, source.transform);
    const vertices = composition.vertices.slice(source.vertex_range.start, source.vertex_range.start + source.vertex_range.count);
    const mapped = vertices.map(([x, y, z]) => [x / 1000, z / 1000, -y / 1000]);
    // Signed zero has no geometric meaning and is normalized by JSON metadata.
    assert.deepEqual(part.positions, mapped.map(p => p.map(Math.fround)));
    const observed = Math.max(...mapped.map((p, i) => Math.hypot(...p.map((n, a) => n - part.positions[i][a])) * 1000));
    assert.equal(part.node.extras.moonmold.maximum_vertex_rounding_error_mm, observed); error = Math.max(error, observed);
    assert.deepEqual(part.indices, composition.triangles.slice(source.triangle_range.start, source.triangle_range.start + source.triangle_range.count)
      .flatMap(face => face.map(i => i - source.vertex_range.start)));
  });
  assert.equal(gltf.asset.extras.moonmold.maximum_vertex_rounding_error_mm, error);
  assert.equal(gltf.asset.extras.moonmold.layout_sha256, composition.layout_sha256);
  assert.equal(gltf.asset.extras.moonmold.geometry_sha256, composition.geometry_sha256);
  return { gltf, parts };
}

test('GLB keeps separate named placed meshes with correct metre/Y-up coordinates and winding', () => {
  const original = copy(example), { gltf, parts } = assertGeometry(example);
  assert.deepEqual(example, original);
  assert.equal(gltf.asset.extras.moonmold.physical_authority, false);
  assert.match(gltf.asset.extras.moonmold.losses.join(' '), /float32.*original source bytes/);
  assert.equal(gltf.materials[0].doubleSided, true);
  assert.deepEqual(parts[0].indices, [0, 1, 2]);
  assert.equal(parts[0].positions[1][0], Math.fround(0.002));
  assert.equal(parts[0].positions[2][2], Math.fround(-0.003));
  assert.ok(!JSON.stringify(gltf).includes('data_base64'));
});

test('mixed STL/PLY and all declared source units preserve byte identities and placement order', async () => {
  const formats = [
    { input_format: 'stl', data_base64: (await readFile(fixture('reference-tetrahedron-binary.stl'))).toString('base64') },
    { input_format: 'stl', text: await readFile(fixture('reference-tetrahedron-ascii.stl'), 'utf8') },
    { input_format: 'ply', text: await readFile(fixture('reference-tetrahedron.ply'), 'utf8') },
    { input_format: 'obj', text: await readFile(fixture('reference-tetrahedron.obj'), 'utf8') },
  ];
  assertGeometry({ contract_id: example.contract_id, name: 'mixed', instances: formats.map((source, i) => ({ id: `asset-${i}`,
    source: { ...source, units: ['mm', 'cm', 'm', 'in'][i] },
    transform: { scale: 1.25, rotation_deg: [20, -15, 35], center_and_ground: true, translation_mm: [12, -34, 56] } })) });
});

test('selected named OBJ parts, unused vertices and overlapping instances are not silently welded', async () => {
  const source = { input_format: 'obj', units: 'cm', text: await readFile(fixture('reference-shelf-assembly.obj'), 'utf8'), part_ids: ['object-2'] };
  const layout = { contract_id: example.contract_id, name: 'selected', instances: [{ id: 'one', source }, { id: 'two', source: copy(source) }] };
  const { parts } = assertGeometry(layout);
  assert.deepEqual(parts[0].positions, parts[1].positions);
  assert.deepEqual(parts[0].node.extras.moonmold.selection.part_ids, ['object-2']);
  const unused = copy(example); unused.instances = [unused.instances[0]]; unused.instances[0].source.text += 'v 100 200 300\n';
  const exported = assertGeometry(unused); assert.equal(exported.parts[0].positions.length, 4); assert.equal(exported.parts[0].indices.length, 3);
});

test('reopened layouts export deterministically; edits and source comments update the proper lineage', () => {
  const initial = exportReferenceLayoutGlb(example);
  const saved = composeReferenceLayout(example).exports.layout;
  assert.deepEqual(exportReferenceLayoutGlb(JSON.parse(saved)), initial);
  const changed = JSON.parse(saved); changed.instances[1].transform.translation_mm[0] += 100;
  const before = decode(initial), after = assertGeometry(changed);
  assert.deepEqual(before.parts[0].positions, after.parts[0].positions);
  assert.notDeepEqual(before.parts[1].positions, after.parts[1].positions);
  changed.instances[1].transform.translation_mm[0] -= 100; changed.instances[0].source.text += '# comment\n';
  const commented = assertGeometry(changed);
  assert.equal(commented.gltf.asset.extras.moonmold.geometry_sha256, before.gltf.asset.extras.moonmold.geometry_sha256);
  assert.notEqual(commented.gltf.asset.extras.moonmold.layout_sha256, before.gltf.asset.extras.moonmold.layout_sha256);
});

test('float32 loss is measured; triangles that collapse at a large translation reject usefully', () => {
  const layout = copy(example); layout.instances = [layout.instances[0]];
  layout.instances[0].transform = { translation_mm: [123456.789, 0.123456789, 0] };
  assert.ok(assertGeometry(layout).gltf.asset.extras.moonmold.maximum_vertex_rounding_error_mm > 0);
  layout.instances[0].transform = { translation_mm: [999999000, 999999000, 0] };
  assert.throws(() => exportReferenceLayoutGlb(layout), { code: 'invalid-reference-glb' });
  assert.throws(() => exportReferenceLayoutGlb(layout), /closer to its origin or export OBJ/);
});

test('existing layout validation and instance limits apply before export', () => {
  for (const bad of [null, {}, { ...example, instances: [] }, { ...example, url: 'https://example.com' }]) {
    assert.throws(() => exportReferenceLayoutGlb(bad), { code: 'invalid-reference-layout' });
  }
  const maximum = { ...copy(example), instances: Array.from({ length: 16 }, (_, i) => ({ ...copy(example.instances[0]), id: `part-${i}` })) };
  assert.equal(assertGeometry(maximum).parts.length, 16);
  maximum.instances.push({ ...copy(example.instances[0]), id: 'part-17' });
  assert.throws(() => exportReferenceLayoutGlb(maximum), /1 through 16/);
});

test('the maximum supported vertex index is encoded without truncation', () => {
  const text = 'v 0 0 0\n'.repeat(39997) + 'v 1 0 0\nv 0 1 0\nv 0 0 1\nf 39998 39999 40000\n';
  const layout = { contract_id: example.contract_id, name: 'max-index', instances: [
    { id: 'dense', source: { input_format: 'obj', units: 'mm', text } },
  ] };
  const { parts } = assertGeometry(layout);
  assert.equal(parts[0].positions.length, 40000); assert.deepEqual(parts[0].indices, [39997, 39998, 39999]);
  layout.instances[0].source.text += 'v 0 0 0\n';
  assert.throws(() => exportReferenceLayoutGlb(layout), /40000 vertices/);
});

test('CLI writes binary file and binary stdout identically and retains existing outputs on failure', async () => {
  const dir = await workdir(), output = path.join(dir, 'layout.glb');
  const cli = new URL('../bin/moonmold-reference-layout.mjs', import.meta.url).pathname;
  const args = ['--input', fixture('reference-layout.json').pathname, '--format', 'glb'];
  const run = extra => spawnSync(process.execPath, [cli, ...args, ...extra]);
  const stdout = run([]); assert.equal(stdout.status, 0, stdout.stderr.toString()); decode(stdout.stdout);
  const file = run(['--output', output]); assert.equal(file.status, 0, file.stderr.toString()); assert.equal(file.stdout.length, 0);
  assert.deepEqual(await readFile(output), stdout.stdout);
  assert.equal(run(['--output', output]).status, 1); assert.deepEqual(await readFile(output), stdout.stdout);
  const invalid = spawnSync(process.execPath, [cli, ...args, '--section-axis', 'x', '--section-position', '0']);
  assert.equal(invalid.status, 1); assert.match(invalid.stderr.toString(), /Section format/);
  const wrong = path.join(dir, 'invalid.json'); await writeFile(wrong, '{broken');
  const bad = spawnSync(process.execPath, [cli, '--input', wrong, '--format', 'glb', '--output', path.join(dir, 'not-created.glb')]);
  assert.equal(bad.status, 1);
});

test('real HTTP returns identical self-contained GLB with binary headers and preserves errors', async t => {
  const server = createOperatorServer({ workspaceRoot: await workdir() });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(`${base}/api/reference-layout/glb`, { method: 'POST', body });
  const response = await send(JSON.stringify(example));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  assert.match(response.headers.get('content-disposition'), /attachment.*\.glb/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(Number(response.headers.get('content-length')), bytes.length); assert.deepEqual(bytes, exportReferenceLayoutGlb(example));
  decode(bytes);
  for (const bad of ['{broken', JSON.stringify({ ...example, instances: [] }), ' '.repeat(3000001)]) assert.equal((await send(bad)).status, 400);
  const html = await (await fetch(`${base}/reference-layout`)).text();
  assert.match(html, /Prepare GLB for 3D viewers/); assert.match(html, /metres\/Y-up/);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('production layout UI exports applied bytes, handles repeats/failures and revokes stale downloads', async () => {
  const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
  const elements = new Map(), blobs = new Map(), revoked = [], calls = []; let serial = 0, fail = false, hold = null;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  el('preview').width = 1000; el('preview').height = 400;
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(example) }];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}) }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (hold) await new Promise(resolve => { hold = resolve; });
      if (fail) return { ok: false, json: async () => ({ message: 'Export unavailable' }) };
      if (url.endsWith('/glb')) return { ok: true, arrayBuffer: async () => exportReferenceLayoutGlb(input) };
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} };
  await el('load-form').handlers.submit(event); assert.equal(el('glb-export').disabled, false);
  await el('glb-export').handlers.click();
  const first = el('glb-download').children[0]; assert.equal(first.download, `${example.name}.glb`);
  assert.deepEqual(Buffer.from(await blobs.get(first.href).arrayBuffer()), exportReferenceLayoutGlb(example));
  el('tx').value = '500'; el('tx').handlers.input(); assert.equal(el('glb-export').disabled, true);
  const count = calls.length; await el('glb-export').handlers.click(); assert.equal(calls.length, count);
  await el('edit-form').handlers.submit(event); assert.ok(revoked.includes(first.href)); assert.equal(el('glb-download').children.length, 0);
  await el('glb-export').handlers.click(); const second = el('glb-download').children[0].href;
  const moved = decode(Buffer.from(await blobs.get(second).arrayBuffer())); assert.equal(moved.parts[0].positions[0][0], 0.5);
  fail = true; await el('glb-export').handlers.click(); assert.equal(el('glb-download').children[0].href, second); assert.match(el('status').textContent, /Export unavailable/); fail = false;
  hold = true; const pending = el('glb-export').handlers.click(), pendingCount = calls.length;
  await el('glb-export').handlers.click(); await el('load-form').handlers.submit(event); assert.equal(calls.length, pendingCount);
  assert.equal(el('glb-export').disabled, true); hold(); hold = null; await pending; assert.ok(revoked.includes(second));
  await el('load-form').handlers.submit(event); assert.equal(el('glb-download').children.length, 0);
  for (let i = 0; i < 3; i++) await el('remove').handlers.click();
  assert.equal(el('glb-export').disabled, true); assert.equal(el('glb-download').children.length, 0);
});
