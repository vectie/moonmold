import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectReferenceSvg, importReferenceSvgProfile, SVG_CUTOUT_IMPORT_CONTRACT } from './reference-svg-profile.mjs';
import { extrudeReferenceProfile, EXTRUSION_CUTOUT_CONTRACT } from './reference-extrusion.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { createOperatorServer } from './operator-server.mjs';

const fixture = new URL('../fixtures/reference-opening.svg', import.meta.url), text = await readFile(fixture, 'utf8');
const options = { text, element: 2, opening_element: 3, units: 'mm', units_per_svg_unit: 1, coordinate_convention: 'svg-y-down-to-xy-y-up', height: 8, name: 'svg-opening' };
const root = process.env.MOONMOLD_SVG_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-svg-tests');
await mkdir(root, { recursive: true });
const volume = result => measureReferenceVolume({ layout: JSON.parse(result.exports.layout), instance_ids: [result.name] }).shell_sum_volume_mm3;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test('explicit SVG opening retains both selections and exact source, with closed manifold geometry and editable v2 recipe', () => {
  const before = structuredClone(options), built = importReferenceSvgProfile(options), record = built.svg_import;
  assert.equal(record.contract_id, SVG_CUTOUT_IMPORT_CONTRACT); assert.equal(built.extrusion.recipe.contract_id, EXTRUSION_CUTOUT_CONTRACT);
  assert.deepEqual([record.element_index, record.element_id, record.element_type], [2, 'plate', 'polygon']);
  assert.deepEqual([record.opening.element_index, record.opening.element_id, record.opening.element_type], [3, 'opening', 'polyline']);
  assert.equal(record.opening.removed_closing_endpoint, true); assert.equal(record.omitted_drawing_element_count, 2);
  assert.equal(record.source.sha256, createHash('sha256').update(text).digest('hex'));
  assert.deepEqual(Buffer.from(record.source.bytes, 'base64'), Buffer.from(text)); assert.equal(record.source.byte_length, Buffer.byteLength(text));
  assert.equal(record.viewport_hints.width, '400mm'); assert.equal(record.physical_authority, false);
  assert.deepEqual(built.bounds, { min: [10, -50, 0], max: [50, -20, 8], size: [40, 30, 8] });
  assert.deepEqual(record.recipe.cutout, [[20, -30], [40, -30], [40, -40], [20, -40]]);
  assert.equal(built.extrusion.profile_area_mm2, 1000); near(volume(built), 8000);
  const edges = new Map(); let signed = 0;
  for (const [i, j, k] of built.triangles) {
    for (const [a, b] of [[i, j], [j, k], [k, i]]) { const key = [Math.min(a, b), Math.max(a, b)].join(','), count = edges.get(key) ?? [0, 0]; count[0]++; count[1] += a < b ? 1 : -1; edges.set(key, count); }
    const a = built.vertices[i], b = built.vertices[j], c = built.vertices[k];
    signed += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  assert.ok([...edges.values()].every(([count, balance]) => count === 2 && balance === 0)); near(signed, 8000);
  assert.equal(extrudeReferenceProfile(JSON.parse(built.exports.recipe)).geometry_sha256, built.geometry_sha256);
  assert.equal(composeReferenceLayout(JSON.parse(built.exports.layout)).geometry_sha256, built.geometry_sha256);
  assert.equal(record.recipe_sha256, built.extrusion.recipe_sha256); assert.equal(record.geometry_sha256, built.geometry_sha256); assert.equal(record.layout_sha256, built.layout_sha256);
  assert.deepEqual(options, before);
});

test('straight-edge role combinations, either winding and shared unit/scale transformations do not infer holes', () => {
  const shapes = (outer, opening) => `<svg><${outer}/><${opening}/></svg>`;
  for (const outer of ['polygon id="same" points="10,20 50,20 50,50 10,50"', 'polyline points="10,20 10,50 50,50 50,20 10,20"', 'rect x="10" y="20" width="40" height="30"']) {
    for (const opening of ['polygon id="same" points="20,30 20,40 40,40 40,30"', 'polyline points="20,30 40,30 40,40 20,40 20,30"', 'rect x="20" y="30" width="20" height="10" rx="0"']) {
      const result = importReferenceSvgProfile({ ...options, text: shapes(outer, opening) }); near(volume(result), 8000);
      assert.equal(result.svg_import.omitted_drawing_element_count, 0);
    }
  }
  for (const [units, factor] of Object.entries({ mm: 1, cm: 10, m: 1000, in: 25.4 })) {
    const result = importReferenceSvgProfile({ ...options, units, units_per_svg_unit: 0.5 });
    near(result.extrusion.profile_area_mm2, 250 * factor ** 2); near(volume(result), 2000 * factor ** 3);
    assert.deepEqual(result.extrusion.recipe.cutout, [[10, -15], [20, -15], [20, -20], [10, -20]]);
  }
  const { opening_element, ...single } = options;
  const solid = importReferenceSvgProfile(single); assert.equal(solid.extrusion.recipe.contract_id, 'moonmold.reference-profile-extrusion.v1');
  assert.equal(solid.extrusion.profile_area_mm2, 1200); assert.equal(solid.svg_import.opening, undefined);
});

test('ambiguous selections, unsupported shapes and invalid ring relationships reject without repairs', () => {
  for (const patch of [{ opening_element: null }, { opening_element: 0 }, { opening_element: 2 }, { opening_element: 2.5 }, { opening_element: '3' }, { opening_element: 99 }, { opening_element: 1 }, { opening_element: 5 }, { element: 5 }, { units: 'px' }, { units_per_svg_unit: 0 }, { coordinate_convention: 'guess' }, { max_error: 0.1 }]) assert.throws(() => importReferenceSvgProfile({ ...options, ...patch }));
  const outer = '<polygon points="0,0 40,0 40,30 0,30"/>';
  for (const opening of ['<polygon points="40,10 50,10 50,20 40,20"/>', '<polygon points="35,10 45,10 45,20 35,20"/>', '<polygon points="50,10 60,10 60,20 50,20"/>', '<polygon points="10,10 30,20 10,20 30,10"/>', '<polygon points="10,10 20,10 30,10"/>', '<polygon points="10,10 10,10 30,20"/>', '<polyline points="10,10 30,10 30,20 10,20"/>', '<rect x="10" y="10" width="20" height="10" rx="1"/>', '<polygon points="10,10 30,10 30,20 10,20" transform="translate(1)"/>', '<path d="M10 10 L30 10 L30 20 L10 20 Z"/>']) {
    assert.throws(() => importReferenceSvgProfile({ ...options, text: `<svg>${outer}${opening}</svg>` }), opening);
  }
  // Opening crosses the notch of a concave outer ring despite interior vertices.
  assert.throws(() => importReferenceSvgProfile({ ...options, text: '<svg><polygon points="0,0 40,0 40,30 25,30 25,10 15,10 15,30 0,30"/><polygon points="5,20 35,20 35,25 5,25"/></svg>' }));
  assert.equal(inspectReferenceSvg({ text }).candidates.length, 4);
});

test('CLI imports explicit opening, saves source record and reopens a revised recipe with source unchanged', async () => {
  const dir = await mkdtemp(path.join(root, 'opening-cli-')), cli = new URL('../bin/moonmold-reference-svg.mjs', import.meta.url).pathname;
  const args = ['--input', fixture.pathname, '--element', '2', '--opening-element', '3', '--units', 'mm', '--units-per-svg-unit', '1', '--coordinate-convention', options.coordinate_convention, '--height', '8', '--name', options.name];
  const savedPath = path.join(dir, 'import.json'), imported = spawnSync(process.execPath, [cli, ...args, '--format', 'json', '--output', savedPath], { encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr); const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.equal(saved.svg_import.opening.element_index, 3); const revised = JSON.parse(saved.exports.recipe); revised.cutout[0][0] = 22; revised.height = 12;
  const recipePath = path.join(dir, 'edited.profile.json'); await writeFile(recipePath, JSON.stringify(revised));
  const reopened = spawnSync(process.execPath, [new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname, '--input', recipePath, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(reopened.status, 0, reopened.stderr); assert.deepEqual(JSON.parse(reopened.stdout).extrusion.recipe, revised);
  const duplicate = spawnSync(process.execPath, [cli, ...args, '--format', 'json', '--output', savedPath], { encoding: 'utf8' }); assert.notEqual(duplicate.status, 0);
  assert.equal(await readFile(fixture, 'utf8'), text);
  for (const bad of ['0', '2', '3.5', '3junk']) { const invalid = [...args]; invalid[invalid.indexOf('--opening-element') + 1] = bad; assert.notEqual(spawnSync(process.execPath, [cli, ...invalid, '--format', 'recipe']).status, 0); }
  assert.notEqual(spawnSync(process.execPath, [cli, '--input', fixture.pathname, '--opening-element', '3', '--format', 'inventory']).status, 0);
});

function harness(html, base) {
  const nodes = new Map(), blobs = new Map(), calls = []; let serial = 0; const state = { hold: null, tamper: null };
  const el = id => { if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, children: [], files: [], handlers: {}, width: 560, height: 440, textContent: '', addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; } }); return nodes.get(id); };
  el('profile-name').value = options.name; el('units').value = 'mm'; el('height').value = '8'; el('points').value = '[[0,0],[40,0],[40,30],[0,30]]';
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], { document: { getElementById: el, createElement: () => ({}) }, Blob, TextDecoder,
    URL: { createObjectURL(blob) { const id = 'blob:' + ++serial; blobs.set(id, blob); return id; }, revokeObjectURL() {} },
    fetch: async (url, opts) => { calls.push({ url, input: JSON.parse(opts.body) }); const response = await fetch(base + url, opts); if (state.hold) { const hold = state.hold; state.hold = null; hold.ready(); await hold.wait; } if (state.tamper && url.endsWith('svg-import')) { const next = await response.json(); state.tamper(next); return { ok: response.ok, json: async () => next }; } return response; } });
  return { el, state, calls, build: () => el('profile-form').handlers.submit({ preventDefault() {} }), import: () => el('svg-import').handlers.click(),
    change(id, value) { el(id).value = String(value); el(id).handlers[['svg-element', 'svg-opening', 'svg-convention'].includes(id) ? 'change' : 'input'](); },
    async inspect() { const bytes = Buffer.from(text); el('svg-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }]; await el('svg-form').handlers.submit({ preventDefault() {} }); },
    async saved(suffix) { const link = el('downloads').children.find(x => x.download.endsWith(suffix)); assert.ok(link, suffix); return blobs.get(link.href).text(); },
    async json(suffix) { return JSON.parse(await this.saved(suffix)); },
    async open(recipe) { const bytes = Buffer.from(JSON.stringify(recipe)); el('profile-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }]; await el('open-form').handlers.submit({ preventDefault() {} }); },
    hold() { let ready, release; const started = new Promise(r => { ready = r; }); state.hold = { ready, wait: new Promise(r => { release = r; }) }; return { started, release }; } };
}

test('production profile UI over actual HTTP imports both rings, edits, saves and independently reopens the actual recipe', async t => {
  const workspaceRoot = await mkdtemp(path.join(root, 'opening-ui-')), server = createOperatorServer({ workspaceRoot });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`, response = await fetch(base + '/reference-profile'); assert.equal(response.status, 200);
  const html = await response.text(), ui = harness(html, base); await ui.build(); await ui.inspect();
  assert.equal(ui.el('svg-opening').value, ''); assert.equal(ui.el('svg-opening').children.length, 4);
  ui.change('svg-scale', 1); ui.change('svg-convention', options.coordinate_convention); ui.change('svg-opening', 3); await ui.import();
  assert.equal(ui.calls.at(-1).input.opening_element, 3); assert.match(ui.el('status').textContent, /with opening element 3/);
  const imported = await ui.json('.profile.json'), originalRecord = await ui.json('.svg-import-record.json');
  assert.deepEqual(JSON.parse(ui.el('cutout').value), imported.cutout); assert.equal(imported.contract_id, EXTRUSION_CUTOUT_CONTRACT);
  assert.equal(await ui.saved('.original.svg'), text); assert.equal(originalRecord.opening.element_id, 'opening');
  const firstLinks = ui.el('downloads').children;
  ui.change('cutout', '[[22,-30],[38,-30],[38,-40],[22,-40]]'); ui.change('height', 12);
  assert.equal(ui.el('downloads').children, firstLinks); await ui.build(); const edited = await ui.json('.profile.json');
  assert.equal(edited.height, 12); assert.equal(ui.el('downloads').children.length, 5); assert.equal(originalRecord.recipe.height, 8);
  const fresh = harness(html, base); await fresh.open(edited); assert.deepEqual(await fresh.json('.profile.json'), edited);
  assert.deepEqual(JSON.parse(fresh.el('cutout').value), edited.cutout);
  const layout = await fresh.json('.layout.json'); near(measureReferenceVolume({ layout, instance_ids: [options.name] }).shell_sum_volume_mm3, 12480);
  assert.equal(composeReferenceLayout(layout).geometry_sha256, (await fresh.json('.extrusion-report.json')).geometry_sha256);
  const links = ui.el('downloads').children;
  ui.change('svg-opening', 2); await ui.import(); assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /distinct/);
  // A different requested relationship fails at the real adapter's containment gate.
  ui.change('svg-element', 4); ui.change('svg-opening', 3); await ui.import(); assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /unchanged/);
  ui.change('svg-element', 2);
  for (const tamper of [next => { next.svg_import.opening.element_index = 4; }, next => { next.extrusion.recipe.cutout = null; }, next => { next.svg_import.opening.element_id = 'wrong'; }]) {
    ui.state.tamper = tamper; await ui.import(); assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /does not match/); assert.deepEqual(await ui.json('.profile.json'), edited);
  }
  ui.state.tamper = null;
  const hold = ui.hold(), pending = ui.import(); await hold.started; const callCount = ui.calls.length; await ui.import(); assert.equal(ui.calls.length, callCount);
  ui.change('svg-opening', 4); hold.release(); await pending; assert.equal(ui.el('downloads').children, links); assert.deepEqual(await ui.json('.profile.json'), edited);
  await ui.import(); assert.equal((await ui.json('.svg-import-record.json')).opening.element_index, 4);
  await ui.inspect(); assert.equal(ui.el('svg-opening').value, '');
  await ui.import(); assert.equal((await ui.json('.profile.json')).contract_id, 'moonmold.reference-profile-extrusion.v1'); assert.equal(ui.el('cutout').value, '');
});
