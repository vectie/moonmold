import { AdapterRejection } from './protocol.mjs';
export const OPERATION = 'moonmold/primitive.build@0.3.0';
export const INPUT = 'moonmold/primitive-building-plan@1.0.0';
export const OUTPUT = 'moonmold/primitive-building-result@1.0.0';
export const ADAPTER = 'moonmold-live-primitives-v1';
export const ATTESTOR = 'moonmold-live-primitives-attestor-v1';
export const reject = (code, message) => { throw new AdapterRejection(code, message); };
export function identifier(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) reject('invalid-identity', field);
}
const exact = (obj, required, optional = []) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || required.some(k => !(k in obj)) || Object.keys(obj).some(k => ![...required, ...optional].includes(k))) reject('invalid-schema', 'missing or unsupported properties');
};
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const texts = (v, min, max = 64) => Array.isArray(v) && v.length >= min && v.length <= max && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= 2048);
const utc = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace('.000Z','Z') === v;
export function validateRequest(r) {
  exact(r, ['request_id','run_id','book_id','work_item_id','declaration_id','attempt_id','idempotency_key','product_id','operation','requested_authority','acceptance_criteria','input_contracts','output_contracts','required_claim','input_digest','input_artifacts','timeout_ms','created_at']);
  for (const k of ['request_id','run_id','book_id','work_item_id','declaration_id','attempt_id']) identifier(r[k], k);
  if (typeof r.idempotency_key !== 'string' || r.idempotency_key.length > 1024 || !/^[\x21-\x7e]+$/.test(r.idempotency_key)) reject('invalid-identity','idempotency_key');
  if (r.product_id !== 'moonmold' || r.operation !== OPERATION || r.requested_authority !== 'workspace-mutation' || r.required_claim !== 'digital-artifact') reject('invalid-flow-contract','operation, authority or claim mismatch');
  if (JSON.stringify(r.input_contracts) !== JSON.stringify([INPUT]) || JSON.stringify(r.output_contracts) !== JSON.stringify([OUTPUT])) reject('invalid-flow-contract','schema mismatch');
  if (!texts(r.acceptance_criteria,1) || !texts(r.input_artifacts,1,1) || !/^sha256:[a-f0-9]{64}$/.test(r.input_digest) || !Number.isSafeInteger(r.timeout_ms) || r.timeout_ms < 1 || r.timeout_ms > 120000 || !utc(r.created_at)) reject('invalid-flow-request','invalid inputs, deadline or timestamp');
  return r;
}
export function validatePrimitivePlan(p) {
  exact(p,['schema','id','units','coordinateFrame','recordedAt','scaleEvidence','referenceProvenance','unknowns','components']);
  identifier(p.id,'plan.id');
  if (p.schema !== 'moonmold-building-plan-v1' || p.units !== 'mm' || p.coordinateFrame !== 'z-up-right-handed' || !utc(p.recordedAt)) reject('invalid-plan','explicit mm/z-up plan required');
  exact(p.scaleEvidence,['source','valueMm','confidence']);
  if (!texts([p.scaleEvidence.source,p.scaleEvidence.confidence],2) || !finite(p.scaleEvidence.valueMm,0.001,1000000)) reject('invalid-plan','bounded explicit scale required');
  // Reference intake is deliberately out of this narrow primitive contract.
  if (!Array.isArray(p.referenceProvenance) || p.referenceProvenance.length !== 0 || !texts(p.unknowns,1) || !Array.isArray(p.components) || p.components.length < 2 || p.components.length > 32) reject('invalid-plan','2..32 primitives, explicit unknowns and no external reference intake required');
  const ids = new Set();
  for (const c of p.components) {
    exact(c,['id','kind','dimensions','position','materialId']);
    identifier(c.id,'component.id'); identifier(c.materialId,'materialId');
    if (ids.has(c.id)) reject('invalid-plan','duplicate component id'); ids.add(c.id);
    if (!['box','cylinder'].includes(c.kind)) reject('unsupported-primitive','boxes and cylinders only');
    exact(c.position,['xMm','yMm','zMm']);
    if (!Object.values(c.position).every(x => finite(x,-1000000,1000000))) reject('invalid-plan','bounded position required');
    exact(c.dimensions,c.kind === 'box' ? ['widthMm','depthMm','heightMm'] : ['radiusMm','heightMm','sides']);
    for (const [key, v] of Object.entries(c.dimensions)) {
      if (key === 'sides' ? !Number.isInteger(v) || v < 8 || v > 256 : !finite(v,0.001,1000000)) reject('invalid-plan','bounded dimensions required');
    }
  }
  return p;
}
