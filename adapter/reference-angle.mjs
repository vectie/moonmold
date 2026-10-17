import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { resolveReferenceEndpoint } from './reference-measurement.mjs';

export const ANGLE_CONTRACT = 'moonmold.reference-vertex-angle.v1';
const reject = message => { throw new AdapterRejection('invalid-reference-angle', message); };

// An observation of represented placed vertices, independent of saved layout data.
export function measureReferenceAngle(input) {
  const fields = ['layout', 'endpoint_a', 'vertex_b', 'endpoint_c', 'expected_layout_sha256', 'expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) reject('angle measurement has invalid or unknown fields');
  for (const key of ['expected_layout_sha256', 'expected_geometry_sha256']) {
    if (typeof input[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input[key])) reject(`${key} must bind the three choices to the current composition`);
  }
  const composed = composeReferenceLayout(input.layout);
  if (input.expected_layout_sha256 !== composed.layout_sha256 || input.expected_geometry_sha256 !== composed.geometry_sha256) reject('Stale angle selection: layout or geometry changed; select all three vertices again');
  const a = resolveReferenceEndpoint(composed, input.endpoint_a, 'endpoint_a');
  const b = resolveReferenceEndpoint(composed, input.vertex_b, 'vertex_b');
  const c = resolveReferenceEndpoint(composed, input.endpoint_c, 'endpoint_c');
  const ba = a.coordinates_mm.map((n, i) => n - b.coordinates_mm[i]);
  const bc = c.coordinates_mm.map((n, i) => n - b.coordinates_mm[i]);
  const baLength = Math.hypot(...ba), bcLength = Math.hypot(...bc);
  if (!(baLength > 0) || !(bcLength > 0)) reject('Both arms must have nonzero represented length; B cannot coincide with A or C');
  const u = ba.map(n => n / baLength), v = bc.map(n => n / bcLength);
  const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const radians = Math.atan2(Math.hypot(...cross), u.reduce((sum,n,i) => sum+n*v[i], 0));
  return {
    contract_id: ANGLE_CONTRACT, layout_name: composed.layout.name,
    layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
    units: 'degrees', coordinate_units: 'mm', frame: 'placed layout XYZ; Z is the grounding axis',
    endpoint_a: a, vertex_b: b, endpoint_c: c,
    arm_b_to_a_mm: ba, arm_b_to_c_mm: bc, arm_ba_length_mm: baLength, arm_bc_length_mm: bcLength,
    angle_abc_degrees: radians * 180 / Math.PI, transform_order: composed.transform_order,
    physical_authority: false,
    qualification: 'Unsigned smaller 3D angle ABC at B, between two selected placed reference-vertex arms (0–180 degrees). Descriptive digital observation only; not a dihedral, surface normal, tolerance, engineering or physical-suitability assessment, or a human review.',
    limitations: ['Local zero-based indices use the current imported/part-selected order, including retained unreferenced vertices. STL vertices may repeat per triangle.',
      'IEEE double precision and represented source precision apply. Coincident arm endpoints are rejected; nonzero collinear arms yield 0 or 180 degrees.',
      'This separate report binds exact layout, geometry, source identities and placement. Source or placement changes require a fresh selection and observation.']
  };
}
