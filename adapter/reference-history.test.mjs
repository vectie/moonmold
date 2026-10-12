import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { composeReferenceLayout } from './reference-layout.mjs';
import { replaceReferenceSources } from './reference-replacement.mjs';
import { cutReferenceLayout } from './reference-cut.mjs';
import { drawReferenceLayout } from './reference-drawing.mjs';
import { drawReferenceDimensions } from './reference-dimensions.mjs';
import { exportReferenceLayoutGlb } from './reference-glb.mjs';
import { measureReferenceLayout } from './reference-measurement.mjs';
import { sectionReferenceLayout } from './reference-layout-section.mjs';
import { createOperatorServer } from './operator-server.mjs';

const html = await readFile(new URL('../ui/reference-layout/index.html', import.meta.url), 'utf8');
const seed = JSON.parse(await readFile(new URL('../fixtures/reference-measurement.layout.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const single = { ...clone(seed), instances: [clone(seed.instances[0])] };
const event = { preventDefault() {} };

function harness({ page = html, transport } = {}) {
 const elements = new Map(), blobs = new Map(), revoked = [], calls = [];
 let serial = 0, failure = false, mismatch = false, hold = false, release;
 function el(id) {
  if (!elements.has(id)) elements.set(id, { value: '0', checked: false, disabled: false, textContent: '', children: [], handlers: {}, files: [],
   addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); },
   removeAttribute(name) { delete this[name]; }, get selectedOptions() { return this.children.filter(c => c.selected); } });
  return elements.get(id);
 }
 el('preview').width = 1000; el('preview').height = 400;
 el('preview').getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} });
 for (const id of ['layout-undo','layout-redo','discard-placement']) el(id).disabled = true;
 const productionFetch = async (url, options) => {
  const input = JSON.parse(options.body); calls.push({ url, input });
  if (hold) await new Promise(resolve => { release = resolve; });
  if (failure) return { ok: false, json: async () => ({ message: 'Composition temporarily unavailable' }) };
  if (transport) return transport(url, options);
  try {
   if (url.endsWith('/glb')) return { ok: true, arrayBuffer: async () => exportReferenceLayoutGlb(input) };
   let next;
   if (url.endsWith('/replace-source')) next = replaceReferenceSources(input);
   else if (url.endsWith('/cut')) next = cutReferenceLayout(input);
   else if (url.endsWith('/measure')) next = measureReferenceLayout(input);
   else if (url.endsWith('/dimension-drawing')) next = drawReferenceDimensions(input);
   else if (url.endsWith('/drawing')) next = drawReferenceLayout(input);
   else if (url.endsWith('/section')) next = sectionReferenceLayout(input.layout, input.plane);
   else { assert.equal(url, '/api/reference-layout/compose'); next = composeReferenceLayout(input); }
   if (mismatch) next.layout = { ...next.layout, name: 'wrong-layout-with-copied-hashes' };
   return { ok: true, json: async () => next };
  } catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
 };
 runInNewContext(page.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
  document: { getElementById: el, createElement: () => ({}), createTextNode: text => ({ textContent: text }) }, Blob, TextDecoder,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
  fetch: productionFetch,
 });
 const fire = (id, type = 'click') => el(id).handlers[type](event);
 const file = (name, data) => { const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)); return { name, size: bytes.length, text: async () => bytes.toString(), arrayBuffer: async () => Uint8Array.from(bytes).buffer }; };
 const load = async (layout = seed) => { el('layout-file').files = [file('saved.layout.json',layout)]; await fire('load-form','submit'); };
 const output = async suffix => { const a = el('downloads').children.find(c => c.download.endsWith(suffix)); assert.ok(a, `Missing ${suffix}: ${el('status').textContent}`); return blobs.get(a.href).text(); };
 return { el, blobs, revoked, calls, fire, file, load, output,
  saved: async () => JSON.parse(await output('.layout.json')),
  report: async () => JSON.parse(await output('.report.json')),
  edit: async (id, value) => { el(id).value = String(value); await fire(id,'input'); await fire('edit-form','submit'); },
  failure(value) { failure = value; }, mismatch(value) { mismatch = value; },
  hold() { hold = true; }, release() { hold = false; release(); },
 };
}
const history = h => h.el('history-status').textContent.match(/^(\d+) undo · (\d+) redo/).slice(1).map(Number);
const assertLayout = async (h, expected) => {
 const normalized = composeReferenceLayout(expected), report = await h.report();
 assert.deepEqual(await h.saved(), normalized.layout);
 assert.equal(report.layout_sha256, normalized.layout_sha256); assert.equal(report.geometry_sha256, normalized.geometry_sha256);
 assert.equal(await h.output('.obj'), normalized.exports.obj); assert.equal(await h.output('.stl'), normalized.exports.stl);
};

test('actual workbench handlers undo and redo placement, duplication and removal with exact exports and selection', async () => {
 const h = harness(); await h.load(); const baseline = await h.saved(); assert.deepEqual(history(h), [0,0]);
 h.el('selected').value = baseline.instances[1].id; await h.fire('selected','change');
 await h.edit('tx',43); const placed = await h.saved(), chosen = h.el('selected').value;
 await h.fire('duplicate'); const duplicate = await h.saved(), duplicateId = h.el('selected').value;
 await h.fire('remove'); const removed = await h.saved(); assert.deepEqual(history(h),[3,0]);
 await h.fire('layout-undo'); await assertLayout(h,duplicate); assert.equal(h.el('selected').value,duplicateId);
 await h.fire('layout-undo'); await assertLayout(h,placed); assert.equal(h.el('selected').value,chosen);
 await h.fire('layout-undo'); await assertLayout(h,baseline); assert.equal(h.el('selected').value,chosen); assert.equal(h.el('layout-undo').disabled,true);
 await h.fire('layout-redo'); await assertLayout(h,placed);
 await h.fire('layout-redo'); await assertLayout(h,duplicate);
 await h.fire('layout-redo'); await assertLayout(h,removed); assert.equal(h.el('layout-redo').disabled,true);
 assert.deepEqual(seed,JSON.parse(await readFile(new URL('../fixtures/reference-measurement.layout.json', import.meta.url),'utf8')));
});

test('remove the final reference, undo to exact source, redo empty, and undo an initial add', async () => {
 const h = harness(); await h.load(single); const initial = await h.saved(), oldLinks = h.el('downloads').children.map(a=>a.href);
 await h.fire('remove'); assert.equal(h.el('downloads').children.length,0); assert.equal(h.el('edit-controls').disabled,true); assert.equal(h.el('layout-undo').disabled,false);
 assert.ok(oldLinks.every(url=>h.revoked.includes(url)));
 await h.fire('layout-undo'); await assertLayout(h,initial); assert.equal(h.el('edit-controls').disabled,false);
 const calls = h.calls.length; await h.fire('layout-redo'); assert.equal(h.calls.length,calls); assert.equal(h.el('downloads').children.length,0);
 assert.equal(h.el('glb-export').disabled,true); assert.equal(h.el('drawing-export').disabled,true);
 const fresh = harness(); fresh.el('mesh-file').files = [fresh.file('triangle.obj',single.instances[0].source.text)]; fresh.el('source-units').value = 'mm';
 await fresh.fire('add-form','submit'); const added = await fresh.saved(); await fresh.fire('layout-undo'); assert.equal(fresh.el('downloads').children.length,0);
 await fresh.fire('layout-redo'); await assertLayout(fresh,added);
});

test('source replacement restores original embedded bytes and reports fresh composition rather than old mutation receipts', async () => {
 const h = harness(); await h.load(single); const initial = await h.saved();
 const revision = initial.instances[0].source.text+'# retained revised source\n';
 h.el('replace-file').files=[h.file('revised.obj',revision)]; h.el('replace-units').value='cm';
 await h.fire('replace-form','submit'); const changed = await h.saved(); assert.equal((await h.report()).replacement.instance_ids.length,1);
 await h.fire('layout-undo'); await assertLayout(h,initial); assert.equal((await h.report()).replacement,undefined);
 await h.fire('layout-redo'); await assertLayout(h,changed); assert.equal((await h.saved()).instances[0].source.text,revision); assert.equal((await h.report()).replacement,undefined);
});

test('surface-cut history retains the embedded original recipe and restores its revise-cut control', async () => {
 const h=harness(); await h.load(single); const original=await h.saved();
 h.el('cut-axis').value='x'; h.el('cut-position').value='1'; h.el('cut-keep').value='positive';
 await h.fire('cut-form','submit'); const cut=await h.saved(), recipe=await h.output('.cut.json'); assert.equal(h.el('cut-restore').disabled,false);
 await h.edit('tx',7); assert.equal(h.el('cut-restore').disabled,true);
 await h.fire('layout-undo'); await assertLayout(h,cut); assert.equal(await h.output('.cut.json'),recipe); assert.equal(h.el('cut-restore').disabled,false);
 await h.fire('layout-undo'); await assertLayout(h,original); assert.equal(h.el('cut-restore').disabled,true);
 await h.fire('layout-redo'); await assertLayout(h,cut); assert.equal(await h.output('.cut.json'),recipe);
 await h.fire('cut-restore'); await assertLayout(h,original); assert.equal(h.el('layout-redo').disabled,true);
});

test('failed or mismatched restoration preserves applied outputs and both stacks; pending repeats issue one request', async () => {
 const h=harness(); await h.load(); await h.edit('tx',10); const edited=await h.saved();
 for(const mode of ['failure','mismatch']) {
  const links=h.el('downloads').children; h[mode](true); await h.fire('layout-undo'); h[mode](false);
  assert.equal(h.el('downloads').children,links); await assertLayout(h,edited); assert.deepEqual(history(h),[1,0]);
  assert.match(h.el('status').textContent,/unavailable|does not match/);
 }
 h.hold(); const pending=h.fire('layout-undo'), count=h.calls.length;
 assert.equal(h.el('layout-undo').disabled,true); assert.equal(h.el('layout-redo').disabled,true);
 await h.fire('layout-undo'); await h.fire('layout-redo'); await h.fire('duplicate'); assert.equal(h.calls.length,count);
 h.release(); await pending; await assertLayout(h,seed); assert.deepEqual(history(h),[0,1]);
});

test('unapplied fields gate history until explicitly applied or discarded; failed new edits retain redo', async () => {
 const h=harness(); await h.load(); await h.edit('tx',10); await h.fire('layout-undo');
 h.el('tx').value='12'; await h.fire('tx','input'); const count=h.calls.length;
 await h.fire('layout-redo'); assert.equal(h.calls.length,count); assert.equal(h.el('discard-placement').disabled,false); assert.deepEqual(history(h),[0,1]);
 await h.fire('discard-placement'); assert.equal(h.el('tx').value,String(composeReferenceLayout(seed).layout.instances[0].transform.translation_mm[0])); assert.deepEqual(history(h),[0,1]);
 await h.edit('scale',-1); assert.match(h.el('status').textContent,/scale|Scale/); assert.deepEqual(history(h),[0,1]); assert.equal(h.el('layout-redo').disabled,true);
 await h.fire('discard-placement'); await h.fire('layout-redo'); assert.equal((await h.saved()).instances[0].transform.translation_mm[0],10);
});

test('identical applied placements preserve redo, successful new edits branch it, and failed opens preserve history', async () => {
 const h=harness(); await h.load(); await h.edit('tx',10); await h.fire('layout-undo');
 await h.fire('edit-form','submit'); assert.deepEqual(history(h),[0,1]);
 h.el('layout-file').files=[h.file('broken.json','{broken')]; await h.fire('load-form','submit'); assert.deepEqual(history(h),[0,1]);
 await h.edit('tx',20); assert.deepEqual(history(h),[1,0]); assert.equal(h.el('layout-redo').disabled,true);
 await h.load(single); assert.deepEqual(history(h),[0,0]); await assertLayout(h,single);
});

test('restoration clears old measurement, named dimensions, drawing, section and GLB object URLs', async () => {
 const h=harness(); await h.load(single); await h.edit('tx',10);
 for(const side of ['a','b']) {h.el(`measure-${side}-instance`).value=single.instances[0].id; h.el(`measure-${side}-vertex`).value=side==='a'?'0':'1';}
 await h.fire('measure-form','submit'); h.el('dimension-name').value='Diagonal'; await h.fire('dimension-add'); await h.fire('dimension-export');
 await h.fire('drawing-export'); await h.fire('glb-export'); h.el('section-axis').value='x'; h.el('section-position').value='11'; await h.fire('section-form','submit');
 const containers=['measure-download','dimension-save','dimension-download','drawing-download','glb-download','section-downloads'];
 const old=[]; for(const id of containers) { assert.ok(h.el(id).children.length,id+': '+h.el('status').textContent); old.push(...h.el(id).children.map(a=>a.href).filter(Boolean)); }
 await h.fire('layout-undo'); await assertLayout(h,single);
 for(const id of containers) assert.equal(h.el(id).children.length,0,id);
 assert.ok(old.every(url=>h.revoked.includes(url))); assert.equal(h.el('measure-a-vertex').value,''); assert.equal(h.el('section-preview').hidden,true); assert.equal(h.el('dimension-export').disabled,true);
});

test('session retains at most twenty applied states, with contiguous nearest undo and redo', async () => {
 const h=harness(); await h.load(single);
 for(let x=1;x<=23;x++) await h.edit('tx',x);
 assert.deepEqual(history(h),[20,0]); assert.match(h.el('history-status').textContent,/limit reached/);
 for(let x=22;x>=3;x--) {await h.fire('layout-undo'); assert.equal((await h.saved()).instances[0].transform.translation_mm[0],x);}
 assert.equal(h.el('layout-undo').disabled,true); assert.deepEqual(history(h),[0,20]);
 for(let x=4;x<=23;x++) {await h.fire('layout-redo'); assert.equal((await h.saved()).instances[0].transform.translation_mm[0],x);}
});

test('large embedded sources are bounded by retained UTF-16 snapshot text, without limiting current valid layout', async () => {
 const large=clone(single); large.instances=Array.from({length:4},(_,i)=>({...clone(single.instances[0]),id:`large-${i}`}));
 for(const item of large.instances) item.source.text += '#'+ 'x'.repeat(310000)+'\n';
 const h=harness(); await h.load(large); for(let x=1;x<=9;x++) await h.edit('tx',x);
 const [undos,redos]=history(h); assert.ok(undos>0 && undos<9); assert.equal(redos,0); assert.match(h.el('history-status').textContent,/limit reached/);
 for(let n=0;n<undos;n++) await h.fire('layout-undo'); assert.equal(h.el('layout-undo').disabled,true);
 const retainedText=(await h.output('.layout.json')).length*2; assert.ok(retainedText*undos<17*1024*1024);
 assert.equal((await h.saved()).instances[0].source.text,large.instances[0].source.text);
});

test('new page sessions have no history and do not restore source bytes from storage', async () => {
 const first=harness(); await first.load(); await first.edit('tx',7); assert.deepEqual(history(first),[1,0]);
 const second=harness(); assert.equal(second.el('layout-undo').disabled,true); assert.equal(second.el('downloads').children.length,0); assert.equal(second.calls.length,0);
 await second.load(await first.saved()); assert.deepEqual(history(second),[0,0]); assert.equal((await second.saved()).instances[0].transform.translation_mm[0],7);
});

test('served production page performs exact undo/redo through real loopback composer without a browser', async t => {
 const workspace=await mkdtemp(path.join(tmpdir(),'moonmold-history-'));
 const server=createOperatorServer({workspaceRoot:workspace}); await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve)); await rm(workspace,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`, page=await(await fetch(base+'/reference-layout')).text();
 assert.match(page,/Undo layout change/); const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:page.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8'}); assert.equal(syntax.status,0,syntax.stderr);
 const h=harness({page,transport:(url,options)=>fetch(base+url,options)}); await h.load(); await h.edit('tx',52); const edited=await h.saved();
 await h.fire('layout-undo'); await assertLayout(h,seed); await h.fire('layout-redo'); await assertLayout(h,edited);
 assert.deepEqual(h.calls.map(c=>c.url),Array(4).fill('/api/reference-layout/compose'));
});
