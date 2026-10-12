import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { moveReferenceArrangement } from './reference-arrangement.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-circular-array', message); };

// Expand a placed reference about one declared world axis. Each copy starts
// from the same original placement, never the preceding copy's rounded recipe.
export function circularArrayReferenceLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['layout', 'instance_id', 'axis', 'pivot_mm', 'step_deg', 'count'].includes(key))) reject('Expected layout, instance_id, axis, pivot_mm, step_deg and count');
  const { axis, pivot_mm: pivot, step_deg: step, count } = input;
  if (!['x', 'y', 'z'].includes(axis)) reject('axis must be x, y or z in the world frame');
  if (!Array.isArray(pivot) || pivot.length !== 3 || pivot.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9)) reject('pivot_mm needs three finite numbers within +/-1000000000');
  if (typeof step !== 'number' || !Number.isFinite(step) || step === 0 || Math.abs(step) >= 360) reject('step_deg must be nonzero and strictly between -360 and 360 degrees');
  if (!Number.isInteger(count) || count < 2 || count > 16) reject('count must be an integer from 2 through 16, including the original');
  if (!Array.isArray(input.layout?.instances) || input.layout.instances.length + count - 1 > 16) reject('Expanded layout exceeds 16 instances');
  const before = composeReferenceLayout(input.layout);
  const templateIndex = before.layout.instances.findIndex(item => item.id === input.instance_id);
  if (templateIndex < 0) reject('instance_id must identify an existing layout instance');
  const template = before.layout.instances[templateIndex];
  const candidate = structuredClone(before.layout);
  const ids = new Set(candidate.instances.map(item => item.id));
  const placements = [{ instance_id: template.id, index: 0, angle_deg: 0, transform: structuredClone(template.transform) }];
  const single = { ...before.layout, instances: [template] };
  let next = 1;
  for (let index = 1; index < count; index++) {
    const angle = index * step, rotation = [0, 0, 0];
    rotation['xyz'.indexOf(axis)] = angle;
    // Reuse world rotation composition and center/ground compensation. This
    // retains source units, selection, bytes, scale and placement preferences.
    const moved = moveReferenceArrangement({ layout: single, instance_ids: [template.id],
      pivot_mm: pivot, rotation_deg: rotation, translation_mm: [0, 0, 0] });
    const copy = structuredClone(moved.layout.instances[0]);
    while (ids.has(`circular-${next}`)) next++;
    copy.id = `circular-${next++}`;
    ids.add(copy.id);
    candidate.instances.push(copy);
    placements.push({ instance_id: copy.id, index, angle_deg: angle, transform: structuredClone(copy.transform) });
  }
  const result = composeReferenceLayout(candidate);
  result.circular_array = {
    contract_id: 'moonmold.reference-circular-array-operation.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    template_instance_id: template.id, source_sha256: before.parts[templateIndex].source_sha256,
    axis, pivot_mm: [...pivot], step_deg: step, count, added_instance_count: count - 1, placements,
    frame: 'right-handed world XYZ in millimetres, Z-up',
    semantics: 'One-time circular expansion. Count includes the unchanged original at angle zero. Each copy rotates both position and orientation about the same world-axis line through the pivot, from the original placement; all placements edit independently.',
    limits: ['Overlaps, repeated turns and axis-coincident geometry are retained; no deduplication or collision assessment',
      'IEEE double-precision rotations and Euler decomposition may leave rounding residuals',
      'Editable layout stores resulting placements; retain this report for operation lineage'],
    physical_authority: false,
  };
  return result;
}
