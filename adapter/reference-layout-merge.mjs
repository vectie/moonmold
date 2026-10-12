import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-layout-merge', message); };

// Reuse a saved arrangement without flattening it into a derived mesh. A common
// world translation preserves relative placement, including center/ground recipes.
export function mergeReferenceLayouts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['layout', 'incoming_layout', 'id_prefix', 'translation_mm'].includes(key))) {
    reject('Expected layout, incoming_layout, id_prefix and translation_mm');
  }
  const prefix = input.id_prefix, offset = input.translation_mm;
  if (typeof prefix !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,78}$/.test(prefix)) reject('id_prefix needs 1–79 alphanumeric, dot, dash or underscore characters, starting alphanumeric');
  if (!Array.isArray(offset) || offset.length !== 3 || offset.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9)) reject('translation_mm needs three finite world-axis millimetre values within ±1e9');
  const before = composeReferenceLayout(input.layout);
  const incoming = composeReferenceLayout(input.incoming_layout);
  if (before.instance_count + incoming.instance_count > 16) reject('Merged layout would exceed 16 instances');
  const candidate = structuredClone(before.layout), ids = new Set(candidate.instances.map(item => item.id));
  const mappings = [];
  for (const item of incoming.layout.instances) {
    const id = `${prefix}.${item.id}`;
    if (id.length > 80) reject(`Prefixed instance ID exceeds 80 characters: ${id}`);
    if (ids.has(id)) reject(`Instance ID already exists: ${id}; choose another id_prefix`);
    ids.add(id);
    const added = structuredClone(item);
    added.id = id;
    added.transform.translation_mm = added.transform.translation_mm.map((n, axis) => n + offset[axis]);
    candidate.instances.push(added);
    mappings.push({ incoming_instance_id: item.id, instance_id: id,
      before_translation_mm: [...item.transform.translation_mm],
      after_translation_mm: [...added.transform.translation_mm] });
  }
  // Existing composition enforces total source/geometry size, coordinate limits
  // and saved-document round-trippability before any result can be applied.
  const after = composeReferenceLayout(candidate);
  after.merge = {
    contract_id: 'moonmold.reference-layout-merge.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    incoming_layout_sha256: incoming.layout_sha256, incoming_geometry_sha256: incoming.geometry_sha256,
    incoming_name: incoming.layout.name, id_prefix: prefix, translation_mm: [...offset],
    added_instance_count: mappings.length, instances: mappings,
    layout_sha256: after.layout_sha256, geometry_sha256: after.geometry_sha256,
    semantics: 'All incoming instances append in saved order with prefixed IDs and a shared world-mm translation. Existing instances and layout name stay unchanged. Embedded originals, source units, selections, scale, rotation and center/ground are preserved. No persistent grouping, external links, alignment, welding, collision or physical-suitability assessment.',
  };
  return after;
}
