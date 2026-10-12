import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceLayout } from './reference-measurement.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-snap', message); };

// Point-to-point placement changes translation only. A is the moving instance;
// B is a fixed reference. Offset is world XYZ millimetres, not source axes.
export function snapReferenceLayout(input) {
  const fields = ['layout', 'endpoint_a', 'endpoint_b', 'offset_mm', 'expected_layout_sha256', 'expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) reject('Snap request has invalid or unknown fields');
  const offset = input.offset_mm;
  if (!Array.isArray(offset) || offset.length !== 3 || offset.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9)) reject('offset_mm needs three finite world XYZ millimetre values within +/-1000000000');
  const { offset_mm: _, ...measurementInput } = input;
  const observed = measureReferenceLayout(measurementInput);
  const a = observed.endpoint_a, b = observed.endpoint_b;
  if (a.instance_id === b.instance_id) reject('Choose vertices on different instances; the reference instance must remain fixed');
  const before = composeReferenceLayout(input.layout), candidate = structuredClone(before.layout);
  const item = candidate.instances.find(instance => instance.id === a.instance_id);
  const old = structuredClone(item.transform);
  const desired = b.coordinates_mm.map((n, axis) => n + offset[axis]);
  const delta = desired.map((n, axis) => n - a.coordinates_mm[axis]);
  // Avoid accumulating sub-ULP translation edits when reopening and repeating
  // the same point placement. This numerical floor is not a physical tolerance.
  const precisionFloor = desired.map((n, axis) => 16 * Number.EPSILON * Math.max(1, Math.abs(n), Math.abs(a.coordinates_mm[axis]), Math.abs(old.translation_mm[axis])));
  const appliedDelta = delta.map((n, axis) => Math.abs(n) <= precisionFloor[axis] ? 0 : n);
  item.transform.translation_mm = old.translation_mm.map((n, axis) => n + appliedDelta[axis]);
  const result = composeReferenceLayout(candidate);
  const after = measureReferenceLayout({ layout: result.layout, endpoint_a: input.endpoint_a, endpoint_b: input.endpoint_b,
    expected_layout_sha256: result.layout_sha256, expected_geometry_sha256: result.geometry_sha256 });
  result.snap = {
    contract_id: 'moonmold.reference-vertex-snap.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    endpoint_a: a, endpoint_b: b, offset_mm: [...offset], desired_a_mm: desired,
    translation_delta_mm: appliedDelta, requested_translation_delta_mm: delta, numerical_floor_mm: precisionFloor, before_transform: old, after_transform: structuredClone(item.transform),
    endpoint_a_after_mm: after.endpoint_a.coordinates_mm, endpoint_b_after_mm: after.endpoint_b.coordinates_mm,
    actual_offset_mm: after.endpoint_a.coordinates_mm.map((n, axis) => n - after.endpoint_b.coordinates_mm[axis]),
    residual_mm: after.endpoint_a.coordinates_mm.map((n, axis) => n - desired[axis]),
    semantics: 'One-time translation of A to B plus a world XYZ millimetre offset. Original source bytes, selections, units, scale, rotation and center/ground preference remain editable; all other instances stay fixed.',
    limitations: ['Vertex indices refer to the current imported/part-selected order; reselect after source or layout changes.',
      'IEEE double precision and source precision apply; residuals are descriptive, not accuracy guarantees.',
      'No rotation fitting, persistent attachment, welding, contact, collision, clearance or physical-suitability assessment.',
      'Save the report for provenance and the layout for editing; preserve the original layout for undo.'],
    physical_authority: false,
  };
  return result;
}
