import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateRequest, validatePrimitivePlan, OPERATION } from './live-contract.mjs';
const root=new URL('../fixtures/',import.meta.url);
const request=JSON.parse(await readFile(new URL('primitive-flow-request.json',root)));
const plan=JSON.parse(await readFile(new URL('primitive-pair.json',root)));
const mutate=(base,fn)=>{const value=structuredClone(base);fn(value);return value;};
test('exact version, schemas and least digital authority are required',()=>{
  assert.equal(validateRequest(request).operation,OPERATION);
  for(const fn of [r=>r.operation='live-building',r=>r.operation='moonmold/primitive.build@0.2.0',r=>r.operation='moonmold/spatial.operation.execute@0.2.0',r=>r.requested_authority='physical-effect',r=>r.requested_authority='observe',r=>r.required_claim='physical-effect',r=>r.output_contracts.push('extra'),r=>r.input_contracts=['moonmold-building-plan-v1'],r=>r.run_id='../escape',r=>r.attempt_id='bad/name',r=>r.input_digest='sha256:fake',r=>r.timeout_ms=120001,r=>r.created_at='2026-02-31T00:00:00Z',r=>r.python='print(1)',r=>r.input_artifacts.push('inputs/other.json')]) assert.throws(()=>validateRequest(mutate(request,fn)));
});
test('bounded exact primitive plan preserves explicit unknowns and excludes richer intent',()=>{
  assert.equal(validatePrimitivePlan(plan),plan);
  for(const fn of [p=>p.units='m',p=>p.coordinateFrame='y-up',p=>p.unknowns=[],p=>p.components[0].kind='arch',p=>p.components[0].dimensions.widthMm=-1,p=>p.components[0].dimensions.widthMm=1000001,p=>p.components[0].position.xMm=Infinity,p=>p.components[1].dimensions.sides=257,p=>p.components[1].id=p.components[0].id,p=>p.components[0].pythonScript='malicious',p=>p.referenceBundle={imageRef:'https://example.invalid'},p=>p.referenceProvenance=[{source:'https://example.invalid'}],p=>p.components=Array(33).fill(p.components[0]),p=>p.components=[p.components[0]],p=>p.physical_effects=true]) assert.throws(()=>validatePrimitivePlan(mutate(plan,fn)));
});
test('legacy pinned pack and declaration remain0.2.0 while opt-in version is separate',async()=>{
  const original=JSON.parse(await readFile(new URL('../pack.json',import.meta.url)));
  const live=JSON.parse(await readFile(new URL('../pack.live-primitives-0.3.0.json',import.meta.url)));
  const legacy=JSON.parse(await readFile(new URL('../adapters/moonmold-pack-local-v1.declaration.json',import.meta.url)));
  assert.equal(original.version,'0.2.0'); assert.equal(legacy.pack_version,'0.2.0'); assert.equal(live.version,'0.3.0');
  assert.deepEqual(live.tools.map(x=>x.id),['primitive.build']);
  assert.ok(original.tools.some(x=>x.id==='spatial.operation.execute'));
});
