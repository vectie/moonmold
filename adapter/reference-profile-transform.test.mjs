import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { transformReferenceProfile, PROFILE_TRANSFORM_CONTRACT } from './reference-profile-transform.mjs';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { createOperatorServer } from './operator-server.mjs';

const recipe = { contract_id: 'moonmold.reference-profile-extrusion.v2', name: 'editable-plate', units: 'cm', coordinate_frame: 'xy-z-up', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]], height: 0.8, cutout: [[1, 1], [3, 1], [3, 2], [1, 2]] };
const request = patch => ({ contract_id: PROFILE_TRANSFORM_CONTRACT, recipe, selection: 'all', translation: [0, 0], rotation_degrees: 0, scale: 1, pivot: [2, 1.5], ...patch });
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const root = process.env.MOONMOLD_PROFILE_TRANSFORM_TEST_ROOT ?? path.join(tmpdir(), 'moonmold-profile-transform-tests');
await mkdir(root, { recursive: true });

test('typed profile transforms edit the selected authored rings with explicit pivot/order/units and preserve height', () => {
  const original = structuredClone(recipe), source = extrudeReferenceProfile(recipe);
  const all = transformReferenceProfile(request({ translation: [3, -1], rotation_degrees: 90, scale: 2 }));
  assert.deepEqual(all.extrusion.recipe.vertices, [[8, -3.5], [8, 4.5], [2, 4.5], [2, -3.5]]);
  assert.deepEqual(all.bounds, { min: [20, -35, 0], max: [80, 45, 8], size: [60, 80, 8] });
  near(all.extrusion.profile_area_mm2, 4000); assert.equal(all.extrusion.recipe.height, recipe.height);
  assert.equal(all.profile_transform.source_recipe_sha256, source.extrusion.recipe_sha256);
  assert.equal(all.profile_transform.recipe_sha256, all.extrusion.recipe_sha256);
  assert.equal(all.profile_transform.geometry_sha256, all.geometry_sha256); assert.equal(all.profile_transform.physical_authority, false);
  const outer = transformReferenceProfile(request({ selection: 'outer', scale: 1.5 }));
  assert.deepEqual(outer.extrusion.recipe.vertices, [[-1, -0.75], [5, -0.75], [5, 3.75], [-1, 3.75]]);
  assert.deepEqual(outer.extrusion.recipe.cutout, recipe.cutout); near(outer.extrusion.profile_area_mm2, 2500);
  const cutout = transformReferenceProfile(request({ selection: 'cutout', translation: [0.25, 0], rotation_degrees: 90, scale: 0.5 }));
  assert.deepEqual(cutout.extrusion.recipe.vertices, recipe.vertices);
  assert.deepEqual(cutout.extrusion.recipe.cutout, [[2.5, 1], [2.5, 2], [2, 2], [2, 1]]);
  near(cutout.extrusion.profile_area_mm2, 1150); assert.deepEqual(recipe, original);
  for (const result of [all, outer, cutout]) {
    const reopened = extrudeReferenceProfile(JSON.parse(result.exports.recipe));
    assert.equal(reopened.geometry_sha256, result.geometry_sha256);
    near(measureReferenceVolume({ layout: JSON.parse(result.exports.layout), instance_ids: [recipe.name] }).shell_sum_volume_mm3, result.extrusion.profile_area_mm2 * 8);
  }
});

test('concave v1 remains editable without a cutout; invalid transformed containment leaves input untouched', async () => {
  const concave = JSON.parse(await readFile(new URL('../fixtures/reference-extrusion.profile.json', import.meta.url), 'utf8'));
  const rotated = transformReferenceProfile(request({ recipe: concave, pivot: [15, 10], rotation_degrees: -30, translation: [4, 6], scale: 1.2 }));
  assert.equal(rotated.extrusion.recipe.contract_id, concave.contract_id); assert.ok(!Object.hasOwn(rotated.extrusion.recipe, 'cutout'));
  near(rotated.extrusion.profile_area_mm2, 700 * 1.2 ** 2);
  const original = structuredClone(recipe);
  assert.throws(() => transformReferenceProfile(request({ selection: 'cutout', translation: [100, 0] })), /inside|outside|intersect/);
  assert.throws(() => transformReferenceProfile(request({ selection: 'outer', scale: 0.5 })), /inside|touch|intersect/);
  assert.throws(() => transformReferenceProfile(request({ scale: 0 })), /positive/);
  assert.throws(() => transformReferenceProfile(request({ recipe: concave, selection: 'cutout' })), /no cutout/);
  assert.deepEqual(recipe, original);
});

function harness(html, base) {
  const elements = new Map(), blobs = new Map(), calls = [], coordinates = [], state = { hold: null }; let serial = 0;
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '', children: [], handlers: {}, files: [], width: 560, height: 300,
      addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
      getContext: () => ({ clearRect() {}, beginPath() {}, moveTo(...p) { coordinates.push(p); }, lineTo(...p) { coordinates.push(p); }, stroke() {} }),
    });
    return elements.get(id);
  };
  for (const [id, value] of Object.entries({ 'profile-name': recipe.name, units: recipe.units, points: JSON.stringify(recipe.vertices), cutout: JSON.stringify(recipe.cutout), height: String(recipe.height), 'transform-selection': 'all', 'transform-x': '0', 'transform-y': '0', 'transform-angle': '0', 'transform-scale': '1', 'transform-pivot-x': '0', 'transform-pivot-y': '0' })) el(id).value = value;
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}) }, Blob, TextDecoder,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
    fetch: async (url, options) => {
      calls.push({ url, request: JSON.parse(options.body) });
      const response = await fetch(base + url, options);
      if (state.hold && url.endsWith('/transform')) { const hold = state.hold; state.hold = null; hold.ready(); await hold.wait; }
      return response;
    },
  });
  const submit = id => el(id).handlers.submit({ preventDefault() {} });
  return { el, calls, coordinates, state,
    build: () => submit('profile-form'), preview: () => submit('transform-form'), apply: () => el('transform-apply').handlers.click(), cancel: () => el('transform-cancel').handlers.click(),
    change(id, value) { el(id).value = String(value); el(id).handlers[id === 'transform-selection' ? 'change' : 'input'](); },
    async open(value) { const bytes = Buffer.from(JSON.stringify(value)); el('profile-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }]; await submit('open-form'); },
    async saved(suffix) { const link = el('downloads').children.find(link => link.download.endsWith(suffix)); assert.ok(link, suffix); return JSON.parse(await blobs.get(link.href).text()); },
    holdNext() { let ready, release; const readyPromise = new Promise(resolve => { ready = resolve; }); state.hold = { ready, wait: new Promise(resolve => { release = resolve; }) }; return { ready: readyPromise, release }; },
  };
}

async function live(t) {
  const dir = await mkdtemp(path.join(root, 'journey-')), server = createOperatorServer({ workspaceRoot: dir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`, response = await fetch(base + '/reference-profile');
  assert.equal(response.status, 200); const html = await response.text();
  assert.match(html, /Transform editable profile rings/); return { dir, base, html, ui: harness(html, base) };
}

test('production UI over real HTTP previews/applies/cancels all selections, saves editable recipe, reopens and runs extrusion CLI', async t => {
  const { dir, html, base, ui } = await live(t); await ui.build();
  const original = await ui.saved('.profile.json'), initialReport = await ui.saved('.extrusion-report.json'), originalLinks = ui.el('downloads').children;
  ui.change('transform-selection', 'outer'); ui.change('transform-scale', 1.5); ui.change('transform-pivot-x', 2); ui.change('transform-pivot-y', 1.5);
  await ui.preview(); assert.equal(ui.el('transform-apply').disabled, false);
  assert.deepEqual(JSON.parse(ui.el('points').value), original.vertices); assert.equal(ui.el('downloads').children, originalLinks);
  assert.match(ui.el('transform-status').textContent, /Candidate only: outer/);
  ui.cancel(); assert.equal(ui.el('transform-apply').disabled, true); assert.deepEqual(await ui.saved('.profile.json'), original);
  await ui.preview(); await ui.apply(); const outer = await ui.saved('.profile.json');
  assert.deepEqual(outer.vertices, [[-1, -0.75], [5, -0.75], [5, 3.75], [-1, 3.75]]); assert.deepEqual(outer.cutout, original.cutout);
  assert.equal(ui.calls.at(-1).url, '/api/reference-profile/extrude'); assert.match(ui.el('status').textContent, /applied and rebuilt/);
  await ui.open(original); ui.change('transform-selection', 'cutout'); ui.change('transform-scale', 0.5); ui.change('transform-angle', 90); ui.change('transform-x', 0.25);
  await ui.preview(); await ui.apply(); const cutout = await ui.saved('.profile.json');
  assert.deepEqual(cutout.vertices, original.vertices); assert.deepEqual(cutout.cutout, [[2.5, 1], [2.5, 2], [2, 2], [2, 1]]);
  const transform = await ui.saved('.profile-transform-report.json'); assert.equal(transform.source_recipe_sha256, initialReport.recipe_sha256);
  near((await ui.saved('.extrusion-report.json')).profile_area_mm2, 1150);
  ui.change('transform-selection', 'all'); ui.change('transform-scale', 2); ui.change('transform-x', 3); ui.change('transform-y', -1);
  await ui.preview(); await ui.apply(); const edited = await ui.saved('.profile.json'), report = await ui.saved('.extrusion-report.json');
  assert.deepEqual(edited.vertices, [[8, -3.5], [8, 4.5], [2, 4.5], [2, -3.5]]); assert.equal(edited.height, original.height);
  near(report.profile_area_mm2, 4600); assert.notEqual(report.geometry_sha256, initialReport.geometry_sha256);
  const layout = await ui.saved('.layout.json'); near(measureReferenceVolume({ layout, instance_ids: [edited.name] }).shell_sum_volume_mm3, 36800);
  const reopened = harness(html, base); await reopened.open(edited);
  assert.deepEqual(await reopened.saved('.profile.json'), edited); assert.equal((await reopened.saved('.extrusion-report.json')).geometry_sha256, report.geometry_sha256);
  assert.deepEqual(JSON.parse(reopened.el('points').value), edited.vertices); assert.deepEqual(JSON.parse(reopened.el('cutout').value), edited.cutout);
  const input = path.join(dir, 'edited.profile.json'); await writeFile(input, JSON.stringify(edited));
  const cli = new URL('../bin/moonmold-reference-extrude.mjs', import.meta.url).pathname;
  const execution = spawnSync(process.execPath, [cli, '--input', input, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr); const cliResult = JSON.parse(execution.stdout);
  assert.equal(cliResult.geometry_sha256, report.geometry_sha256); assert.deepEqual(JSON.parse(cliResult.exports.recipe), edited);
  assert.ok(ui.coordinates.length > 0 && ui.coordinates.every(p => p.every(Number.isFinite)));
});

test('real HTTP invalid geometry, changed draft, repeat preview and pending cancellation preserve the applied build', async t => {
  const { ui } = await live(t); await ui.build(); const original = await ui.saved('.profile.json'), links = ui.el('downloads').children;
  ui.change('transform-selection', 'cutout'); ui.change('transform-x', 100);
  await ui.preview(); assert.equal(ui.el('transform-apply').disabled, true); assert.equal(ui.el('downloads').children, links);
  assert.match(ui.el('transform-status').textContent, /unchanged/); assert.deepEqual(JSON.parse(ui.el('cutout').value), original.cutout);
  ui.change('transform-x', 0.1); await ui.preview(); ui.change('height', 1.2);
  assert.equal(ui.el('transform-apply').disabled, true); await ui.apply(); assert.deepEqual(await ui.saved('.profile.json'), original);
  await ui.preview(); assert.match(ui.el('transform-status').textContent, /Candidate only/);
  ui.change('transform-angle', 15); assert.equal(ui.el('transform-apply').disabled, true);
  const hold = ui.holdNext(), pending = ui.preview(); await hold.ready;
  const count = ui.calls.length; await ui.preview(); assert.equal(ui.calls.length, count);
  ui.cancel(); hold.release(); await pending;
  assert.equal(ui.el('transform-apply').disabled, true); assert.match(ui.el('transform-status').textContent, /cancelled/);
  assert.equal(ui.el('downloads').children, links); assert.equal(ui.el('height').value, '1.2');
  await ui.preview(); await ui.apply(); near((await ui.saved('.profile.json')).height, 1.2);
  assert.equal(ui.el('transform-apply').disabled, true); const appliedCalls = ui.calls.length; await ui.apply(); assert.equal(ui.calls.length, appliedCalls);
});
