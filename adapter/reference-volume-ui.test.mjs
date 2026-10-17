import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceVolume } from './reference-volume.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-volume.layout.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
function harness() {
  const elements = new Map(), blobs = new Map(), calls = [], revoked = [];
  const state = { hold: null, fail: false, mismatch: false };
  let serial = 0;
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
      if (url.endsWith('/volume')) {
        if (state.hold) await new Promise(resolve => { state.hold = resolve; });
        if (state.fail) return { ok: false, json: async () => ({ message: 'Measurement unavailable' }) };
        const result = measureReferenceVolume(input);
        if (state.mismatch) result.layout_sha256 = '0'.repeat(64);
        return { ok: true, json: async () => result };
      }
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} };
  el('measurement-mode').value = 'volume';
  return { el, calls, blobs, revoked, state, event,
    open: () => el('load-form').handlers.submit(event), calculate: () => el('surface-area-form').handlers.submit(event),
    choose(ids) { el('surface-area-targets').children.forEach(o => o.selected = ids.includes(o.value)); el('surface-area-targets').handlers.change(); },
    links: () => el('surface-area-downloads').children,
  };
}

test('production volume controls open mixed geometry, select closed parts, download exact report, edit scale and reopen source', async () => {
  const ui = harness(); await ui.open(); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Unavailable: inspect individual parts/);
  assert.match(ui.el('surface-area-status').textContent, /open-panel: unavailable-topology; boundary 3/);
  assert.match(ui.el('surface-area-status').textContent, /Not Boolean union/);
  ui.choose(['tetra-cm', 'reversed-tetra']); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Shell sum: 4032 mm³/);
  assert.equal(ui.links()[0].download, 'shell-study.shell-volume.json');
  const firstUrl = ui.links()[0].href, report = JSON.parse(await ui.blobs.get(firstUrl).text());
  assert.equal(report.shell_sum_volume_mm3, 4032);
  assert.equal(await ui.blobs.get(ui.links()[1].href).text(), measureReferenceVolume({ layout, instance_ids: report.instance_ids }).exports.csv);
  ui.el('scale').value = '2'; ui.el('scale').handlers.input();
  assert.equal(ui.links().length, 0); assert.ok(ui.revoked.includes(firstUrl));
  assert.equal(ui.el('surface-area-controls').disabled, true);
  await ui.el('edit-form').handlers.submit(ui.event);
  ui.choose(['tetra-cm', 'reversed-tetra']); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Shell sum: 32032 mm³/);
  const sourceLink = ui.el('downloads').children.find(link => link.download.endsWith('.layout.json'));
  const saved = JSON.parse(await ui.blobs.get(sourceLink.href).text());
  assert.equal(measureReferenceVolume({ layout: saved, instance_ids: report.instance_ids }).shell_sum_volume_mm3, 32032);
  await ui.open(); ui.choose(['tetra-cm', 'reversed-tetra']); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Shell sum: 4032 mm³/);
});

test('volume mode preserves existing report on failed or mismatched response and discards changed mode during pending work', async () => {
  const ui = harness(); await ui.open(); await ui.calculate(); const good = ui.links()[0].href;
  ui.state.fail = true; await ui.calculate(); assert.equal(ui.links()[0].href, good);
  ui.state.fail = false; ui.state.mismatch = true; await ui.calculate();
  assert.equal(ui.links()[0].href, good); assert.match(ui.el('status').textContent, /does not match/);
  ui.state.mismatch = false; ui.state.hold = true;
  const pending = ui.calculate(), count = ui.calls.length;
  await ui.calculate(); assert.equal(ui.calls.length, count);
  ui.el('measurement-mode').value = 'area'; ui.el('measurement-mode').handlers.change();
  const release = ui.state.hold; ui.state.hold = null; release(); await pending;
  assert.equal(ui.links().length, 0); assert.equal(ui.el('surface-area-controls').disabled, false);
  ui.el('measurement-mode').value = 'volume'; ui.el('measurement-mode').handlers.change();
  ui.choose([]); const before = ui.calls.length; await ui.calculate(); assert.equal(ui.calls.length, before);
});

test('volume removal clears reports and choice lists; reload remains available', async () => {
  const ui = harness(); await ui.open(); await ui.calculate(); const good = ui.links()[0].href;
  while (!ui.el('surface-area-controls').disabled) await ui.el('remove').handlers.click();
  assert.equal(ui.links().length, 0); assert.ok(ui.revoked.includes(good));
  assert.equal(ui.el('surface-area-targets').children.length, 0);
  await ui.open(); ui.choose(['tetra-cm']); await ui.calculate();
  assert.match(ui.el('surface-area-status').textContent, /Shell sum: 4000 mm³/);
});
