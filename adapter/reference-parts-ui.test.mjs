import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createOperatorServer } from './operator-server.mjs';

// BOM, CRLF and a non-ASCII name make source-byte preservation observable.
const text = '\uFEFF' + [
 '# Named reference',
 'v 0 0 0', 'v 2 0 0', 'v 2 2 0', 'v 0 2 0',
 'v 10 0 0', 'v 11 0 0', 'v 10 1 0', 'v 99 99 99',
 'o Panel café <safe>', 'g skin shell', 'f 1 2 3 4',
 'o Panel café <safe>', 'g tail', 'f 5 6 7', 'g skin', 'f 1 3 4', '',
].join('\r\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const event = { preventDefault() {} };
const file = (name, contents) => {
 const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
 return { name, size: bytes.length, text: async () => bytes.toString('utf8'), arrayBuffer: async () => Uint8Array.from(bytes).buffer };
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function controller(t) {
 const server = createOperatorServer({ workspaceRoot: fileURLToPath(new URL('..', import.meta.url)) });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 const base = `http://127.0.0.1:${server.address().port}`;
 const response = await fetch(`${base}/reference-mesh`); assert.equal(response.status, 200);
 const html = await response.text();
 const elements = new Map(), blobs = new Map(), revoked = new Set(), calls = [];
 let serial = 0, pause;
 function element(id) {
  if (!elements.has(id)) elements.set(id, {
   value: '0', checked: false, disabled: false, hidden: false, textContent: '', children: [], handlers: {}, files: [],
   addEventListener(type, handler) { this.handlers[type] = handler; },
   replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); },
   removeAttribute(name) { delete this[name]; }, setPointerCapture() {},
  });
  return elements.get(id);
 }
 element('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
 element('preview').width = 1000; element('preview').height = 400;
 element('units').value = 'cm'; element('scale').value = '1'; element('yaw').value = '35'; element('pitch').value = '25';
 runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
  document: { getElementById: element, querySelector: () => element('import-button'), createElement: tag => ({ tagName: tag }) },
  Blob, TextDecoder, btoa,
  URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.add(url); } },
  fetch: async (url, options) => {
   calls.push({ url, body: JSON.parse(options.body) });
   const gate = pause; pause = undefined;
   if (gate) { gate.started.resolve(); await gate.release.promise; }
   return fetch(base + url, options);
  },
 });
 const downloadedText = async (id = 'downloads', index = 0) => blobs.get(element(id).children[index].href).text();
 return {
  element, calls, revoked, html,
  async import(contents = text, name = 'parts.obj') { element('file').files = [file(name, contents)]; await element('import-form').handlers.submit(event); },
  choose(ids) { for (const option of element('part-list').children) option.selected = ids.includes(option.value); element('part-list').handlers.change(); },
  click(id) { return element(id).handlers.click(); },
  submit(id) { return element(id).handlers.submit(event); },
  json: async (id = 'downloads') => JSON.parse(await downloadedText(id)),
  downloadedText,
  async post(route, body) { const result = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(result.status, 200, await result.clone().text()); return result.json(); },
  pauseNextRequest() { pause = { started: deferred(), release: deferred() }; return pause; },
 };
}

test('served picker extracts overlapping occurrences once, places only selected geometry, resets and restores full source', async t => {
 const ui = await controller(t), el = ui.element;
 await ui.import();
 const whole = await ui.json();
 assert.equal(whole.vertex_count, 8); assert.equal(whole.triangle_count, 4); assert.equal(whole.source_sha256, sha(text));
 assert.equal(whole.source.text, text); assert.equal(el('downloads').children.length, 3);
 assert.equal(el('parts-controls').hidden, false); assert.equal(el('parts-controls').disabled, false);
 assert.equal(el('part-list').children.length, 6);
 const panels = el('part-list').children.filter(option => option.textContent.includes('object: Panel café <safe>'));
 assert.equal(panels.length, 2); assert.notEqual(panels[0].textContent, panels[1].textContent);
 assert.match(ui.html, /<label for="part-list">/); assert.match(ui.html, /id="part-list" multiple/);
 assert.equal(el('extract-parts').disabled, true);
 ui.choose(['object-1', 'group-1']);
 assert.match(el('parts-status').textContent, /2 occurrence\(s\) selected · 1 unique source face\(s\)/);
 await ui.click('extract-parts');
 const selected = await ui.json();
 assert.equal(selected.vertex_count, 4); assert.equal(selected.triangle_count, 2);
 assert.deepEqual(selected.selection.part_ids, ['object-1', 'group-1']);
 assert.deepEqual(selected.bounds.size, [20, 20, 0]); assert.equal(selected.source_sha256, whole.source_sha256);
 assert.deepEqual(selected.obj_parts, whole.obj_parts); assert.equal(el('restore-source').disabled, false);
 assert.equal(el('downloads').children.length, 3); assert.equal(el('source-downloads').children.length, 1);
 const saved = await ui.json('source-downloads');
 assert.equal(saved.text, text); assert.equal(saved.units, 'cm'); assert.deepEqual(saved.part_ids, ['object-1', 'group-1']);
 assert.equal(el('source-help').hidden, false);
 el('scale').value = '2'; el('tx').value = '7';
 await ui.submit('edit-form');
 const edited = await ui.json();
 assert.deepEqual(edited.bounds.min, [7, 0, 0]); assert.deepEqual(edited.bounds.size, [40, 40, 0]);
 assert.deepEqual(edited.source, saved); assert.equal(edited.triangle_count, 2);
 const derived = await ui.downloadedText('downloads', 1);
 const layout = await ui.post('reference-layout/compose', { contract_id: 'moonmold.reference-layout.v1', name: 'picked-layout', instances: [{ id: 'picked', source: { input_format: 'obj', text: derived, units: 'mm', name: 'picked' } }] });
 assert.equal(layout.triangle_count, 2); assert.deepEqual(layout.vertices, edited.vertices);
 el('section-axis').value = 'x'; el('section-position').value = '27';
 await ui.submit('section-form'); assert.ok((await ui.json('section-downloads')).segment_count > 0);
 assert.deepEqual(ui.calls.at(-1).body.part_ids, saved.part_ids);
 await ui.click('reset');
 const reset = await ui.json(); assert.deepEqual(reset.selection.part_ids, saved.part_ids);
 assert.deepEqual(reset.vertices, selected.vertices); assert.equal(el('scale').value, '1'); assert.equal(el('tx').value, '0');
 assert.equal(el('section-downloads').children.length, 0);
 await ui.click('restore-source');
 const restored = await ui.json(); assert.deepEqual(restored.vertices, whole.vertices); assert.deepEqual(restored.triangles, whole.triangles);
 assert.equal(restored.selection, undefined); assert.equal((await ui.json('source-downloads')).part_ids, undefined);
 assert.equal(el('restore-source').disabled, true); assert.equal(el('part-list').children.some(option => option.selected), false);
});

test('saved selection source reopens with embedded units, restores full original and rejects malformed source without replacing success', async t => {
 const ui = await controller(t), el = ui.element;
 await ui.import(); ui.choose(['object-2']); await ui.click('extract-parts');
 const saved = await ui.json('source-downloads'), expected = await ui.json();
 await ui.click('restore-source'); el('units').value = 'm';
 el('source-file').files = [file('selection.json', JSON.stringify(saved))];
 await ui.submit('source-form');
 assert.deepEqual((await ui.json()).vertices, expected.vertices); assert.deepEqual((await ui.json()).selection.part_ids, ['object-2']);
 assert.equal((await ui.json()).source_units, 'cm'); assert.deepEqual(await ui.json('source-downloads'), saved);
 const old = el('downloads').children, sourceLinks = el('source-downloads').children;
 for (const payload of ['{invalid', JSON.stringify(expected), JSON.stringify({ ...saved, part_ids: [] }), JSON.stringify({ ...saved, part_ids: ['unknown'] }), JSON.stringify({ ...saved, part_ids: ['object-2', 'object-2'] })]) {
  el('source-file').files = [file('bad.json', payload)]; await ui.submit('source-form');
  assert.equal(el('downloads').children, old); assert.equal(el('source-downloads').children, sourceLinks);
  assert.match(el('status').textContent, /unchanged/);
 }
 const corrupted = Buffer.from(JSON.stringify(saved));
 corrupted[corrupted.indexOf(Buffer.from('Named'))] = 0xff;
 const beforeCorrupted = ui.calls.length;
 el('source-file').files = [file('corrupted.source.json', corrupted)]; await ui.submit('source-form');
 assert.equal(ui.calls.length, beforeCorrupted); assert.equal(el('downloads').children, old);
 assert.equal(el('source-downloads').children, sourceLinks); assert.match(el('status').textContent, /unchanged/);
 await ui.click('restore-source'); assert.equal((await ui.json()).vertex_count, 8); assert.equal((await ui.json()).source.text, text);
});

test('empty/failed selections and failed edits/imports retain last successful geometry, source and download URLs', async t => {
 const ui = await controller(t), el = ui.element;
 await ui.import(); ui.choose(['group-3']); await ui.click('extract-parts');
 el('tx').value = '15'; await ui.submit('edit-form');
 const old = el('downloads').children, sourceLinks = el('source-downloads').children, saved = await ui.json('source-downloads');
 const revoked = ui.revoked.size, count = ui.calls.length;
 ui.choose([]); await ui.click('extract-parts'); assert.equal(ui.calls.length, count);
 assert.equal(el('downloads').children, old); assert.match(el('status').textContent, /Choose at least one/);
 el('part-list').children.push({ value: 'missing-part', selected: false, textContent: 'invalid' });
 ui.choose(['missing-part']); await ui.click('extract-parts'); assert.match(el('status').textContent, /Unknown or empty OBJ part ID/);
 assert.equal(el('downloads').children, old); assert.equal(el('source-downloads').children, sourceLinks);
 el('scale').value = '-1'; await ui.submit('edit-form'); assert.equal(el('downloads').children, old);
 await ui.import('o malformed\nf 1 2 3'); assert.equal(el('downloads').children, old);
 await ui.import(Buffer.from([0xff, 0xfe, 0x41])); assert.equal(el('downloads').children, old);
 assert.equal(el('source-downloads').children, sourceLinks); assert.deepEqual(await ui.json('source-downloads'), saved);
 assert.equal(ui.revoked.size, revoked);
 await ui.click('reset'); const reset = await ui.json();
 assert.deepEqual(reset.selection.part_ids, ['group-3']); assert.deepEqual(reset.bounds.min, [100, 0, 0]);
});

test('busy imports/extractions freeze selection and snapshot source units; repeated clicks cannot corrupt committed source', async t => {
 const ui = await controller(t), el = ui.element;
 await ui.import(); ui.choose(['object-1']);
 const gate = ui.pauseNextRequest(), extracting = ui.click('extract-parts'); await gate.started.promise;
 const count = ui.calls.length;
 assert.equal(el('parts-controls').disabled, true); assert.equal(el('file').disabled, true); assert.equal(el('units').disabled, true);
 assert.equal(el('open-source').disabled, true); assert.equal(el('edits').disabled, true);
 ui.choose(['object-2']);
 assert.deepEqual(el('part-list').children.filter(option => option.selected).map(option => option.value), ['object-1']);
 el('scale').value = '3';
 await ui.click('extract-parts'); await ui.click('restore-source'); await ui.click('reset'); await ui.click('fit'); await ui.submit('edit-form');
 await ui.submit('import-form'); await ui.submit('source-form');
 assert.equal(ui.calls.length, count); assert.equal(el('scale').value, '3');
 gate.release.resolve(); await extracting;
 assert.deepEqual((await ui.json()).selection.part_ids, ['object-1']); assert.equal(el('scale').value, '1');
 const reading = deferred(), pickedFile = file('slow.obj', text);
 pickedFile.arrayBuffer = () => reading.promise;
 el('units').value = 'in'; el('file').files = [pickedFile];
 const importing = ui.submit('import-form');
 el('units').value = 'm'; el('file').files = [file('newer.obj', 'invalid')];
 await ui.submit('import-form'); await ui.click('extract-parts');
 reading.resolve(Uint8Array.from(Buffer.from(text)).buffer); await importing;
 assert.equal((await ui.json()).source_units, 'in'); assert.equal((await ui.json()).source.text, text);
 assert.equal((await ui.json()).selection, undefined); assert.equal(el('file').disabled, false); assert.equal(el('parts-controls').disabled, false);
});

test('successful STL and PLY switches clear OBJ parts/source downloads; failed switches preserve them', async t => {
 const ui = await controller(t), el = ui.element;
 const stl = 'solid shape\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid shape\n';
 const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n';
 for (const [extension, contents] of [['stl', stl], ['ply', ply]]) {
  await ui.import(); ui.choose(['object-1']); await ui.click('extract-parts');
  const old = el('downloads').children;
  await ui.import('invalid', `bad.${extension}`); assert.equal(el('downloads').children, old); assert.equal(el('parts-controls').hidden, false);
  await ui.import(contents, `next.${extension}`);
  assert.equal((await ui.json()).source_format, extension); assert.equal(el('parts-controls').hidden, true); assert.equal(el('parts-controls').disabled, true);
  assert.equal(el('part-list').children.length, 0); assert.equal(el('source-downloads').children.length, 0); assert.equal(el('source-help').hidden, true);
  const count = ui.calls.length; await ui.click('extract-parts'); await ui.click('restore-source'); assert.equal(ui.calls.length, count);
  el('scale').value = '2'; await ui.submit('edit-form'); assert.equal(ui.calls.at(-1).body.part_ids, undefined);
  await ui.click('reset'); assert.equal((await ui.json()).triangle_count, 1);
 }
});
