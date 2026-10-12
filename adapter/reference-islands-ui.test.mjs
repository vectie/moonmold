import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { inspectReferenceIslands, splitReferenceIslands } from './reference-islands.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-islands.layout.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
function harness() {
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [], state = { fail: false, mismatch: false, hold: null };
  let serial = 0;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
      get selectedOptions() { return this.children.filter(child => child.selected); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  el('preview').width = 1000; el('preview').height = 400;
  el('layout-file').files = [{ size: 2000, text: async () => JSON.stringify(layout) }];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (url.endsWith('/islands') || url.endsWith('/split-islands')) {
        if (state.hold) await new Promise(resolve => { state.hold = resolve; });
        if (state.fail) return { ok: false, json: async () => ({ message: 'Island request unavailable' }) };
        try {
          const result = url.endsWith('/split-islands') ? splitReferenceIslands(input) : inspectReferenceIslands(input);
          if (state.mismatch) { if (result.island_split) result.island_split.parent_layout_sha256 = '0'.repeat(64); else result.instance_id = 'not-selected'; }
          return { ok: true, json: async () => result };
        } catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
      }
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} };
  return { el, blobs, revoked, calls, state, event,
    open: () => el('load-form').handlers.submit(event), inspect: () => el('islands-inspect').handlers.click(), split: () => el('islands-split').handlers.click(),
    click: id => el(id).handlers.click(),
    saved: async suffix => JSON.parse(await blobs.get(el('downloads').children.find(link => link.download.endsWith(suffix)).href).text()),
  };
}

test('production operator inspects, separates, moves an island, saves/reopens and reverses split through existing Undo/Redo', async () => {
  const ui = harness(); await ui.inspect(); await ui.split(); assert.equal(ui.calls.length, 0);
  await ui.open(); const original = await ui.saved('.layout.json');
  await ui.inspect(); assert.match(ui.el('islands-status').textContent, /brackets: 2 edge-connected islands/); assert.equal(ui.el('islands-split').disabled, false);
  const catalogUrl = ui.el('islands-download').children[0].href;
  const catalog = JSON.parse(await ui.blobs.get(catalogUrl).text()); assert.deepEqual(catalog.components.map(item => item.parent_local_triangle_indices), [[0, 2], [1, 3]]);
  assert.deepEqual(await ui.saved('.layout.json'), original, 'inspection does not apply an edit');
  await ui.split(); const saved = await ui.saved('.layout.json'), recipe = await ui.saved('.islands.json');
  assert.deepEqual(saved, splitReferenceIslands({ layout, instance_id: 'brackets' }).layout);
  assert.equal(ui.el('selected').value, 'brackets.island-1'); assert.equal(ui.el('islands-restore').disabled, false); assert.ok(ui.revoked.includes(catalogUrl));
  assert.equal(ui.el('islands-download').children.length, 0); assert.equal(ui.el('islands-split').disabled, true);
  await ui.click('layout-undo'); assert.deepEqual(await ui.saved('.layout.json'), original); assert.equal(ui.el('islands-restore').disabled, true);
  await ui.click('layout-redo'); assert.deepEqual(await ui.saved('.layout.json'), saved); assert.deepEqual(await ui.saved('.islands.json'), recipe);
  ui.el('tz').value = '30'; ui.el('tz').handlers.input(); await ui.el('edit-form').handlers.submit(ui.event);
  const moved = await ui.saved('.layout.json'); assert.equal(moved.instances[0].transform.translation_mm[2], 30); assert.deepEqual(moved.instances.slice(1), saved.instances.slice(1));
  assert.equal(ui.el('islands-restore').disabled, true); assert.ok(!ui.el('downloads').children.some(link => link.download.endsWith('.islands.json')));
  await ui.click('layout-undo'); assert.deepEqual(await ui.saved('.islands.json'), recipe);
  ui.el('layout-file').files = [{ size: 5000, text: async () => JSON.stringify(saved) }]; await ui.open(); assert.deepEqual(await ui.saved('.layout.json'), saved);
  assert.equal(ui.el('layout-undo').disabled, true); await ui.inspect(); assert.match(ui.el('islands-status').textContent, /Nothing to separate/); assert.equal(ui.el('islands-split').disabled, true);
});

test('failed, mismatched and repeated requests preserve last good layout; dirty fields and selection invalidate the catalog', async () => {
  const ui = harness(); await ui.open(); await ui.inspect(); const links = ui.el('downloads').children, catalogUrl = ui.el('islands-download').children[0].href;
  for (const mode of ['fail', 'mismatch']) {
    ui.state.fail = mode === 'fail'; ui.state.mismatch = mode === 'mismatch';
    await ui.inspect(); assert.equal(ui.el('islands-download').children[0].href, catalogUrl); await ui.split();
    assert.equal(ui.el('downloads').children, links); assert.match(ui.el('status').textContent, /unavailable|does not match/);
  }
  ui.state.fail = false; ui.state.mismatch = false;
  ui.el('tx').value = '101'; ui.el('tx').handlers.input(); assert.equal(ui.el('islands-controls').disabled, true); assert.equal(ui.el('islands-download').children.length, 0);
  const count = ui.calls.length; await ui.inspect(); await ui.split(); assert.equal(ui.calls.length, count);
  await ui.click('discard-placement'); await ui.inspect();
  ui.el('selected').value = 'marker'; ui.el('selected').handlers.change(); assert.equal(ui.el('islands-download').children.length, 0); assert.equal(ui.el('islands-split').disabled, true);
  ui.el('selected').value = 'brackets'; ui.el('selected').handlers.change(); await ui.inspect();
  ui.state.hold = true; const pending = ui.split(), submitted = ui.calls.length;
  await ui.split(); await ui.inspect(); assert.equal(ui.calls.length, submitted); assert.equal(ui.el('islands-controls').disabled, true);
  const release = ui.state.hold; ui.state.hold = null; release(); await pending;
  assert.equal((await ui.saved('.layout.json')).instances.length, 3); assert.equal(ui.el('islands-controls').disabled, false);
});

test('recipe reopening restores original sources on demand; last removal clears inspection and recipe controls', async () => {
  const ui = harness(); await ui.open(); await ui.inspect(); await ui.split(); const recipe = await ui.saved('.islands.json');
  ui.el('layout-file').files = [{ size: 5000, text: async () => JSON.stringify(recipe) }]; await ui.open();
  assert.match(ui.el('status').textContent, /Island recipe reopened/); assert.deepEqual(await ui.saved('.islands.json'), recipe);
  await ui.click('islands-restore'); assert.deepEqual(await ui.saved('.layout.json'), composeReferenceLayout(layout).layout); assert.equal(ui.el('selected').value, 'brackets');
  await ui.inspect(); const old = ui.el('islands-download').children[0].href;
  while (!ui.el('islands-controls').disabled) await ui.click('remove');
  assert.equal(ui.el('islands-download').children.length, 0); assert.ok(ui.revoked.includes(old)); assert.equal(ui.el('islands-restore').disabled, true);
  const count = ui.calls.length; await ui.inspect(); await ui.split(); assert.equal(ui.calls.length, count);
  await ui.click('layout-undo'); assert.equal(ui.el('islands-controls').disabled, false);
});
