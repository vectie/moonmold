import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceSurfaceArea } from './reference-surface-area.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-surface-area.layout.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
function harness() {
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [];
  let serial = 0;
  const state = { fail: false, mismatch: false, hold: null };
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
      get selectedOptions() { return this.children.filter(child => child.selected); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  el('preview').width = 1000; el('preview').height = 400;
  el('layout-file').files = [{ size: 1000, text: async () => JSON.stringify(layout) }];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (url.endsWith('/surface-area')) {
        if (state.hold) await new Promise(resolve => { state.hold = resolve; });
        if (state.fail) return { ok: false, json: async () => ({ message: 'Area unavailable' }) };
        const result = measureReferenceSurfaceArea(input);
        if (state.mismatch === 'hash') result.layout_sha256 = '0'.repeat(64);
        if (state.mismatch === 'selection') result.instance_ids = ['not-requested'];
        return { ok: true, json: async () => result };
      }
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} };
  return { el, blobs, revoked, calls, state, event,
    open: () => el('load-form').handlers.submit(event),
    calculate: () => el('surface-area-form').handlers.submit(event),
    choose(ids) { el('surface-area-targets').children.forEach(option => option.selected = ids.includes(option.value)); el('surface-area-targets').handlers.change(); },
    links: () => el('surface-area-downloads').children,
  };
}

test('production UI selects references, shows literal area, exports CSV/JSON and invalidates applied edits or selection changes', async () => {
  const ui = harness();
  await ui.calculate(); assert.equal(ui.calls.length, 0);
  await ui.open(); assert.equal(ui.el('surface-area-controls').disabled, false);
  assert.equal(ui.el('surface-area-targets').selectedOptions.length, 3);
  ui.choose(['base', 'selected-bracket']); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Total: 500 mm²/);
  assert.match(ui.el('surface-area-status').textContent, /Not exposed exterior area/);
  assert.equal(ui.links().length, 2);
  assert.equal(ui.links()[0].download, 'surface-panels.surface-area.json');
  const firstUrl = ui.links()[0].href;
  const report = JSON.parse(await ui.blobs.get(firstUrl).text());
  assert.deepEqual(report.instance_ids, ['base', 'selected-bracket']);
  assert.equal(await ui.blobs.get(ui.links()[1].href).text(), measureReferenceSurfaceArea({ layout, instance_ids: report.instance_ids }).exports.csv);
  ui.choose(['upright']); assert.equal(ui.links().length, 0); assert.ok(ui.revoked.includes(firstUrl));
  await ui.calculate(); assert.match(ui.el('surface-area-status').textContent, /Total: 1350 mm²/);
  const previous = ui.links()[0].href;
  ui.el('scale').value = '2'; ui.el('scale').handlers.input();
  assert.equal(ui.links().length, 0); assert.ok(ui.revoked.includes(previous)); assert.equal(ui.el('surface-area-controls').disabled, true);
  const count = ui.calls.length; await ui.calculate(); assert.equal(ui.calls.length, count);
  await ui.el('edit-form').handlers.submit(ui.event); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Total: 2450 mm²/);
  const changed = JSON.parse(await ui.blobs.get(ui.links()[0].href).text());
  assert.notEqual(changed.layout_sha256, report.layout_sha256);
  assert.equal(changed.parts[0].triangle_sum_area_mm2, 800);
  const editable = ui.el('downloads').children.find(link => link.download.endsWith('.layout.json'));
  const saved = JSON.parse(await ui.blobs.get(editable.href).text());
  assert.equal(measureReferenceSurfaceArea({ layout: saved, instance_ids: changed.instance_ids }).layout_sha256, changed.layout_sha256);
});

test('UI preserves valid reports on failed responses and rejects repeat, mismatched or superseded requests', async () => {
  const ui = harness(); await ui.open(); await ui.calculate();
  const good = ui.links()[0].href;
  ui.state.fail = true; await ui.calculate();
  assert.equal(ui.links()[0].href, good); assert.match(ui.el('status').textContent, /Area unavailable/);
  ui.state.fail = false;
  for (const mismatch of ['hash', 'selection']) {
    ui.state.mismatch = mismatch; await ui.calculate();
    assert.equal(ui.links()[0].href, good); assert.match(ui.el('status').textContent, /does not match the requested layout and selection/);
  }
  ui.state.mismatch = false; ui.state.hold = true;
  const pending = ui.calculate(), count = ui.calls.length;
  await ui.calculate(); assert.equal(ui.calls.length, count); assert.equal(ui.el('surface-area-controls').disabled, true);
  // A selection event while a response is pending invalidates that response.
  ui.choose(['upright']); const release = ui.state.hold; ui.state.hold = null; release(); await pending;
  assert.equal(ui.links().length, 0); assert.equal(ui.el('surface-area-controls').disabled, false);
  await ui.calculate(); assert.match(ui.el('surface-area-status').textContent, /Total: 1350 mm²/);
  ui.choose([]); const before = ui.calls.length; await ui.calculate();
  assert.equal(ui.calls.length, before); assert.match(ui.el('status').textContent, /Choose at least one instance/);
});

test('last removal clears area choices and downloads, and reopening restores the complete source workflow', async () => {
  const ui = harness(); await ui.open(); await ui.calculate(); const old = ui.links()[0].href;
  while (!ui.el('surface-area-controls').disabled) await ui.el('remove').handlers.click();
  assert.equal(ui.links().length, 0); assert.ok(ui.revoked.includes(old));
  assert.equal(ui.el('surface-area-targets').children.length, 0);
  const count = ui.calls.length; await ui.calculate(); assert.equal(ui.calls.length, count);
  await ui.open(); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Total: 1850 mm²/);
  assert.equal(JSON.parse(await ui.blobs.get(ui.links()[0].href).text()).layout_sha256, composeReferenceLayout(layout).layout_sha256);
});
