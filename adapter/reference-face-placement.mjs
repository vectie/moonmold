import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { referenceRotationFromMatrix, rotateReferencePoint } from './reference-rotation.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-face-placement', message); };
const sub = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = p => p.map(n => n / Math.hypot(...p));

// Rotate the CURRENT placed triangle into a deterministic right-handed frame.
// The editable source remains untouched; placement recomposition compensates
// for center/ground and composes arbitrary existing rotations rather than adding.
export function placeReferenceFace(input) {
  const fields = ['layout', 'instance_id', 'triangle_index', 'height_mm', 'expected_layout_sha256', 'expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) reject('Face placement requires exactly layout, instance, triangle, height and both parent identities');
  if (!Number.isSafeInteger(input.triangle_index) || input.triangle_index < 0) reject('triangle_index must be a zero-based integer');
  if (typeof input.height_mm !== 'number' || !Number.isFinite(input.height_mm) || Math.abs(input.height_mm) > 1e9) reject('height_mm must be finite within ±1000000000 mm');
  const before = composeReferenceLayout(input.layout);
  if (input.expected_layout_sha256 !== before.layout_sha256 || input.expected_geometry_sha256 !== before.geometry_sha256) reject('Face placement requires the current layout and geometry identities');
  const part = before.parts.find(item => item.id === input.instance_id);
  if (!part || input.triangle_index >= part.triangle_range.count) reject('Choose an existing instance and a current local triangle');
  const indices = before.triangles[part.triangle_range.start + input.triangle_index];
  const points = indices.map(i => before.vertices[i]);
  const [a, b, c] = points, ab = sub(b, a), ac = sub(c, a);
  const length = Math.hypot(...ab), otherLength = Math.hypot(...ac);
  const magnitude = Math.max(...points.flat().map(Math.abs), length, otherLength);
  // Directions of nearly collinear faces or sub-ULP edges are not trustworthy.
  const resolution = magnitude * Number.EPSILON * 128;
  if (Math.min(length, otherLength) <= resolution) reject('Selected triangle is too small at this coordinate precision');
  const x = unit(ab), crossDirection = cross(x, unit(ac)), sine = Math.hypot(...crossDirection);
  if (!Number.isFinite(sine) || sine <= 1e-10) reject('Selected triangle is degenerate or too nearly collinear for stable placement');
  const z = unit(crossDirection), y = unit(cross(z, x));
  const frame = [x, y, z]; // rows project the old world frame onto the picked face
  const anchor = [a[0], a[1], input.height_mm];
  const candidate = structuredClone(before.layout), item = candidate.instances.find(item => item.id === part.id);
  const old = structuredClone(item.transform);
  const columns = [[1,0,0], [0,1,0], [0,0,1]].map(axis => rotateReferencePoint(axis, old.rotation_deg));
  const angles = referenceRotationFromMatrix(frame.map(axis => columns.map(column => dot(axis, column))));
  const mesh = importReferenceMesh(item.source);
  const local = mesh.vertices.map(p => rotateReferencePoint(p.map(n => n * old.scale), angles));
  const min = [0,1,2].map(axis => Math.min(...local.map(p => p[axis])));
  const max = [0,1,2].map(axis => Math.max(...local.map(p => p[axis])));
  const ground = old.center_and_ground ? [-(min[0]+max[0])/2, -(min[1]+max[1])/2, -min[2]] : [0,0,0];
  item.transform.rotation_deg = angles;
  item.transform.translation_mm = anchor.map((n, axis) => n - local[indices[0] - part.vertex_range.start][axis] - ground[axis]);
  const next = composeReferenceLayout(candidate);
  const tolerance = Math.max(1, magnitude, Math.abs(input.height_mm), ...next.bounds.min.map(Math.abs), ...next.bounds.max.map(Math.abs)) * Number.EPSILON * 256;
  // Verify every chosen vertex follows this rigid map after Euler/grounding
  // recomposition. Reject inaccurate results instead of silently flattening data.
  for (let i = part.vertex_range.start; i < part.vertex_range.start + part.vertex_range.count; i++) {
    const wanted = frame.map((axis, n) => anchor[n] + dot(axis, sub(before.vertices[i], a)));
    if (next.vertices[i].some((n, axis) => Math.abs(n - wanted[axis]) > tolerance)) reject('Face placement cannot be represented accurately at these coordinates');
  }
  const afterPoints = indices.map(i => next.vertices[i]);
  if (afterPoints.some(p => Math.abs(p[2] - input.height_mm) > tolerance) || afterPoints[1][0] <= afterPoints[0][0] || afterPoints[2][1] <= afterPoints[0][1]) reject('Face placement cannot retain its right-handed frame at this precision');
  next.face_placement = {
    contract_id: 'moonmold.reference-face-placement.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: next.layout_sha256, geometry_sha256: next.geometry_sha256,
    instance_id: part.id, triangle_index: input.triangle_index,
    vertex_indices: indices.map(i => i - part.vertex_range.start), height_mm: input.height_mm,
    before_vertices_mm: points, after_vertices_mm: afterPoints, anchor_mm: anchor,
    world_to_face_rotation: frame, before_transform: old, after_transform: structuredClone(item.transform),
    tolerance_mm: tolerance, max_height_residual_mm: Math.max(...afterPoints.map(p => Math.abs(p[2] - input.height_mm))),
    frame: 'world-xy-mm-first-edge-positive-x-normal-positive-z', physical_authority: false,
    qualification: 'One-time rigid reference placement. First vertex retains world XY at requested Z; first-to-second edge points +X and triangle normal +Z. Original sources, scale, center/ground preference and other instances are retained. IEEE double-precision residuals remain. No persistent constraint, collision, engineering or physical-suitability assessment.',
  };
  return next;
}
