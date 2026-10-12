import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm, access, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { inspectReferenceIslands, splitReferenceIslands, ISLAND_SPLIT_CONTRACT } from './reference-islands.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-islands.layout.json', import.meta.url);
const layout = JSON.parse(await readFile(fixture, 'utf8'));
const request = { layout, instance_id: 'brackets' };
const one = (text, transform = {}) => ({ contract_id: layout.contract_id, name: 'one', instances: [{ id: 'mesh', source: { input_format: 'obj', units: 'mm', text }, transform }] });
const inspect = model => inspectReferenceIslands({ layout: model, instance_id: 'mesh' });
const split = model => splitReferenceIslands({ layout: model, instance_id: 'mesh' });
const faces = result => result.triangles.map(triangle => JSON.stringify(triangle.map(i => result.vertices[i]))).sort();
const temporary = async t => { const dir = await mkdtemp(path.join(tmpdir(), 'moonmold-islands-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const cli = new URL('../bin/moonmold-reference-islands.mjs', import.meta.url).pathname;
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const args = ['--input', fixture.pathname, '--instance', 'brackets'];

test('inspect unnamed interleaved STL regions then separate them into editable placements with exact triangle lineage', () => {
  const original = structuredClone(request), before = composeReferenceLayout(layout), report = inspectReferenceIslands(request), result = splitReferenceIslands(request);
  assert.deepEqual(request, original); assert.equal(report.component_count, 2); assert.equal(report.resulting_instance_count, 3);
  assert.deepEqual(report.components.map(item => item.parent_local_triangle_indices), [[0, 2], [1, 3]]);
  assert.deepEqual(report.components.map(item => item.triangle_count), [2, 2]);
  assert.deepEqual(result.layout.instances.map(item => item.id), ['brackets.island-1', 'brackets.island-2', 'marker']);
  assert.deepEqual(result.layout.instances[2], before.layout.instances[1]);
  assert.deepEqual(faces(result), faces(before)); assert.equal(result.triangle_count, before.triangle_count);
  for (const [index, component] of result.island_split.components.entries()) {
    const part = result.parts[index];
    for (const [local, parentLocal] of component.parent_local_triangle_indices.entries()) {
      assert.deepEqual(result.triangles[part.triangle_range.start + local].map(i => result.vertices[i]), before.triangles[parentLocal].map(i => before.vertices[i]));
    }
    assert.deepEqual(result.layout.instances[index].transform, { scale: 1, rotation_deg: [0, 0, 0], center_and_ground: false, translation_mm: [0, 0, 0] });
    assert.equal(result.layout.instances[index].source.units, 'mm');
  }
  assert.equal(result.island_split.parent_layout_sha256, before.layout_sha256);
  assert.equal(result.island_split.parent_geometry_sha256, before.geometry_sha256);
  assert.equal(result.island_split.layout_sha256, result.layout_sha256);
  assert.equal(result.island_split.geometry_sha256, result.geometry_sha256);
  assert.equal(report.source_sha256, createHash('sha256').update(layout.instances[0].source.text).digest('hex'));
  assert.equal(report.physical_authority, false); assert.match(report.connectivity, /No tolerance/);
});

test('edge connectivity crosses coordinate-identical seams without welding; point-only contacts and tiny gaps remain separate', () => {
  const text = 'v 0 0 0\nv 2 0 0\nv 0 2 0\nv 2 0 0\nv 0 2 0\nv 2 2 0\nv -1 0 0\nv 0 -1 0\nv 0 0 0.00000001\nv 2 0 0.00000001\nv 0 2 0.00000001\nf 1 2 3\nf 4 6 5\nf 1 7 8\nf 9 10 11\n';
  const model = one(text), report = inspect(model), result = split(model);
  assert.deepEqual(report.components.map(item => item.parent_local_triangle_indices), [[0, 1], [2], [3]]);
  assert.equal(result.parts[0].vertex_range.count, 6, 'coordinate-identical seam indices remain distinct');
  assert.equal(result.vertex_count, 12, 'vertex-only shared index duplicated across independently editable outputs');
  assert.deepEqual(faces(result), faces(composeReferenceLayout(model)));
});

test('overlap without shared edges stays separate, while all triangles sharing a nonmanifold edge connect regardless of winding', () => {
  const model = one('v 0 0 0\nv 2 0 0\nv 0 2 0\nv 0 -2 0\nv 0 0 2\nv 0.5 0.5 0\nv 1.5 0.5 0\nv 0.5 1.5 0\nf 1 2 3\nf 2 1 4\nf 1 2 5\nf 6 7 8\nf 3 2 1\n');
  assert.deepEqual(inspect(model).components.map(item => item.parent_local_triangle_indices), [[0, 1, 2, 4], [3]]);
  assert.deepEqual(faces(split(model)), faces(composeReferenceLayout(model)), 'duplicates and winding are not repaired or removed');
});

test('compound placement and grounding are baked once; unused vertices are omitted while recipe retains exact source and transforms', () => {
  const model = one('v -2 -1 3\nv 0 -1 3\nv -2 1 3\nv 5 0 -1\nv 7 0 -1\nv 5 2 -1\nv 999 999 -100\nf 1 2 3\nf 4 5 6\n', { scale: 1.25, rotation_deg: [23, -31, 47], center_and_ground: true, translation_mm: [100, 200, 17] });
  model.instances[0].source.units = 'cm';
  const before = composeReferenceLayout(model), report = inspect(model), result = split(model), recipe = JSON.parse(result.exports.recipe);
  assert.equal(report.unused_vertex_count, 1); assert.equal(result.vertex_count, 6);
  assert.deepEqual(faces(result), faces(before)); assert.deepEqual(recipe.layout, before.layout);
  assert.equal(recipe.contract_id, ISLAND_SPLIT_CONTRACT); assert.equal(recipe.layout.instances[0].source.text, model.instances[0].source.text);
  assert.deepEqual(splitReferenceIslands(recipe), result); assert.deepEqual(composeReferenceLayout(recipe.layout), before);
});

test('source-local selections and exact binary payloads survive original recipe; OBJ selection excludes unchosen islands', () => {
  const model = one('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 5 0 0\nv 6 0 0\nv 5 1 0\nv 9 0 0\nv 10 0 0\nv 9 1 0\no keep\nf 1 2 3\nf 4 5 6\no discard\nf 7 8 9\n');
  model.instances[0].source.part_ids = ['object-1'];
  const result = split(model); assert.equal(result.triangle_count, 2); assert.deepEqual(result.island_split.inspection.source_selection.part_ids, ['object-1']);
  assert.deepEqual(JSON.parse(result.exports.recipe).layout.instances[0].source.part_ids, ['object-1']);
  const mesh = importReferenceMesh(layout.instances[0].source), binary = Buffer.alloc(84 + 50 * mesh.triangle_count); binary.writeUInt32LE(mesh.triangle_count, 80);
  for (const [i, face] of mesh.triangles.entries()) for (const [j, index] of face.entries()) for (let axis = 0; axis < 3; axis++) binary.writeFloatLE(mesh.vertices[index][axis], 84 + 50 * i + 12 + j * 12 + axis * 4);
  const bytesModel = structuredClone(model); bytesModel.instances[0].source = { input_format: 'stl', units: 'mm', data_base64: binary.toString('base64') };
  const bytesResult = split(bytesModel); assert.equal(bytesResult.island_split.inspection.component_count, 2);
  assert.deepEqual(Buffer.from(JSON.parse(bytesResult.exports.recipe).layout.instances[0].source.data_base64, 'base64'), binary);
  const plyModel = structuredClone(model); plyModel.instances[0].source = { input_format: 'ply', units: 'mm', text: 'ply\nformat ascii 1.0\nelement vertex 6\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n5 0 0\n6 0 0\n5 1 0\n3 0 1 2\n3 3 4 5\n' };
  assert.equal(split(plyModel).island_split.inspection.component_count, 2);
  const glb = exportReferenceLayoutGlb(layout), glbSource = { input_format: 'glb', units: 'm', data_base64: glb.toString('base64') };
  glbSource.node_ids = [importReferenceMesh(glbSource).glb_nodes[0].node_index];
  const glbModel = structuredClone(model); glbModel.instances[0].source = glbSource;
  const glbResult = split(glbModel); assert.equal(glbResult.island_split.inspection.component_count, 2);
  assert.deepEqual(JSON.parse(glbResult.exports.recipe).layout.instances[0].source, { ...glbSource, name: 'reference' });
  assert.deepEqual(glbResult.island_split.inspection.source_node_ids, glbSource.node_ids);
});

test('derived layout and OBJ/STL reopen for independent placement editing; deterministic IDs avoid collisions and length overflow', () => {
  const original = structuredClone(layout); original.instances.push({ ...structuredClone(layout.instances[1]), id: 'brackets.island-1' });
  const result = splitReferenceIslands({ layout: original, instance_id: 'brackets' }); assert.equal(result.layout.instances[0].id, 'brackets.island-1-2');
  const reopened = composeReferenceLayout(JSON.parse(result.exports.layout)); assert.equal(reopened.layout_sha256, result.layout_sha256); assert.equal(reopened.geometry_sha256, result.geometry_sha256);
  for (const input_format of ['obj', 'stl']) assert.deepEqual(faces(importReferenceMesh({ input_format, units: 'mm', text: result.exports[input_format] })), faces(result));
  const moved = structuredClone(reopened.layout); moved.instances[0].transform.translation_mm[2] = 30;
  const after = composeReferenceLayout(moved); assert.equal(after.parts[0].bounds.min[2], reopened.parts[0].bounds.min[2] + 30); assert.deepEqual(after.parts.slice(1), reopened.parts.slice(1));
  const long = structuredClone(layout); long.instances[0].id = 'a'.repeat(80);
  const longResult = splitReferenceIslands({ layout: long, instance_id: long.instances[0].id }); assert.ok(longResult.layout.instances.every(item => item.id.length <= 80));
  assert.deepEqual(splitReferenceIslands({ layout: long, instance_id: long.instances[0].id }), longResult);
});

test('inspection remains useful when one island or too many islands prevent a split; invalid requests leave originals unchanged', () => {
  const single = one('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'); assert.equal(inspect(single).component_count, 1); assert.throws(() => split(single), /nothing to separate/);
  let text = ''; for (let i = 0; i < 17; i++) text += `v ${i * 5} 0 0\nv ${i * 5 + 1} 0 0\nv ${i * 5} 1 0\nf ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}\n`;
  assert.equal(inspect(one(text)).component_count, 17); assert.throws(() => split(one(text)), /maximum is 16/);
  const original = structuredClone(request);
  for (const input of [null, [], {}, { ...request, instance_id: 2 }, { ...request, instance_id: 'missing' }, { ...request, url: 'no' }, { ...request, contract_id: 'wrong' }]) assert.throws(() => splitReferenceIslands(input), { code: 'invalid-reference-islands' });
  assert.deepEqual(request, original);
});

test('real CLI inspects, saves and reopens all split outputs, with strict input and exclusive output files', async t => {
  const dir = await temporary(t);
  for (const format of ['catalog', 'layout', 'recipe', 'json', 'obj', 'stl']) {
    const output = path.join(dir, format), command = run([...args, '--format', format, '--output', output]); assert.equal(command.status, 0, command.stderr);
    const expected = format === 'catalog' ? JSON.stringify(inspectReferenceIslands(request), null, 2) + '\n' : format === 'json' ? JSON.stringify(splitReferenceIslands(request), null, 2) + '\n' : splitReferenceIslands(request).exports[format];
    assert.equal(await readFile(output, 'utf8'), expected);
  }
  assert.equal(run(['--recipe', path.join(dir, 'recipe'), '--format', 'layout']).stdout, splitReferenceIslands(request).exports.layout);
  assert.equal(run(['--input', path.join(dir, 'layout'), '--instance', 'brackets.island-1']).status, 0);
  assert.equal(run([...args, '--output', path.join(dir, 'catalog')]).status, 1);
  await symlink(path.join(dir, 'catalog'), path.join(dir, 'link')); assert.equal(run([...args, '--output', path.join(dir, 'link')]).status, 1);
  for (const extra of [['--format', 'invalid'], ['--instance', 'brackets'], ['--script', 'no'], ['--output']]) assert.equal(run([...args, ...extra]).status, 1);
  assert.equal(run(['--recipe', path.join(dir, 'recipe'), '--instance', 'brackets']).status, 1);
  for (const [name, bytes] of [['bad', '{'], ['utf8', Buffer.from([255])], ['huge', Buffer.alloc(3100001, 32)]]) {
    const input = path.join(dir, name), output = input + '.out'; await writeFile(input, bytes);
    assert.equal(run(['--input', input, '--instance', 'brackets', '--output', output]).status, 1); await assert.rejects(access(output));
  }
});

test('loopback operator API serves the actual island workflow and accepts portable recipe replay', async t => {
  const server = createOperatorServer({ workspaceRoot: await temporary(t) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [endpoint, expected] of [['islands', inspectReferenceIslands(request)], ['split-islands', splitReferenceIslands(request)]]) {
    const response = await fetch(`${base}/api/reference-layout/${endpoint}`, { method: 'POST', body: JSON.stringify(request) }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected);
  }
  let response = await fetch(base + '/api/reference-layout/split-islands', { method: 'POST', body: splitReferenceIslands(request).exports.recipe }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), splitReferenceIslands(request));
  for (const body of ['{}', '{', ' '.repeat(3100001)]) assert.equal((await fetch(base + '/api/reference-layout/islands', { method: 'POST', body })).status, 400);
  const html = await (await fetch(base + '/reference-layout')).text(); assert.match(html, /Separate mesh islands/); assert.match(html, /exactly equal endpoint XYZ/);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: 'utf8' }); assert.equal(syntax.status, 0, syntax.stderr);
});
