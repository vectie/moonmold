import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';
import { inspectReferenceDxf, importReferenceDxfProfile } from './reference-dxf-profile.mjs';
import { inspectReferenceSvg, importReferenceSvgProfile } from './reference-svg-profile.mjs';

const recipe = JSON.parse(await readFile(new URL('../fixtures/reference-extrusion.profile.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../ui/reference-profile/index.html', import.meta.url), 'utf8');
const layoutHtml = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
const drawing = await readFile(new URL('../fixtures/reference-outlines.dxf', import.meta.url), 'utf8');
const svgDrawing = await readFile(new URL('../fixtures/reference-outlines.svg', import.meta.url), 'utf8');
function harness() {
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [], state = { fail: false, mismatch: false, mismatchCutout: false, mismatchTolerance: false, hold: false }, lines = [];
  let serial = 0;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '', children: [], handlers: {}, files: [],
      addEventListener(type, handler) { this.handlers[type] = handler; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
    return elements.get(id);
  }
  el('preview').width = 560; el('preview').height = 440;
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo(...p) { lines.push(p); }, lineTo(...p) { lines.push(p); }, stroke() {} });
  el('profile-name').value = recipe.name; el('units').value = recipe.units; el('height').value = String(recipe.height); el('points').value = JSON.stringify(recipe.vertices);
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}) }, Blob, TextDecoder,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (state.hold) await new Promise(resolve => { state.hold = resolve; });
      if (state.fail) return { ok: false, json: async () => ({ message: 'Build unavailable' }) };
      try { const result = url.endsWith('svg-inspect') ? inspectReferenceSvg(input) : url.endsWith('svg-import') ? importReferenceSvgProfile(input) : url.endsWith('dxf-inspect') ? inspectReferenceDxf(input) : url.endsWith('dxf-import') ? importReferenceDxfProfile(input) : extrudeReferenceProfile(input); if (state.mismatch && result.extrusion) result.extrusion.recipe.height += 1; if (state.mismatchCutout && result.extrusion) result.extrusion.recipe.cutout = null; if (state.mismatchTolerance && result.svg_import?.approximation) result.svg_import.approximation.max_error *= 2; return { ok: true, json: async () => result }; }
      catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
    },
  });
  const event = { preventDefault() {} };
  return { el, blobs, revoked, calls, state, lines,
    build: () => el('profile-form').handlers.submit(event), open: () => el('open-form').handlers.submit(event),
    change: (id, value) => { el(id).value = value; el(id).handlers.input(); },
    file: value => { const bytes = Buffer.from(JSON.stringify(value)); el('profile-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }]; },
    saved: async suffix => JSON.parse(await blobs.get(el('downloads').children.find(link => link.download.endsWith(suffix)).href).text()),
  };
}

// Execute the unmodified layout workbench script, rather than substitute a
// direct compose call for its file-open, placement and measurement controls.
function layoutHarness(savedLayout) {
  const elements = new Map(), blobs = new Map(), calls = []; let serial = 0;
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {}, files: [],
      addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
      get selectedOptions() { return this.children.filter(child => child.selected); } });
    return elements.get(id);
  };
  el('preview').width = 1000; el('preview').height = 400;
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  const text = JSON.stringify(savedLayout); el('layout-file').files = [{ size: Buffer.byteLength(text), text: async () => text }];
  runInNewContext(layoutHtml.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob,
    URL: { createObjectURL(blob) { const url = `layout:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      try { return { ok: true, json: async () => url.endsWith('/volume') ? measureReferenceVolume(input) : composeReferenceLayout(input) }; }
      catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
    },
  });
  const event = { preventDefault() {} };
  return { el, calls, open: () => el('load-form').handlers.submit(event),
    measure: () => { el('measurement-mode').value = 'volume'; el('measurement-mode').handlers.change(); return el('surface-area-form').handlers.submit(event); },
    apply: () => el('edit-form').handlers.submit(event),
    saved: async () => JSON.parse(await blobs.get(el('downloads').children.find(link => link.download.endsWith('.layout.json')).href).text()),
    report: async () => JSON.parse(await blobs.get(el('surface-area-downloads').children[0].href).text()),
  };
}

test('production page builds a concave profile, edits height, saves recipe/layout, reopens and previews views', async () => {
  const ui = harness(); assert.equal(ui.el('restore').disabled, true); await ui.build();
  assert.equal(ui.calls[0].url, '/api/reference-profile/extrude'); assert.deepEqual(await ui.saved('.profile.json'), recipe);
  assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [40, 30, 8]);
  assert.equal((await ui.saved('.extrusion-report.json')).physical_authority, false); assert.equal(ui.el('downloads').children.length, 5);
  assert.match(ui.el('summary').textContent, /12 vertices · 20 triangles/); assert.ok(ui.lines.every(p => p.every(Number.isFinite)));
  const first = ui.el('downloads').children[0].href; ui.change('height', '12');
  assert.match(ui.el('status').textContent, /Unbuilt edits/); assert.equal(ui.el('downloads').children[0].href, first);
  await ui.build(); assert.ok(ui.revoked.includes(first)); const revised = await ui.saved('.profile.json'); assert.equal(revised.height, 12);
  assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [40, 30, 12]);
  const hash = (await ui.saved('.extrusion-report.json')).geometry_sha256;
  ui.el('view-top').handlers.click(); ui.el('view-iso').handlers.click(); assert.equal((await ui.saved('.extrusion-report.json')).geometry_sha256, hash);
  ui.file(recipe); await ui.open(); assert.match(ui.el('status').textContent, /reopened/); assert.equal(ui.el('height').value, '8');
  assert.deepEqual(await ui.saved('.profile.json'), recipe);
});

test('production page imports selected DXF outline then edits and reopens its portable profile', async () => {
  const ui = harness(); const bytes = Buffer.from(drawing); ui.el('dxf-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
  await ui.el('dxf-form').handlers.submit({ preventDefault() {} });
  assert.equal(ui.calls[0].url, '/api/reference-profile/dxf-inspect'); assert.equal(ui.el('dxf-entity').children.length, 2);
  assert.equal(ui.el('dxf-import').disabled, false); assert.match(ui.el('dxf-summary').textContent, /3 drawing entities/);
  await ui.el('dxf-import').handlers.click(); assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [40, 30, 8]);
  assert.equal((await ui.saved('.dxf-import-report.json')).entity_index, 1); assert.equal(ui.el('downloads').children.length, 6);
  ui.el('dxf-entity').value = '3'; ui.el('dxf-entity').handlers.change(); ui.change('units', 'cm'); ui.change('height', '2');
  await ui.el('dxf-import').handlers.click(); assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [200, 200, 20]);
  assert.equal((await ui.saved('.dxf-import-report.json')).layer, 'TRIANGLE');
  const imported = await ui.saved('.profile.json'); ui.change('height', '3'); await ui.build();
  assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [200, 200, 30]); assert.equal(ui.el('downloads').children.length, 5);
  ui.file(imported); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), imported);
});

test('DXF file and selection changes suppress stale replies; failures preserve current fields/build', async () => {
  const ui = harness(); await ui.build(); const links = ui.el('downloads').children;
  ui.el('dxf-file').files = [{ size: 3, arrayBuffer: async () => Buffer.from('bad') }];
  await ui.el('dxf-form').handlers.submit({ preventDefault() {} }); assert.equal(ui.el('downloads').children, links); assert.equal(ui.el('dxf-import').disabled, true);
  const bytes = Buffer.from(drawing); ui.el('dxf-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
  await ui.el('dxf-form').handlers.submit({ preventDefault() {} });
  ui.state.hold = true; const pending = ui.el('dxf-import').handlers.click(); await new Promise(resolve => setImmediate(resolve));
  const count = ui.calls.length; await ui.el('dxf-import').handlers.click(); assert.equal(ui.calls.length, count);
  ui.el('dxf-file').handlers.change(); const release = ui.state.hold; ui.state.hold = false; release(); await pending;
  assert.equal(ui.el('downloads').children, links); assert.equal(ui.el('dxf-import').disabled, true); assert.equal(ui.el('points').value, JSON.stringify(recipe.vertices, null, 2));
  assert.match(ui.el('status').textContent, /Drawing changed/);
  await ui.el('dxf-form').handlers.submit({ preventDefault() {} }); ui.el('dxf-entity').value = '2'; await ui.el('dxf-import').handlers.click();
  assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /Selected entity/);
});

test('invalid drafts, server failures and mismatched replies preserve last build; restore discards unapplied fields', async () => {
  const ui = harness(); await ui.build(); const links = ui.el('downloads').children;
  ui.change('points', 'not json'); await ui.build(); assert.equal(ui.calls.length, 1); assert.equal(ui.el('downloads').children, links);
  ui.el('restore').handlers.click(); assert.deepEqual(JSON.parse(ui.el('points').value), recipe.vertices);
  for (const mode of ['fail', 'mismatch', 'negative', 'blank']) {
    ui.state.fail = mode === 'fail'; ui.state.mismatch = mode === 'mismatch';
    ui.change('height', mode === 'negative' ? '-2' : mode === 'blank' ? '' : '12'); await ui.build();
    assert.equal(ui.el('downloads').children, links); assert.deepEqual(await ui.saved('.profile.json'), recipe);
    assert.match(ui.el('status').textContent, /unchanged/); assert.equal(ui.el('profile-controls').disabled, false);
  }
  ui.el('restore').handlers.click(); assert.equal(ui.el('height').value, '8');
});

test('repeated submits are single-flight and edited drafts invalidate pending responses', async () => {
  const ui = harness(); await ui.build(); const links = ui.el('downloads').children; ui.change('height', '10');
  ui.state.hold = true; const pending = ui.build(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.el('profile-controls').disabled, true); const calls = ui.calls.length; await ui.build(); await ui.open(); assert.equal(ui.calls.length, calls);
  // A programmatic update or restored page state must also invalidate an old reply.
  ui.change('height', '15'); const release = ui.state.hold; ui.state.hold = false; release(); await pending;
  assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /Unbuilt edits/);
  assert.equal(ui.el('profile-controls').disabled, false); await ui.build(); assert.equal((await ui.saved('.profile.json')).height, 15);
});

test('file reads are bounded and strict UTF-8; a late file cannot overwrite changed fields', async () => {
  const ui = harness(); await ui.build(); const links = ui.el('downloads').children;
  for (const file of [null, { size: 32001 }, { size: 1, arrayBuffer: async () => Buffer.from([255]) }, { size: 1, arrayBuffer: async () => Buffer.alloc(32001) }]) {
    ui.el('profile-file').files = file ? [file] : []; await ui.open(); assert.equal(ui.el('downloads').children, links); assert.equal(ui.calls.length, 1);
  }
  let release;
  ui.el('profile-file').files = [{ size: 100, arrayBuffer: () => new Promise(resolve => { release = resolve; }) }];
  const pending = ui.open(); ui.change('height', '20'); release(Buffer.from(JSON.stringify(recipe))); await pending;
  assert.equal(ui.calls.length, 1); assert.equal(ui.el('height').value, '20'); assert.equal(ui.el('downloads').children, links);
});

test('production page loads the cutout sample, edits both rings and height, measures saved layout and reopens recipe', async () => {
  const ui = harness(); await ui.build(); const oldLinks = ui.el('downloads').children;
  ui.el('sample-plate').handlers.click(); assert.equal(ui.el('downloads').children, oldLinks); assert.match(ui.el('status').textContent, /unbuilt edits/);
  await ui.build(); const sample = await ui.saved('.profile.json');
  assert.equal(sample.contract_id, 'moonmold.reference-profile-extrusion.v2'); assert.equal(sample.cutout.length, 4);
  assert.match(ui.el('summary').textContent, /16 vertices · 32 triangles/); assert.match(ui.el('summary').textContent, /Net profile area 1000 mm²/);
  assert.match(ui.el('summary').textContent, /Outer area 1200 mm² · Cutout area 200 mm²/);
  let layout = await ui.saved('.layout.json'); assert.equal(measureReferenceVolume({ layout, instance_ids: [sample.name] }).shell_sum_volume_mm3, 8000);
  const originalHash = (await ui.saved('.extrusion-report.json')).recipe_sha256;
  ui.change('cutout', '[[8,10],[32,10],[32,20],[8,20]]'); ui.change('height', '12'); await ui.build();
  layout = await ui.saved('.layout.json'); assert.equal(measureReferenceVolume({ layout, instance_ids: [sample.name] }).shell_sum_volume_mm3, 11520);
  const workbench = layoutHarness(layout); await workbench.open(); assert.equal(workbench.el('edit-controls').disabled, false);
  assert.equal(workbench.el('selected').value, sample.name); await workbench.measure();
  assert.match(workbench.el('surface-area-status').textContent, /Shell sum: 11520 mm³/);
  const measured = await workbench.report(); assert.equal(measured.geometry_sha256, (await ui.saved('.extrusion-report.json')).geometry_sha256);
  workbench.el('tx').value = '10'; workbench.el('tx').handlers.input(); assert.equal(workbench.el('surface-area-downloads').children.length, 0);
  await workbench.apply(); await workbench.measure(); assert.equal((await workbench.report()).shell_sum_volume_mm3, 11520);
  const placed = await workbench.saved(); assert.equal(placed.instances[0].transform.translation_mm[0], 10);
  assert.notEqual((await workbench.report()).layout_sha256, measured.layout_sha256);
  const reopenedWorkbench = layoutHarness(placed); await reopenedWorkbench.open(); await reopenedWorkbench.measure();
  assert.equal((await reopenedWorkbench.report()).shell_sum_volume_mm3, 11520);
  assert.notEqual((await ui.saved('.extrusion-report.json')).recipe_sha256, originalHash);
  ui.change('points', '[[0,0],[50,0],[50,30],[0,30]]'); await ui.build();
  assert.equal((await ui.saved('.extrusion-report.json')).profile_area_mm2, 1260);
  const edited = await ui.saved('.profile.json'); ui.file(sample); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), sample);
  ui.file(edited); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), edited); assert.deepEqual(JSON.parse(ui.el('cutout').value), edited.cutout);
  assert.ok(ui.lines.every(p => p.every(Number.isFinite)));
});

test('invalid and mismatched cutout edits preserve the last build and restore returns both rings', async () => {
  const ui = harness(); ui.el('sample-plate').handlers.click(); await ui.build(); const links = ui.el('downloads').children, original = await ui.saved('.profile.json');
  for (const cutout of ['not json', '[]', '[[0,10],[10,10],[10,20],[0,20]]', '[[50,10],[60,10],[60,20],[50,20]]']) {
    ui.change('cutout', cutout); await ui.build(); assert.equal(ui.el('downloads').children, links);
    assert.match(ui.el('status').textContent, /unchanged/); assert.equal(ui.el('cutout').value, cutout);
  }
  ui.el('restore').handlers.click(); assert.deepEqual(JSON.parse(ui.el('cutout').value), original.cutout);
  ui.state.mismatchCutout = true; ui.change('height', '12'); await ui.build(); assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /does not match/);
  ui.state.mismatchCutout = false; ui.el('restore').handlers.click();
  ui.file({ ...original, cutout: [] }); await ui.open(); assert.equal(ui.el('downloads').children, links); assert.deepEqual(JSON.parse(ui.el('cutout').value), original.cutout);
  ui.change('cutout', ''); await ui.build(); const solid = await ui.saved('.profile.json');
  assert.equal(solid.contract_id, 'moonmold.reference-profile-extrusion.v2'); assert.equal(solid.cutout, null);
  assert.equal((await ui.saved('.extrusion-report.json')).profile_area_mm2, 1200);
  ui.file(original); await ui.open(); ui.file(recipe); await ui.open();
  assert.equal(ui.el('cutout').value, ''); assert.deepEqual(await ui.saved('.profile.json'), recipe);
});

test('cutout edits invalidate pending replies and DXF import explicitly replaces the opening', async () => {
  const ui = harness(); ui.el('sample-plate').handlers.click(); await ui.build(); const links = ui.el('downloads').children;
  ui.state.hold = true; const pending = ui.build(); await new Promise(resolve => setImmediate(resolve));
  ui.change('cutout', '[[8,10],[32,10],[32,20],[8,20]]'); const release = ui.state.hold; ui.state.hold = false; release(); await pending;
  assert.equal(ui.el('downloads').children, links); await ui.build(); assert.equal((await ui.saved('.extrusion-report.json')).profile_area_mm2, 960);
  const bytes = Buffer.from(drawing); ui.el('dxf-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
  await ui.el('dxf-form').handlers.submit({ preventDefault() {} }); await ui.el('dxf-import').handlers.click();
  assert.equal(ui.el('cutout').value, ''); assert.equal((await ui.saved('.profile.json')).contract_id, 'moonmold.reference-profile-extrusion.v1');
  assert.match(html, /replaces the current outer outline and cutout/);
});

test('SVG workbench journey requires scale/convention, saves original bytes and editable derivatives, revises and reopens', async () => {
  // Inspect must bypass native form validation: import choices intentionally
  // start blank, and the inspect handler independently checks its file input.
  assert.match(html, /<button\s+formnovalidate>Inspect SVG outlines<\/button>/);
  const ui = harness(); const bytes = Buffer.from(svgDrawing); ui.el('svg-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
  await ui.el('svg-form').handlers.submit({ preventDefault() {} }); assert.equal(ui.calls[0].url, '/api/reference-profile/svg-inspect');
  assert.equal(ui.el('svg-element').children.length, 4); assert.equal(ui.el('svg-element').children[2].disabled, true);
  await ui.el('svg-import').handlers.click(); assert.match(ui.el('status').textContent, /explicit scale/); assert.equal(ui.el('downloads').children.length, 0);
  ui.el('svg-scale').value = '1'; await ui.el('svg-import').handlers.click();
  assert.match(ui.el('status').textContent, /explicit scale, convention/); assert.equal(ui.el('downloads').children.length, 0);
  ui.el('svg-convention').value = 'svg-y-down-to-xy-y-up';
  await ui.el('svg-import').handlers.click(); assert.equal(ui.el('downloads').children.length, 7);
  const original = await ui.saved('.profile.json'), record = await ui.saved('.svg-import-record.json');
  assert.equal(record.element_index, 4); assert.equal(record.units_per_svg_unit, 1); assert.deepEqual(Buffer.from(record.source.bytes, 'base64'), bytes);
  assert.equal(await ui.blobs.get(ui.el('downloads').children.find(link => link.download.endsWith('.original.svg')).href).text(), svgDrawing);
  assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [40, 30, 8]);
  ui.change('height', '12'); ui.change('points', JSON.stringify(original.vertices.map(([x, y]) => [2 * x, y]))); await ui.build();
  assert.equal(ui.el('downloads').children.length, 5); const edited = await ui.saved('.profile.json');
  assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [80, 30, 12]);
  const layout = layoutHarness(await ui.saved('.layout.json')); await layout.open(); await layout.measure();
  assert.equal((await layout.report()).shell_sum_volume_mm3, 16800);
  ui.file(original); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), original);
  ui.file(edited); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), edited);
  assert.notEqual((await ui.saved('.extrusion-report.json')).recipe_sha256, record.recipe_sha256);
});

test('SVG changed files/choices, duplicate submits, malformed input and mismatched replies preserve last build', async () => {
  const ui = harness(); await ui.build(); const links = ui.el('downloads').children;
  ui.el('svg-file').files = [{ size: 3, arrayBuffer: async () => Buffer.from('bad') }];
  await ui.el('svg-form').handlers.submit({ preventDefault() {} }); assert.equal(ui.el('svg-import').disabled, true); assert.equal(ui.el('downloads').children, links);
  const bytes = Buffer.from(svgDrawing); ui.el('svg-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
  await ui.el('svg-form').handlers.submit({ preventDefault() {} }); ui.el('svg-scale').value = '1'; ui.el('svg-convention').value = 'svg-y-down-to-xy-y-up';
  ui.state.hold = true; const pending = ui.el('svg-import').handlers.click(); await new Promise(resolve => setImmediate(resolve));
  const count = ui.calls.length; await ui.el('svg-import').handlers.click(); assert.equal(ui.calls.length, count);
  ui.el('svg-scale').value = '2'; ui.el('svg-scale').handlers.input(); const release = ui.state.hold; ui.state.hold = false; release(); await pending;
  assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /choices changed/);
  ui.state.mismatch = true; await ui.el('svg-import').handlers.click(); assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /does not match/);
  ui.state.mismatch = false; ui.el('svg-element').value = '6'; await ui.el('svg-import').handlers.click(); assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /explicitly repeat/);
  ui.el('svg-file').handlers.change(); assert.equal(ui.el('svg-import').disabled, true); assert.equal(ui.el('downloads').children, links);
});

test('production curved SVG controls require tolerance, save approximation and reopen point/height edits', async () => {
  const drawing = await readFile(new URL('../fixtures/reference-curved-outline.svg', import.meta.url), 'utf8');
  const ui = harness(), bytes = Buffer.from(drawing); ui.el('svg-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
  await ui.el('svg-form').handlers.submit({ preventDefault() {} });
  assert.match(ui.el('svg-element').children[0].textContent, /explicit error limit required/);
  ui.el('svg-scale').value = '1'; ui.el('svg-convention').value = 'svg-y-down-to-xy-y-up';
  await ui.el('svg-import').handlers.click(); assert.match(ui.el('status').textContent, /explicit curve maximum approximation error/); assert.equal(ui.el('downloads').children.length, 0);
  ui.change('svg-max-error', '0.25'); await ui.el('svg-import').handlers.click();
  assert.match(ui.el('status').textContent, /maximum error 0.25 mm/);
  const record = await ui.saved('.svg-import-record.json'), original = await ui.saved('.profile.json');
  assert.equal(record.contract_id, 'moonmold.reference-svg-profile-import.v2'); assert.equal(record.approximation.max_error, 0.25);
  assert.deepEqual(Buffer.from(record.source.bytes, 'base64'), bytes); assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [45, 39, 8]);
  const revised = original.vertices.map(point => [...point]); revised[0][0] = -2;
  ui.change('points', JSON.stringify(revised)); ui.change('height', '12'); await ui.build();
  const edited = await ui.saved('.profile.json'); assert.equal(ui.el('downloads').children.length, 5);
  assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [47, 39, 12]);
  const layout = layoutHarness(await ui.saved('.layout.json')); await layout.open(); await layout.measure(); assert.ok((await layout.report()).shell_sum_volume_mm3 > 0);
  ui.file(original); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), original);
  ui.file(edited); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), edited);
  assert.notEqual((await ui.saved('.extrusion-report.json')).recipe_sha256, record.recipe_sha256);
});

test('production basic-shape controls import each shape, edit/save/reopen and retain original SVG', async () => {
  const drawing = await readFile(new URL('../fixtures/reference-basic-shapes.svg', import.meta.url), 'utf8');
  for (const [element, size] of [[2, [40, 20, 8]], [3, [20, 20, 8]], [4, [40, 16, 8]]]) {
    const ui = harness(), bytes = Buffer.from(drawing);
    ui.el('svg-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }];
    await ui.el('svg-form').handlers.submit({ preventDefault() {} });
    assert.equal(ui.el('svg-element').children.length, 3);
    ui.el('svg-element').value = String(element); ui.el('svg-scale').value = '1'; ui.el('svg-convention').value = 'svg-y-down-to-xy-y-up';
    if (element !== 2) { await ui.el('svg-import').handlers.click(); assert.match(ui.el('status').textContent, /explicit curve/); }
    ui.change('svg-max-error', '0.1'); await ui.el('svg-import').handlers.click();
    const record = await ui.saved('.svg-import-record.json'), original = await ui.saved('.profile.json');
    assert.equal(record.contract_id, 'moonmold.reference-svg-profile-import.v3');
    assert.deepEqual(Buffer.from(record.source.bytes, 'base64'), bytes);
    assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, size);
    ui.change('height', '12'); ui.change('points', JSON.stringify(original.vertices.map(([x, y]) => [x + 2, y]))); await ui.build();
    const edited = await ui.saved('.profile.json'); assert.equal(ui.el('downloads').children.length, 5);
    ui.file(edited); await ui.open(); assert.deepEqual(await ui.saved('.profile.json'), edited);
    assert.deepEqual(composeReferenceLayout(await ui.saved('.layout.json')).bounds.size, [size[0], size[1], 12]);
    assert.notEqual((await ui.saved('.extrusion-report.json')).recipe_sha256, record.recipe_sha256);
    const layout = layoutHarness(await ui.saved('.layout.json')); await layout.open(); await layout.measure(); assert.ok((await layout.report()).shell_sum_volume_mm3 > 0);
  }
});

test('changed path tolerance/units and mismatched approximation suppress pending replies and preserve last model', async () => {
  const ui = harness(); await ui.build(); const links = ui.el('downloads').children, bytes = Buffer.from(svgDrawing);
  ui.el('svg-file').files = [{ size: bytes.length, arrayBuffer: async () => bytes }]; await ui.el('svg-form').handlers.submit({ preventDefault() {} });
  ui.el('svg-element').value = '7'; ui.el('svg-scale').value = '1'; ui.el('svg-convention').value = 'svg-y-down-to-xy-y-up'; ui.change('svg-max-error', '0.25');
  for (const [field, value] of [['svg-max-error', '0.1'], ['units', 'cm']]) {
    ui.state.hold = true; const pending = ui.el('svg-import').handlers.click(); await new Promise(resolve => setImmediate(resolve));
    const count = ui.calls.length; await ui.el('svg-import').handlers.click(); assert.equal(ui.calls.length, count);
    ui.change(field, value); const release = ui.state.hold; ui.state.hold = false; release(); await pending;
    assert.equal(ui.el('downloads').children, links);
  }
  ui.change('units', 'mm'); ui.state.mismatchTolerance = true; await ui.el('svg-import').handlers.click();
  assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /does not match/);
  ui.state.mismatchTolerance = false; ui.change('svg-max-error', '0.000001'); await ui.el('svg-import').handlers.click();
  assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /128|subdivision/);
  ui.change('svg-max-error', '0.25'); await ui.el('svg-import').handlers.click(); assert.notEqual(ui.el('downloads').children, links);
});
