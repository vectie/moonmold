import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { fitReferenceEnvelope } from './reference-envelope-fit.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-layout.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
function harness() {
  const drawing = { points: [], labels: [] };
  const elements = new Map(), blobs = new Map(), revoked = [], calls = [], state = { fail: false, mismatch: false, hold: null };
  let serial = 0;
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
      get selectedOptions() { return this.children.filter(child => child.selected); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() { drawing.points = []; drawing.labels = []; }, beginPath() {}, moveTo(...p) { drawing.points.push(p); }, lineTo(...p) { drawing.points.push(p); }, stroke() {}, fillText(text) { drawing.labels.push(text); } });
  el('preview').width = 1000; el('preview').height = 400;
  el('layout-file').files = [{ size: 2000, text: async () => JSON.stringify(layout) }];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input });
      if (url.endsWith('/fit-envelope')) {
        if (state.hold) await new Promise(resolve => { state.hold = resolve; });
        if (state.fail) return { ok: false, json: async () => ({ message: 'Fit unavailable' }) };
        try {
          const result = fitReferenceEnvelope(input);
          if (state.mismatch) { result.envelope_fit.parent_layout_sha256 = '0'.repeat(64); }
          return { ok: true, json: async () => result };
        } catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
      }
      return { ok: true, json: async () => composeReferenceLayout(input) };
    },
  });
  const event = { preventDefault() {} };
  return { el, blobs, revoked, calls, state, event, drawing,
    open: () => el('load-form').handlers.submit(event), fit: () => el('fit-envelope-form').handlers.submit(event),
    dimensions: values => ['x','y','z'].forEach((axis,i) => { el('fit-envelope-'+axis).value = String(values[i]); el('fit-envelope-'+axis).handlers.input(); }),
    click: id => el(id).handlers.click(),
    saved: async suffix => JSON.parse(await blobs.get(el('downloads').children.find(link => link.download.endsWith(suffix)).href).text()),
  };
}

test('preview changes canvas only; cancel, apply once, undo/redo and reopen retain editable original sources', async () => {
 const ui=harness(); await ui.fit(); assert.equal(ui.calls.length,0);
 await ui.open(); const original=await ui.saved('.layout.json');
 const initialPoints=JSON.stringify(ui.drawing.points);
 ui.dimensions([1,1,1]); await ui.fit();
 assert.notEqual(JSON.stringify(ui.drawing.points),initialPoints); assert.ok(ui.drawing.labels.some(text=>text.includes('FIT PREVIEW')));
 assert.equal(ui.el('fit-envelope-apply').disabled,false); assert.match(ui.el('fit-envelope-status').textContent,/PREVIEW ONLY/);
 assert.deepEqual(await ui.saved('.layout.json'),original);
 await ui.click('fit-envelope-cancel'); assert.equal(JSON.stringify(ui.drawing.points),initialPoints); assert.equal(ui.el('fit-envelope-apply').disabled,true); assert.deepEqual(await ui.saved('.layout.json'),original);
 await ui.fit(); await ui.click('fit-envelope-apply'); const fitted=await ui.saved('.layout.json');
 assert.notDeepEqual(fitted,original); assert.deepEqual(fitted.instances[0].source,original.instances[0].source);
 await ui.click('fit-envelope-apply'); assert.deepEqual(await ui.saved('.layout.json'),fitted); assert.match(ui.el('history-status').textContent,/1 undo/);
 await ui.click('layout-undo'); assert.deepEqual(await ui.saved('.layout.json'),original);
 await ui.click('layout-redo'); assert.deepEqual(await ui.saved('.layout.json'),fitted);
 ui.el('layout-file').files=[{size:5000,text:async()=>JSON.stringify(fitted)}]; await ui.open(); assert.deepEqual(await ui.saved('.layout.json'),fitted);
});
test('changing envelope, placement, selection or undo invalidates preview; failures preserve applied layout', async () => {
 const ui=harness(); await ui.open(); const original=await ui.saved('.layout.json'); ui.dimensions([1,1,1]);
 await ui.fit(); ui.dimensions([2,2,2]); await ui.click('fit-envelope-apply'); assert.deepEqual(await ui.saved('.layout.json'),original);
 await ui.fit(); ui.el('tx').handlers.input(); assert.equal(ui.el('fit-envelope-apply').disabled,true); const count=ui.calls.length; await ui.fit(); assert.equal(ui.calls.length,count);
 await ui.click('discard-placement'); await ui.fit(); ui.el('selected').value=layout.instances[1].id; ui.el('selected').handlers.change(); await ui.click('fit-envelope-apply'); assert.deepEqual(await ui.saved('.layout.json'),original);
 for (const mode of ['fail','mismatch']) {ui.state.fail=mode==='fail';ui.state.mismatch=mode==='mismatch';await ui.fit();assert.equal(ui.el('fit-envelope-apply').disabled,true);assert.deepEqual(await ui.saved('.layout.json'),original);assert.match(ui.el('status').textContent,/unavailable|does not match/);}
 ui.state.fail=false;ui.state.mismatch=false;ui.dimensions([0,1,1]);await ui.fit();assert.match(ui.el('status').textContent,/finite positive/);
});
test('pending preview suppresses repeated submit and ignores interrupted envelope changes', async () => {
 const ui=harness();await ui.open();const original=await ui.saved('.layout.json');ui.dimensions([1,1,1]);ui.state.hold=true;
 const pending=ui.fit(), count=ui.calls.length;await ui.fit();await ui.click('fit-envelope-apply');assert.equal(ui.calls.length,count);assert.equal(ui.el('fit-envelope-controls').disabled,true);
 ui.dimensions([2,2,2]);const release=ui.state.hold;ui.state.hold=null;release();await pending;
 assert.equal(ui.el('fit-envelope-apply').disabled,true);assert.deepEqual(await ui.saved('.layout.json'),original);
 await ui.fit();await ui.click('fit-envelope-apply');await ui.fit();await ui.click('layout-undo');assert.equal(ui.el('fit-envelope-apply').disabled,true);assert.deepEqual(await ui.saved('.layout.json'),original);
});
