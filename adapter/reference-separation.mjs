import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const SEPARATION_CONTRACT = 'moonmold.reference-surface-separation.v1';
export const SEPARATION_MAX_TRIANGLE_PAIRS = 250_000;
const reject = message => { throw new AdapterRejection('invalid-reference-separation', message); };
const sub = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const at = (a, d, t) => a.map((n, i) => n + d[i] * t);
const clamp = n => Math.max(0, Math.min(1, n));
const edges = t => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
const distance = (a, b) => Math.hypot(...sub(a, b));

// Work in each triangle's scaled local coordinates. No snapping tolerance is
// used: representable tiny positive gaps are not deliberately rounded to zero.
function plane(triangle) {
  const [a,b,c] = triangle, ab = sub(b,a), ac = sub(c,a);
  const scale = Math.max(Math.hypot(...ab), Math.hypot(...ac));
  if (!scale) return null;
  const u = ab.map(n => n/scale), v = ac.map(n => n/scale), normal = cross(u,v);
  const length = Math.hypot(...normal);
  if (!length) return null;
  return { origin:a, u, v, scale, normal:normal.map(n => n/length) };
}
function inside(point, p) {
  const w = sub(point,p.origin).map(n => n/p.scale);
  return dot(cross(p.u,w),p.normal) >= 0 && dot(cross(w,p.v),p.normal) >= 0 &&
    dot(cross(sub(p.v,p.u),sub(w,p.u)),p.normal) >= 0;
}
function closestSegment(point, a, b) {
  const d = sub(b,a), length = dot(d,d);
  return length ? at(a,d,clamp(dot(sub(point,a),d)/length)) : [...a];
}
function closestTriangle(point, triangle, p) {
  if (p) {
    const projected = at(point,p.normal,-dot(sub(point,p.origin),p.normal));
    if (inside(projected,p)) return projected;
  }
  let best = null, minimum = Infinity;
  for (const [a,b] of edges(triangle)) {
    const candidate = closestSegment(point,a,b), d = distance(point,candidate);
    if (d < minimum) { best = candidate; minimum = d; }
  }
  return best;
}
function edgeIntersection(a, b, p) {
  if (!p) return null;
  const d = sub(b,a), denominator = dot(d,p.normal);
  if (denominator === 0) return null; // coplanar contact is covered by endpoints/edges
  const t = dot(sub(p.origin,a),p.normal)/denominator;
  if (t < 0 || t > 1) return null;
  const point = at(a,d,t);
  return inside(point,p) ? point : null;
}
// Closest points of two closed segments, including zero-length edges.
function segmentPair(a,b,c,d) {
  const u = sub(b,a), v = sub(d,c), w = sub(a,c);
  const aa = dot(u,u), bb = dot(u,v), cc = dot(v,v), dd = dot(u,w), ee = dot(v,w);
  if (!aa) return [[...a], closestSegment(a,c,d)];
  if (!cc) return [closestSegment(c,a,b), [...c]];
  const determinant = aa*cc-bb*bb;
  let s = determinant > 0 ? clamp((bb*ee-cc*dd)/determinant) : 0;
  let t = (bb*s+ee)/cc;
  if (t < 0) { t = 0; s = clamp(-dd/aa); }
  else if (t > 1) { t = 1; s = clamp((bb-dd)/aa); }
  return [at(a,u,s), at(c,v,t)];
}
function trianglePair(a,b) {
  const pa = plane(a), pb = plane(b);
  for (const [x,y] of edges(a)) { const point = edgeIntersection(x,y,pb); if (point) return { a:point, b:[...point], distance:0 }; }
  for (const [x,y] of edges(b)) { const point = edgeIntersection(x,y,pa); if (point) return { a:point, b:[...point], distance:0 }; }
  let best = { distance:Infinity };
  const consider = (x,y) => { const d = distance(x,y); if (d < best.distance) best = { a:x, b:y, distance:d }; };
  for (const point of a) consider([...point],closestTriangle(point,b,pb));
  for (const point of b) consider(closestTriangle(point,a,pa),[...point]);
  for (const [a0,a1] of edges(a)) for (const [b0,b1] of edges(b)) consider(...segmentPair(a0,a1,b0,b1));
  return best;
}

function witness(composed, part, localIndex, coordinates) {
  const index = part.triangle_range.start + localIndex;
  return {
    instance_id: part.id, triangle_index: localIndex, layout_triangle_index:index,
    local_vertex_indices:composed.triangles[index].map(n => n-part.vertex_range.start),
    coordinates_mm:coordinates, source_name:part.source_name,
    source_format:part.source_format, source_units:part.source_units, source_sha256:part.source_sha256,
    ...(part.source_encoding ? { source_encoding:part.source_encoding } : {}),
    ...(part.selection ? { selection:structuredClone(part.selection), source_face_index:part.triangle_source_faces[localIndex] } : {}),
    ...(part.glb_nodes ? { glb_nodes:structuredClone(part.glb_nodes) } : {}),
    transform:structuredClone(part.transform), losses:[...part.losses],
  };
}

export function measureReferenceSeparation(input) {
  const fields = ['layout','instance_a','instance_b','expected_layout_sha256','expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k))) reject('Separation accepts only layout, two instance IDs and expected layout/geometry hashes');
  for (const key of ['expected_layout_sha256','expected_geometry_sha256']) if (!/^[a-f0-9]{64}$/.test(input[key] ?? '')) reject(`${key} must bind the instance choices to the inspected layout`);
  const composed = composeReferenceLayout(input.layout);
  if (composed.layout_sha256 !== input.expected_layout_sha256 || composed.geometry_sha256 !== input.expected_geometry_sha256) reject('Stale layout or geometry identity; inspect and select the two instances again');
  const a = composed.parts.find(p => p.id === input.instance_a), b = composed.parts.find(p => p.id === input.instance_b);
  if (!a || !b || a === b) reject('Choose two different existing instances');
  const pairCount = a.triangle_range.count * b.triangle_range.count;
  if (!pairCount || pairCount > SEPARATION_MAX_TRIANGLE_PAIRS) reject(`Selected surfaces need 1 through ${SEPARATION_MAX_TRIANGLE_PAIRS} triangle pairs; requested ${pairCount}. Select smaller source parts or simplify in the source editor`);
  const triangles = p => composed.triangles.slice(p.triangle_range.start,p.triangle_range.start+p.triangle_range.count).map(face => face.map(i => composed.vertices[i]));
  const ta = triangles(a), tb = triangles(b);
  let best = { distance:Infinity }, indexA = 0, indexB = 0, examined = 0;
  outer: for (let i=0;i<ta.length;i++) for (let j=0;j<tb.length;j++) {
    const candidate = trianglePair(ta[i],tb[j]); examined++;
    if (candidate.distance < best.distance) { best = candidate; indexA = i; indexB = j; }
    if (best.distance === 0) break outer;
  }
  if (!Number.isFinite(best.distance) || [...best.a,...best.b].some(n => !Number.isFinite(n))) reject('Separation is unavailable for these represented numeric coordinates');
  return {
    contract_id:SEPARATION_CONTRACT, layout_name:composed.layout.name,
    layout_sha256:composed.layout_sha256, geometry_sha256:composed.geometry_sha256,
    measurement_kind:'minimum-triangle-surface-distance', units:'mm', frame:'placed layout XYZ; Z is the grounding axis',
    instance_a:a.id, instance_b:b.id, distance_mm:best.distance,
    witness_a:witness(composed,a,indexA,best.a), witness_b:witness(composed,b,indexB,best.b),
    delta_b_minus_a_mm:sub(best.b,best.a), triangle_counts:[ta.length,tb.length],
    triangle_pair_count:pairCount, triangle_pairs_examined:examined, maximum_triangle_pairs:SEPARATION_MAX_TRIANGLE_PAIRS,
    transform_order:composed.transform_order, physical_authority:false,
    qualification:'Minimum distance between represented triangle surfaces only. Not solid collision, containment, engineering clearance or physical suitability evidence.',
    limitations:[
      'Open surfaces are allowed. Contained closed shells can have positive surface separation despite overlapping solid interiors; no inside/outside or penetration depth is computed.',
      'Unreferenced vertices are ignored. Existing importer rejection of degenerate input and transform rejection of triangles collapsed by placement precision remain unchanged. No welding, topology repair or source modification is performed.',
      'IEEE double precision, source triangulation and import losses apply. No tolerance, accuracy guarantee or deliberate positive-gap snapping is used; near-degenerate and nearly coplanar geometry may be numerically unstable.',
      'One closest witness pair is reported. Equal minima choose the first encountered candidate; triangle indices refer to the current imported and selected order.',
      'A zero result is represented surface contact/intersection, not proof of a valid assembly. Recalculate after edits and retain the editable layout with this read-only observation.'
    ],
  };
}
