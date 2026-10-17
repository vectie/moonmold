import { AdapterRejection } from './protocol.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-extrusion', message); };
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const opposite = (a, b) => (a > 0 && b < 0) || (a < 0 && b > 0);
const onSegment = (a, b, p) => p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);

function intersects(a, b, c, d, epsilon) {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  // Preserve strict crossings even when all orientations lie inside the band.
  return (opposite(ac, ad) && opposite(ca, cb)) ||
    (Math.abs(ac) <= epsilon && onSegment(a, b, c)) || (Math.abs(ad) <= epsilon && onSegment(a, b, d)) ||
    (Math.abs(ca) <= epsilon && onSegment(c, d, a)) || (Math.abs(cb) <= epsilon && onSegment(c, d, b));
}

function signedDoubleArea(points, ring) {
  let area = 0;
  for (let i = 1; i < ring.length - 1; i++) area += cross(points[ring[0]], points[ring[i]], points[ring[i + 1]]);
  return area;
}

function validateRing(points, ring, epsilon, label) {
  if (new Set(ring.map(i => points[i].join(','))).size !== ring.length) reject(`Repeated ${label} profile vertices are unsupported; omit the repeated closing point`);
  if (ring.some((p, i) => Math.abs(cross(points[ring[(i + ring.length - 1) % ring.length]], points[p], points[ring[(i + 1) % ring.length]])) <= epsilon)) reject(`Collinear or numerically ambiguous ${label} corners are unsupported; simplify the outline`);
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
    if (intersects(points[ring[i]], points[ring[(i + 1) % ring.length]], points[ring[j]], points[ring[(j + 1) % ring.length]], epsilon)) reject(`${label} profile must be simple: non-adjacent edges intersect, touch or are numerically ambiguous`);
  }
  const area = signedDoubleArea(points, ring);
  if (Math.abs(area) <= epsilon) reject(`${label} profile area is zero or numerically ambiguous`);
  return area;
}

// Winding-number membership with an explicit boundary/ambiguity result.
function membership(p, points, ring, epsilon) {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = points[ring[i]], b = points[ring[(i + 1) % ring.length]], orientation = cross(a, b, p);
    if (Math.abs(orientation) <= epsilon && onSegment(a, b, p)) return 'boundary';
    if (a[1] <= p[1] && b[1] > p[1] && orientation > 0) winding++;
    if (a[1] > p[1] && b[1] <= p[1] && orientation < 0) winding--;
  }
  return winding ? 'inside' : 'outside';
}

function clipEars(points, ring, epsilon) {
  const remaining = [...ring], caps = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length], b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (cross(points[a], points[b], points[c]) <= epsilon) continue;
      // Bridge endpoints occur twice in the traversal but retain one point ID.
      if (remaining.some(p => p !== a && p !== b && p !== c && cross(points[a], points[b], points[p]) >= -epsilon && cross(points[b], points[c], points[p]) >= -epsilon && cross(points[c], points[a], points[p]) >= -epsilon)) continue;
      caps.push([a, b, c]); remaining.splice(i, 1); clipped = true; break;
    }
    if (!clipped) return null;
  }
  if (cross(...remaining.map(i => points[i])) <= epsilon) return null;
  caps.push([...remaining]);
  return caps;
}

function clearDiagonal(a, b, points, edges, epsilon) {
  for (const [c, d] of edges) {
    if ((a === c && b === d) || (a === d && b === c)) continue;
    const shared = a === c || a === d ? a : b === c || b === d ? b : null;
    if (shared !== null) {
      const other = shared === c ? d : c;
      if (Math.abs(cross(points[a], points[b], points[other])) <= epsilon &&
        (onSegment(points[a], points[b], points[other]) || onSegment(points[c], points[d], points[shared === a ? b : a]))) return false;
    } else if (intersects(points[a], points[b], points[c], points[d], epsilon)) return false;
  }
  return true;
}

function verifyCaps(points, outer, hole, caps, epsilon, area) {
  if (caps.length !== points.length) return false;
  const edges = new Map(), key = (a, b) => `${Math.min(a, b)},${Math.max(a, b)}`;
  let actualArea = 0;
  for (const [a, b, c] of caps) {
    actualArea += cross(points[a], points[b], points[c]) / 2;
    const center = [0, 1].map(axis => (points[a][axis] + points[b][axis] + points[c][axis]) / 3);
    if (membership(center, points, outer, epsilon) !== 'inside' || membership(center, points, hole, epsilon) !== 'outside') return false;
    for (const edge of [[a, b], [b, c], [c, a]]) {
      const id = key(...edge); if (!edges.has(id)) edges.set(id, []); edges.get(id).push(edge);
    }
  }
  const boundary = new Map();
  for (const ring of [outer, hole]) for (let i = 0; i < ring.length; i++) {
    const edge = [ring[i], ring[(i + 1) % ring.length]]; boundary.set(key(...edge), edge);
  }
  for (const [id, uses] of edges) {
    const edge = boundary.get(id);
    if (edge ? uses.length !== 1 || uses[0][0] !== edge[0] || uses[0][1] !== edge[1] : uses.length !== 2 || uses[0][0] !== uses[1][1] || uses[0][1] !== uses[1][0]) return false;
  }
  if ([...boundary.keys()].some(id => !edges.has(id))) return false;
  const uniqueEdges = [...edges.values()].map(uses => uses[0]);
  if (uniqueEdges.some(([a, b], i) => !clearDiagonal(a, b, points, uniqueEdges.slice(i + 1), epsilon))) return false;
  return Math.abs(actualArea - area) <= epsilon * points.length;
}

// One simple outer ring plus at most one simple, strictly interior polygon.
// A visible bridge is only a triangulation device, never an authored edge.
export function triangulateReferenceProfile(outerPoints, holePoints = null) {
  const points = [...outerPoints, ...(holePoints ?? [])];
  const span = Math.max(...[0, 1].map(axis => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]))));
  const epsilon = span * span * 1e-12;
  if (!span) reject('Collinear or numerically ambiguous corners are unsupported; simplify the outline');
  const outer = outerPoints.map((_, i) => i), hole = (holePoints ?? []).map((_, i) => i + outer.length);
  const outerArea = validateRing(points, outer, epsilon, 'Outer');
  if (outerArea < 0) outer.reverse();
  if (!hole.length) {
    const caps = clipEars(points, outer, epsilon);
    if (!caps) reject('Profile cannot be triangulated reliably at this precision; simplify the outline');
    return { points, rings: [outer], caps, outerArea, holeArea: 0, area: Math.abs(outerArea) / 2 };
  }
  const holeArea = validateRing(points, hole, epsilon, 'Cutout');
  if (holeArea > 0) hole.reverse();
  const boundary = [outer, hole].flatMap(ring => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]));
  for (const a of outer) for (const b of hole) {
    const nextA = outer[(outer.indexOf(a) + 1) % outer.length], nextB = hole[(hole.indexOf(b) + 1) % hole.length];
    if (intersects(points[a], points[nextA], points[b], points[nextB], epsilon)) reject('Cutout must be strictly inside the outer profile: rings intersect, touch or are numerically ambiguous');
  }
  if (hole.some(i => membership(points[i], points, outer, epsilon) !== 'inside')) reject('Cutout must be strictly inside the outer profile');
  const area = (Math.abs(outerArea) - Math.abs(holeArea)) / 2;
  if (area <= epsilon) reject('Remaining profile area is zero or numerically ambiguous');
  // Deterministic shortest visible vertex bridge. The bounded search can reject
  // ambiguous input instead of repairing it or introducing inferred vertices.
  const candidates = outer.flatMap((a, oi) => hole.map((b, hi) => ({ a, b, oi, hi, distance: Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]) })));
  candidates.sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b);
  let attempts = 0;
  for (const { a, b, oi, hi } of candidates) {
    if (!clearDiagonal(a, b, points, boundary, epsilon)) continue;
    const middle = [0, 1].map(axis => (points[a][axis] + points[b][axis]) / 2);
    if (membership(middle, points, outer, epsilon) !== 'inside' || membership(middle, points, hole, epsilon) !== 'outside') continue;
    if (attempts++ === 8) break;
    const bridged = [...outer.slice(0, oi + 1), ...hole.slice(hi), ...hole.slice(0, hi + 1), a, ...outer.slice(oi + 1)];
    const caps = clipEars(points, bridged, epsilon);
    if (caps && verifyCaps(points, outer, hole, caps, epsilon, area)) return { points, rings: [outer, hole], caps, outerArea, holeArea, area };
  }
  reject('Cutout profile cannot be triangulated reliably at this precision; simplify or separate ambiguous corners');
}
