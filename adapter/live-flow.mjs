// Separate opt-in v2 boundary. The legacy adapter and its pinned contracts are unchanged.
import { readFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { executeFlow, attestFlow } from './flow.mjs';
import { discoverBlender } from './blender.mjs';
import { canonicalJson } from './protocol.mjs';
import { OPERATION, INPUT, OUTPUT, ADAPTER, ATTESTOR, reject, validateRequest, validatePrimitivePlan } from './live-contract.mjs';
import { hash, stamp, scoped, bytesAt, jsonAt, maybeJson, immutable, artifactDigest, fileIdentity, verifyFiles } from './live-store.mjs';

const ROOT = '.moonsuite/products/moonmold/live-primitives-v1';
const eq = (a,b) => canonicalJson(a) === canonicalJson(b);
async function runtimeIdentity() {
  const b = discoverBlender();
  if (!b.available) reject('backend-unavailable','explicit Blender runtime unavailable');
  const executable = await realpath(b.executable);
  const h=createHash('sha256'); for await(const chunk of createReadStream(executable)) h.update(chunk);
  const sourceFiles=['flow.mjs','live-flow.mjs','live-contract.mjs','live-store.mjs','live-blender.mjs','blender.mjs','experiment.mjs','protocol.mjs','blender_bridge.py','../bin/moonmold.mjs','../bin/moonmold-live-flow.mjs','../pack.live-primitives-0.3.0.json','../adapters/moonmold-live-primitives-v1.declaration.json','../schemas/primitive-building-plan.schema.json','../schemas/primitive-building-result.schema.json'];
  const sourceIds=[]; for(const ref of sourceFiles) sourceIds.push(`${ref}|${hash(await readFile(new URL(ref,import.meta.url)))}`);
  return {executable, version:b.version, executable_digest:`sha256:${h.digest('hex')}`, fixed_bridge_digest:hash(await readFile(new URL('./blender_bridge.py',import.meta.url))), adapter_source_digest:hash(sourceIds.join('\n')), compatibility:'experimental-observed-runtime', documented_target:'Blender 4.5.11 LTS', documented_target_qualified:false};
}
async function context(o) {
  await scoped(o.workspace,o.resultRef); await scoped(o.workspace,o.draftRef);
  if (o.requestRef === o.resultRef || o.requestRef === o.draftRef || o.resultRef === o.draftRef) reject('invalid-flow-request','request, result and draft must be distinct');
  const requestBytes=await bytesAt(o.workspace,o.requestRef), r=validateRequest(JSON.parse(requestBytes));
  if (r.input_artifacts.includes(o.resultRef) || r.input_artifacts.includes(o.draftRef) || r.input_artifacts.includes(o.requestRef)) reject('invalid-flow-request','input/output paths overlap');
  if(await artifactDigest(o.workspace,r.input_artifacts) !== r.input_digest) reject('input-digest-mismatch','ordered input bytes changed');
  const plan=validatePrimitivePlan(await jsonAt(o.workspace,r.input_artifacts[0]));
  const stateRef=`${ROOT}/runs/${r.run_id}/${r.work_item_id}/${r.attempt_id}`;
  const binding={request_digest:hash(requestBytes),input_digest:r.input_digest,request_ref:o.requestRef,result_ref:o.resultRef,draft_ref:o.draftRef,operation:OPERATION,adapter_id:ADAPTER};
  const keyRef=`${ROOT}/keys/${hash(r.idempotency_key).slice(7)}.json`;
  const key={request_id:r.request_id,attempt_id:r.attempt_id,state_ref:stateRef,binding};
  return {r,plan,stateRef,binding,keyRef,key};
}
async function checkedTerminal(o,c) {
  const start=await maybeJson(o.workspace,`${c.stateRef}/started.json`);
  const key=await maybeJson(o.workspace,c.keyRef);
  if(start && !eq(start.binding,c.binding) || key && !eq(key,c.key)) reject('request-conflict','attempt or idempotency key is bound to different request bytes/routes');
  const terminal=await maybeJson(o.workspace,`${c.stateRef}/terminal.json`);
  if(!terminal) return {start,terminal:null};
  if(!start || !key || terminal.start_digest !== hash(await bytesAt(o.workspace,`${c.stateRef}/started.json`))) reject('attempt-conflict','terminal lacks its exact immutable start/key');
  await verifyFiles(o.workspace,terminal.files);
  const result=await jsonAt(o.workspace,o.resultRef);
  if(!eq(result,terminal.result)) reject('result-conflict','terminal result differs');
  if(result.status === 'succeeded' && result.output_digest !== await artifactDigest(o.workspace,[o.draftRef])) reject('result-conflict','draft set differs');
  return {start,terminal};
}
export async function reconcileLiveFlow(o) {
  const c=await context(o), {start,terminal}=await checkedTerminal(o,c);
  return {contract_id:'moonmold.live-reconciliation.v1',adapter_id:ADAPTER,request_id:c.r.request_id,attempt_id:c.r.attempt_id,decision:terminal ? (terminal.result.status === 'succeeded' ? 'completed' : 'failed') : start ? 'interrupted-or-running' : 'absent',retry_allowed:!start, result:terminal?.result ?? null, evidence_refs:start ? [`${c.stateRef}/started.json`,...(terminal ? [`${c.stateRef}/terminal.json`] : [])] : [], message:start && !terminal ? 'An effect may have started. No automatic retry or Blender rerun is permitted for this attempt.' : 'Verified exact request binding and every retained artifact.',recorded_at:stamp()};
}
async function checkHealth(o) {
  if(!o.healthRef) reject('health-required','an explicit verified experimental health source is required');
  const health=await jsonAt(o.workspace,o.healthRef), now=Date.now();
  if(health.contract_id !== 'moonflow.adapter-health.v1' || health.adapter_id !== ADAPTER || health.product_id !== 'moonmold' || health.pack_id !== 'moonmold' || health.pack_version !== '0.3.0' || health.protocol !== 'moonflow.adapter.v2' || health.status !== 'healthy' || !eq(health.operation_refs,[OPERATION]) || !Number.isFinite(Date.parse(health.checked_at)) || Date.parse(health.checked_at)>now || !(Date.parse(health.valid_until)>now) || Date.parse(health.valid_until)-Date.parse(health.checked_at)>600000) reject('invalid-health','health is stale or not bound to this operation');
  const bytes=await bytesAt(o.workspace,health.evidence_ref);
  if(hash(bytes) !== health.evidence_digest) reject('invalid-health','health evidence bytes changed');
  const e=JSON.parse(bytes), current=await runtimeIdentity();
  if(e.contract_id !== 'moonmold.primitive-runtime-observation.v1' || e.operation !== OPERATION || e.documented_target_qualified !== false || e.scope !== 'experimental-primitives-digital-only' || !eq(e.runtime,current)) reject('invalid-health','runtime or fixed product code differs from probe');
  const proof={workspace:o.workspace,...e.probe};
  const c=await context(proof), {start,terminal}=await checkedTerminal(proof,c);
  if(!start?.bootstrap_probe || terminal?.result.status !== 'succeeded' || !eq(start.runtime,current) || terminal.completed_at !== e.probe_completed_at || now-Date.parse(terminal.completed_at)>900000) reject('invalid-health','fresh completed bounded probe required');
  return current;
}
function resultFor(r,status,digest,artifacts,error='') {
  return {result_id:`result-${r.attempt_id}-${status}`,request_id:r.request_id,attempt_id:r.attempt_id,idempotency_key:r.idempotency_key,product_id:'moonmold',external_job_id:`moonmold-${r.attempt_id}`,status,output_digest:digest,output_artifacts:artifacts,error_kind:error,compensable:false,recorded_at:stamp(),trial_count:1};
}
async function execute(o,bootstrapProbe) {
  const c=await context(o), current=bootstrapProbe ? await runtimeIdentity() : await checkHealth(o);
  const outputRoot=`.moonsuite/products/moonmold/runs/primitive-${c.r.run_id}/${c.r.work_item_id}/${c.r.attempt_id}`;
  const fixedOutputs=['input-plan.json','model.blend','model.glb','model.stl','render.png','bridge-manifest.json','live-evidence.json'].map(ref=>`${outputRoot}/${ref}`);
  for(const ref of fixedOutputs) await scoped(o.workspace,ref);
  const prior=await checkedTerminal(o,c);
  if(prior.terminal) return prior.terminal.result;
  if(prior.start) reject('reconciliation-required','attempt may already have an effect; use reconcile, do not rerun');
  // The exclusive start is also the per-attempt lock. A crash is intentionally not retried.
  const start={contract_id:'moonmold.primitive-attempt.v1',binding:c.binding,runtime:current,bootstrap_probe:bootstrapProbe,started_at:stamp()};
  await immutable(o.workspace,`${c.stateRef}/started.json`,start,true);
  await immutable(o.workspace,c.keyRef,c.key);
  const inner={workspace:o.workspace,requestRef:`${c.stateRef}/native-request.json`,resultRef:`${c.stateRef}/native-result.json`,draftRef:`${c.stateRef}/native-draft.json`};
  let result, failure=null;
  const retained=[`${c.stateRef}/started.json`,c.keyRef];
  try {
    const legacy={...c.r,run_id:`primitive-${c.r.run_id}`,operation:'live-building',input_contracts:['moonmold-building-plan-v1'],output_contracts:['moonmold.live-building-result.v1']};
    await immutable(o.workspace,inner.requestRef,legacy);
    await executeFlow(inner);
    const native=await jsonAt(o.workspace,inner.draftRef);
    if(native.blender.version !== current.version || native.execution_provenance.fixed_bridge_digest !== current.fixed_bridge_digest) reject('runtime-drift','runtime changed during execution');
    // Narrow public names avoid implying physics or engineering/manufacturing qualification.
    const draft={contract_id:OUTPUT,product_id:'moonmold',operation:OPERATION,plan_id:native.plan_id,plan_ref:native.plan_ref,input_digest:c.r.input_digest,plan_digest:native.input_digest,live_evidence_ref:native.live_evidence_ref,editable_model_ref:native.editable_model_ref,digital_mesh_ref:native.engineering_model_ref,stl_candidate_ref:native.manufacturing_candidate_ref,presentation_ref:native.presentation_ref,verified_outputs:native.verified_outputs,object_count:native.object_count,bounds_meters:native.bounds_meters,runtime:current,execution_provenance:native.execution_provenance,claim_ceiling:'digital-artifact',physical_effects:false,simulation_evidence:false,manufacturing_authority:false,documented_target_qualified:false,preserved_unknowns:c.plan.unknowns};
    await immutable(o.workspace,o.draftRef,draft);
    result=resultFor(c.r,'succeeded',await artifactDigest(o.workspace,[o.draftRef]),[o.draftRef]);
    retained.push(inner.requestRef,inner.resultRef,inner.draftRef,o.draftRef,native.live_evidence_ref,...Object.values(native.verified_outputs).map(x=>x.reference));
    const root=native.live_evidence_ref.slice(0,-'live-evidence.json'.length);
    retained.push(`${root}input-plan.json`);
  } catch(error) {
    result=resultFor(c.r,'failed','',[],error.code ?? 'execution-error');
    failure={code:result.error_kind,message:String(error.message).slice(0,2048)};
    // Preserve and hash partial outputs without claiming completion or rerunning.
    for(const ref of [inner.requestRef,inner.resultRef,inner.draftRef,...fixedOutputs]) {
      try { await fileIdentity(o.workspace,ref); retained.push(ref); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    }
  }
  await immutable(o.workspace,o.resultRef,result); retained.push(o.resultRef);
  const files=[]; for(const ref of retained) files.push(await fileIdentity(o.workspace,ref));
  await immutable(o.workspace,`${c.stateRef}/terminal.json`,{contract_id:'moonmold.primitive-terminal.v1',start_digest:hash(await bytesAt(o.workspace,`${c.stateRef}/started.json`)),result,files,failure,completed_at:stamp()});
  return result;
}
export const executeLiveFlow = o => execute(o,false);
export const probeLiveFlow = o => execute(o,true);
export async function attestLiveFlow(o) {
  if(o.attestorId !== ATTESTOR) reject('invalid-attestor','distinct product-owned attestor required');
  const c=await context(o), {terminal}=await checkedTerminal(o,c);
  if(terminal?.result.status !== 'succeeded') reject('invalid-flow-result','completed success required');
  // Product evidence verification reuses the existing product attestor, after all bytes are rehashed.
  await attestFlow({workspace:o.workspace,requestRef:`${c.stateRef}/native-request.json`,resultRef:`${c.stateRef}/native-result.json`,draftRef:`${c.stateRef}/native-draft.json`,attestationRef:`${c.stateRef}/native-attestation.json`,attestorId:ATTESTOR,finalRef:`${c.stateRef}/native-final.json`});
  const draft=await jsonAt(o.workspace,o.draftRef);
  if(draft.contract_id !== OUTPUT || draft.operation !== OPERATION || draft.physical_effects !== false || draft.simulation_evidence !== false || draft.manufacturing_authority !== false || draft.documented_target_qualified !== false || !eq(draft.preserved_unknowns,c.plan.unknowns)) reject('invalid-flow-result','claim or unknowns changed');
  if([o.requestRef,o.resultRef,o.draftRef,...c.r.input_artifacts].includes(o.finalRef) || o.attestationRef === o.finalRef) reject('invalid-flow-result','distinct final and attestation references required');
  await immutable(o.workspace,o.finalRef,draft);
  const a={contract_id:'moonflow.product-attestation.v1',attestor_id:ATTESTOR,product_id:'moonmold',request_id:c.r.request_id,result_id:terminal.result.result_id,output_digest:terminal.result.output_digest,accepted:true,native_final_artifact:o.finalRef,operation:OPERATION};
  await immutable(o.workspace,o.attestationRef,a);
  return a;
}
export async function observeLiveHealth(o) {
  const c=await context(o), {start,terminal}=await checkedTerminal(o,c), current=await runtimeIdentity();
  if(!start?.bootstrap_probe || terminal?.result.status !== 'succeeded' || !eq(current,start.runtime) || Date.now()-Date.parse(terminal.completed_at)>900000) reject('probe-required','health requires this runtime and a fresh completed bounded probe');
  const evidence={contract_id:'moonmold.primitive-runtime-observation.v1',operation:OPERATION,scope:'experimental-primitives-digital-only',documented_target_qualified:false,runtime:current,probe:{requestRef:o.requestRef,resultRef:o.resultRef,draftRef:o.draftRef},probe_completed_at:terminal.completed_at,checked_at:stamp()};
  const bytes=await immutable(o.workspace,o.evidenceRef,evidence);
  const health={contract_id:'moonflow.adapter-health.v1',adapter_id:ADAPTER,product_id:'moonmold',pack_id:'moonmold',pack_version:'0.3.0',protocol:'moonflow.adapter.v2',status:'healthy',checked_at:evidence.checked_at,valid_until:new Date(Date.parse(evidence.checked_at)+600000).toISOString().replace('.000Z','Z'),operation_refs:[OPERATION],evidence_ref:o.evidenceRef,evidence_digest:hash(bytes)};
  await immutable(o.workspace,o.healthRef,health); return health;
}
