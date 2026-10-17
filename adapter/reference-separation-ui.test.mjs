import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceSeparation } from './reference-separation.mjs';

const layout = JSON.parse(await readFile(new URL('../fixtures/reference-separation.layout.json',import.meta.url),'utf8'));
const html = await readFile(new URL('../ui/reference-layout/index.html',import.meta.url),'utf8');
function harness() {
  const elements = new Map(), blobs = new Map(), calls = [], revoked = [], drawn = [];
  const state = { hold:null, fail:false, mismatch:false }; let serial = 0;
  function el(id) {
    if (!elements.has(id)) elements.set(id,{ value:'0',checked:false,disabled:false,textContent:'',children:[],handlers:{},
      addEventListener(type,fn) { this.handlers[type] = fn; },replaceChildren() { this.children=[]; },append(...children) { this.children.push(...children); },
      get selectedOptions() { return this.children.filter(c => c.selected); } });
    return elements.get(id);
  }
  el('preview').getContext = () => ({ clearRect() { drawn.length=0; },beginPath() {},moveTo() {},lineTo() {},stroke() {},fillText(text) { drawn.push(text); } });
  el('preview').width=1000; el('preview').height=400;
  el('layout-file').files=[{ size:1000,text:async () => JSON.stringify(layout) }];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{ getElementById:el,createElement:() => ({}),createTextNode:text => ({ textContent:text }) },Blob,
    URL:{ createObjectURL(blob) { const url=`blob:${++serial}`; blobs.set(url,blob); return url; },revokeObjectURL(url) { revoked.push(url); } },
    fetch:async (url,options) => {
      const input=JSON.parse(options.body); calls.push({ url,input });
      if (url.endsWith('/separation')) {
        if (state.hold) await new Promise(resolve => { state.hold=resolve; });
        if (state.fail) return { ok:false,json:async () => ({ message:'Separation unavailable' }) };
        const report=measureReferenceSeparation(input);
        if (state.mismatch === 'identity') report.layout_sha256='0'.repeat(64);
        if (state.mismatch === 'selection') report.instance_a='crossing';
        if (state.mismatch === 'point') report.witness_a.coordinates_mm=[null,0,0];
        return { ok:true,json:async () => report };
      }
      return { ok:true,json:async () => composeReferenceLayout(input) };
    },
  });
  const event={ preventDefault() {} };
  return { el,blobs,calls,revoked,drawn,state,event,
    open:() => el('load-form').handlers.submit(event),calculate:() => el('separation-form').handlers.submit(event),
    choose(a='base',b='raised') { el('separation-a').value=a; el('separation-b').value=b; el('separation-a').handlers.change(); },
    links:() => el('separation-download').children,
  };
}

test('production workbench opens, calculates interior witnesses, draws, exports, edits, saves and reopens',async () => {
  const ui=harness(); await ui.open(); ui.choose(); await ui.calculate();
  assert.match(ui.el('separation-status').textContent,/Nearest triangle-surface gap: 5 mm/);
  assert.ok(ui.drawn.includes('Gap A')); assert.ok(ui.drawn.includes('Gap B'));
  const old=ui.links()[0].href, report=JSON.parse(await ui.blobs.get(old).text());
  assert.equal(report.distance_mm,5); assert.equal(ui.links()[0].download,'surface-gap-study.surface-separation.json');
  ui.el('top').handlers.click(); assert.equal(ui.links()[0].href,old); assert.ok(ui.drawn.includes('Gap A'));
  ui.el('tz').value='2'; ui.el('tz').handlers.input();
  assert.equal(ui.links().length,0); assert.ok(ui.revoked.includes(old)); assert.equal(ui.el('separation-controls').disabled,true);
  await ui.el('edit-form').handlers.submit(ui.event); assert.equal(ui.el('separation-a').value,'');
  ui.choose(); await ui.calculate(); assert.match(ui.el('separation-status').textContent,/gap: 3 mm/);
  const savedLink=ui.el('downloads').children.find(link => link.download.endsWith('.layout.json'));
  const saved=JSON.parse(await ui.blobs.get(savedLink.href).text());
  assert.equal(saved.instances[0].source.text,layout.instances[0].source.text);
  assert.equal(saved.instances[0].transform.translation_mm[2],2);
  await ui.open(); ui.choose('base','crossing'); await ui.calculate(); assert.match(ui.el('separation-status').textContent,/gap: 0 mm/);
});

test('invalid selection does not send, failure retains same-input report, and malformed replies do not replace it',async () => {
  const ui=harness(); await ui.calculate(); assert.equal(ui.calls.length,0); await ui.open();
  ui.choose('base','base'); const before=ui.calls.length; await ui.calculate(); assert.equal(ui.calls.length,before);
  ui.choose(); await ui.calculate(); const good=ui.links()[0].href;
  ui.state.fail=true; await ui.calculate(); assert.equal(ui.links()[0].href,good); assert.match(ui.el('status').textContent,/Separation unavailable/);
  ui.state.fail=false;
  for (const mode of ['identity','selection','point']) { ui.state.mismatch=mode; await ui.calculate(); assert.equal(ui.links()[0].href,good); assert.match(ui.el('status').textContent,/does not match/); }
});

test('changed selection or placement fields invalidate a pending reply; repeated clicks do not dispatch',async () => {
  const ui=harness(); await ui.open(); ui.choose(); await ui.calculate();
  ui.state.hold=true; const pending=ui.calculate(), count=ui.calls.length;
  await ui.calculate(); assert.equal(ui.calls.length,count); assert.equal(ui.el('separation-controls').disabled,true);
  ui.choose('base','crossing'); const release=ui.state.hold; ui.state.hold=null; release(); await pending;
  assert.equal(ui.links().length,0); assert.equal(ui.el('separation-controls').disabled,false);
  ui.choose(); ui.state.hold=true; const next=ui.calculate();
  ui.el('tz').value='2'; ui.el('tz').handlers.input();
  const releaseNext=ui.state.hold; ui.state.hold=null; releaseNext(); await next;
  assert.equal(ui.links().length,0); assert.equal(ui.el('separation-controls').disabled,true);
  ui.el('discard-placement').handlers.click(); await ui.calculate(); assert.match(ui.el('separation-status').textContent,/gap: 5 mm/);
});

test('history, removal and reopening clear derived witnesses without losing source workflow',async () => {
  const ui=harness(); await ui.open(); ui.choose(); await ui.calculate(); const old=ui.links()[0].href;
  await ui.el('remove').handlers.click(); assert.equal(ui.links().length,0); assert.ok(ui.revoked.includes(old));
  await ui.el('layout-undo').handlers.click(); assert.equal(ui.links().length,0); ui.choose(); await ui.calculate(); assert.match(ui.el('separation-status').textContent,/gap: 5 mm/);
  await ui.el('remove').handlers.click(); await ui.el('remove').handlers.click(); assert.equal(ui.el('separation-controls').disabled,true);
  await ui.el('remove').handlers.click(); assert.equal(ui.links().length,0); assert.equal(ui.el('separation-a').children.length,1);
  await ui.open(); ui.choose(); await ui.calculate(); assert.match(ui.el('separation-status').textContent,/gap: 5 mm/);
});
