import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { measureReferenceLayout } from './reference-measurement.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { rotateReferencePoint } from './reference-rotation.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-calibration', message); };

// Derive one ordinary placement from a measured pair. Original bytes and units
// remain authoritative source data; calibration changes the placement scale only.
export function calibrateReferenceLayout(input) {
  const fields = ['layout', 'endpoint_a', 'endpoint_b', 'target_distance_mm', 'expected_layout_sha256', 'expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) reject('Calibration request has invalid or unknown fields');
  const target = input.target_distance_mm;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0 || target > 1e9) reject('target_distance_mm must be positive and no greater than 1000000000');
  const { target_distance_mm: _, ...measurementInput } = input;
  const observed = measureReferenceLayout(measurementInput);
  const a = observed.endpoint_a, b = observed.endpoint_b;
  if (a.instance_id !== b.instance_id) reject('Choose two vertices on the same instance to calibrate its uniform scale');
  if (!(observed.distance_mm > 0)) reject('The chosen vertices coincide at the represented precision; choose a nonzero length');
  const before = composeReferenceLayout(input.layout), candidate = structuredClone(before.layout);
  const instance = candidate.instances.find(item => item.id === a.instance_id);
  const old = structuredClone(instance.transform);
  const factor = target / observed.distance_mm, scale = old.scale * factor;
  if (!Number.isFinite(scale) || scale < 1e-6 || scale > 1e6) reject('Requested length requires a placement scale outside 0.000001 through 1000000');
  if (factor !== 1) {
    // Recompute the scaled/rotated and optionally grounded source before fixing
    // translation. Avoid an intermediate composition that could exceed bounds
    // even though the final anchor-preserving placement is in range.
    const mesh = importReferenceMesh(instance.source);
    const local = mesh.vertices.map(point => rotateReferencePoint(point.map(n => n * scale), old.rotation_deg));
    const min = [0, 1, 2].map(axis => Math.min(...local.map(point => point[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...local.map(point => point[axis])));
    const ground = old.center_and_ground ? [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]] : [0, 0, 0];
    instance.transform.scale = scale;
    instance.transform.translation_mm = a.coordinates_mm.map((n, axis) => n - local[a.vertex_index][axis] - ground[axis]);
  }
  const result = composeReferenceLayout(candidate);
  const after = measureReferenceLayout({ layout: result.layout,
    endpoint_a: input.endpoint_a, endpoint_b: input.endpoint_b,
    expected_layout_sha256: result.layout_sha256, expected_geometry_sha256: result.geometry_sha256 });
  if (!(after.distance_mm > 0)) reject('Requested length collapses the selected pair at this coordinate precision');
  result.calibration = {
    contract_id: 'moonmold.reference-length-calibration.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    instance_id: a.instance_id, source_sha256: a.source_sha256,
    endpoint_a: a, endpoint_b: b,
    target_distance_mm: target, before_distance_mm: observed.distance_mm,
    after_distance_mm: after.distance_mm, residual_mm: after.distance_mm - target,
    scale_factor: factor, before_transform: old, after_transform: structuredClone(instance.transform),
    anchor_before_mm: a.coordinates_mm, anchor_after_mm: after.endpoint_a.coordinates_mm,
    anchor_residual_mm: after.endpoint_a.coordinates_mm.map((n, axis) => n - a.coordinates_mm[axis]),
    endpoint_b_after_mm: after.endpoint_b.coordinates_mm,
    semantics: 'One-time uniform scale about the first selected placed vertex. Original bytes, units, selections, rotation and center/ground preference remain; translation compensates to keep A fixed. Other instances are unchanged.',
    limitations: ['The supplied length is a user constraint, not a verified physical measurement or correction of declared source units.',
      'IEEE double precision and source precision apply; achieved length and anchor residuals are reported.',
      'No persistent constraint, topology repair, collision, engineering accuracy or physical-suitability assessment.',
      'Save the inspection report for calibration provenance and the editable layout to continue editing; keep the original layout separately.'],
    physical_authority: false,
  };
  return result;
}
