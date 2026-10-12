import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-distribution', message); };

// Distribute existing, differently sized references in an explicit world-axis
// order. Only interior translations change; first and last are fixed anchors.
export function distributeReferenceLayout(input) {
  const fields = ['layout', 'instance_ids', 'axis'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== fields.length || !fields.every(key => Object.hasOwn(input, key))) {
    reject('Expected exactly layout, instance_ids and axis');
  }
  const axis = ['x', 'y', 'z'].indexOf(input.axis);
  if (axis < 0) reject('axis must be x, y or z');
  const ids = input.instance_ids;
  if (!Array.isArray(ids) || ids.length < 3 || ids.length > 16 ||
      ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    reject('instance_ids needs 3–16 unique existing IDs in the intended increasing-axis order');
  }
  const before = composeReferenceLayout(input.layout);
  const parts = ids.map(id => before.parts.find(part => part.id === id));
  if (parts.some(part => !part)) reject('Every chosen instance must exist in the layout');
  const first = parts[0], last = parts.at(-1);
  const span = last.bounds.min[axis] - first.bounds.max[axis];
  const interior = parts.slice(1, -1);
  const totalWidth = interior.reduce((sum, part) => sum + part.bounds.size[axis], 0);
  const gap = (span - totalWidth) / (parts.length - 1);
  if (!Number.isFinite(gap) || gap < 0) {
    reject('Fixed endpoint bounds leave insufficient space for nonnegative equal gaps in the declared order');
  }
  const layout = structuredClone(before.layout);
  let cursor = first.bounds.max[axis] + gap;
  const desired = new Map([[first.id, first.bounds.min[axis]], [last.id, last.bounds.min[axis]]]);
  for (const part of interior) {
    const item = layout.instances.find(instance => instance.id === part.id);
    const delta = cursor - part.bounds.min[axis];
    item.transform.translation_mm[axis] += delta;
    desired.set(part.id, cursor);
    cursor += part.bounds.size[axis] + gap;
  }
  // The shared composition validates the complete result before returning any
  // candidate. Original sources and the source-preserving layout schema remain.
  const result = composeReferenceLayout(layout);
  const after = ids.map(id => result.parts.find(part => part.id === id));
  result.distribution = {
    contract_id: 'moonmold.reference-distribution-operation.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    axis: input.axis, instance_ids: [...ids], fixed_endpoint_ids: [first.id, last.id],
    frame: 'right-handed world XYZ in millimetres, Z-up',
    endpoint_span_mm: span, interior_total_width_mm: totalWidth, target_gap_mm: gap,
    instances: parts.map((part, index) => ({
      instance_id: part.id, fixed: index === 0 || index === parts.length - 1,
      source_sha256: part.source_sha256,
      before_transform: structuredClone(part.transform), after_transform: structuredClone(after[index].transform),
      before_bounds: structuredClone(part.bounds), after_bounds: structuredClone(after[index].bounds),
      desired_min_mm: desired.get(part.id),
      translation_delta_mm: after[index].transform.translation_mm[axis] - part.transform.translation_mm[axis],
      min_residual_mm: after[index].bounds.min[axis] - desired.get(part.id),
    })),
    gaps: after.slice(1).map((part, index) => ({
      from_instance_id: after[index].id, to_instance_id: part.id,
      actual_gap_mm: part.bounds.min[axis] - after[index].bounds.max[axis],
      residual_mm: part.bounds.min[axis] - after[index].bounds.max[axis] - gap,
    })),
    semantics: 'One-time equal spacing of projected world-axis bounds in caller-supplied order, including retained unreferenced vertices. First and last placements stay fixed. Unchosen placements stay fixed and are not obstacles.',
    limits: [
      'Bounds gaps are not surface distances, contact, collision or physical-clearance assessments',
      'IEEE double-precision placement may leave rounding residuals; actual gaps and residuals are reported',
      'No persistent distribution constraint, geometry repair, engineering certification or physical authority',
      'Save this report for operation lineage; the editable layout stores current placements only',
    ],
    physical_authority: false,
  };
  return result;
}
