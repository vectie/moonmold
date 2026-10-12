import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-alignment', message); };
const anchorValue = (bounds, anchor, axis) => anchor === 'center'
  ? (bounds.min[axis] + bounds.max[axis]) / 2 : bounds[anchor][axis];

// Resolve anchors on the already placed world bounds, then change only one
// translation component. The result is an ordinary, independently editable layout.
export function alignReferenceLayout(input) {
  const fields = ['layout', 'instance_id', 'reference_id', 'axis', 'moving_anchor', 'reference_anchor', 'offset_mm'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) reject('Expected layout, instance_id, reference_id, axis, moving_anchor, reference_anchor and offset_mm');
  const axis = ['x', 'y', 'z'].indexOf(input.axis);
  if (axis < 0) reject('axis must be x, y or z');
  for (const key of ['moving_anchor', 'reference_anchor']) if (!['min', 'center', 'max'].includes(input[key])) reject(`${key} must be min, center or max`);
  if (typeof input.offset_mm !== 'number' || !Number.isFinite(input.offset_mm) || Math.abs(input.offset_mm) > 1e9) reject('offset_mm must be a finite number within +/-1000000000');
  if (typeof input.instance_id !== 'string' || typeof input.reference_id !== 'string' || input.instance_id === input.reference_id) reject('instance_id and reference_id must identify different existing instances');
  const before = composeReferenceLayout(input.layout);
  const moving = before.parts.find(part => part.id === input.instance_id);
  const reference = before.parts.find(part => part.id === input.reference_id);
  if (!moving || !reference) reject('instance_id and reference_id must identify different existing instances');
  const beforeMm = anchorValue(moving.bounds, input.moving_anchor, axis);
  const referenceMm = anchorValue(reference.bounds, input.reference_anchor, axis);
  const desiredMm = referenceMm + input.offset_mm;
  const delta = desiredMm - beforeMm;
  const layout = structuredClone(before.layout);
  layout.instances.find(item => item.id === moving.id).transform.translation_mm[axis] += delta;
  // Recomposition enforces existing coordinate, triangle and portable-source budgets.
  const result = composeReferenceLayout(layout);
  const afterMm = anchorValue(result.parts.find(part => part.id === moving.id).bounds, input.moving_anchor, axis);
  result.alignment = {
    contract_id: 'moonmold.reference-alignment-operation.v1',
    parent_layout_sha256: before.layout_sha256,
    instance_id: moving.id, reference_id: reference.id, axis: input.axis,
    moving_anchor: input.moving_anchor, reference_anchor: input.reference_anchor,
    offset_mm: input.offset_mm, translation_delta_mm: delta,
    moving_before_mm: beforeMm, reference_anchor_mm: referenceMm,
    desired_anchor_mm: desiredMm, moving_after_mm: afterMm,
    actual_offset_mm: afterMm - referenceMm, residual_mm: (afterMm - referenceMm) - input.offset_mm,
    semantics: 'One-time world-axis bounding-box alignment, including all retained vertices. Positive offset is toward the positive world axis. No persistent constraint, surface contact, collision or physical-clearance assessment.'
  };
  return result;
}
