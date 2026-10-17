import { AdapterRejection } from './protocol.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-svg-path', message); };
const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
const midpoint = (a, b) => [a[0] / 2 + b[0] / 2, a[1] / 2 + b[1] / 2];
export const PATH_ALGORITHM = 'absolute-bezier-de-casteljau-control-hull.v1';

/** One explicitly closed contour, absolute M/L/Q/C/Z only; no geometry repair. */
export function parseAbsolutePath(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 100000) reject('Path d must contain 1–100000 characters');
  const tokens = [], token = /[MLQCZ]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
  let offset = 0, previous = null;
  while (offset < raw.length) {
    const gap = /^[\t\n\r ]*(?:,[\t\n\r ]*)?/.exec(raw.slice(offset))[0];
    if (gap.includes(',') && (previous === null || typeof previous === 'string')) reject('Unexpected comma in path');
    offset += gap.length;
    if (offset === raw.length) { if (gap.includes(',')) reject('Trailing path comma'); break; }
    token.lastIndex = offset; const match = token.exec(raw);
    if (!match) reject('Only absolute M/L/Q/C/Z and finite numeric parameters are supported');
    const value = match[0]; offset = token.lastIndex;
    if (/^[MLQCZ]$/.test(value)) {
      if (gap.includes(',')) reject('Comma cannot precede a path command');
      tokens.push(value);
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) reject('Path coordinate overflows or underflows binary64');
      tokens.push(n);
    }
    previous = tokens.at(-1);
    if (tokens.length > 4096) reject('Path exceeds 4096 tokens');
  }
  if (tokens[0] !== 'M' || tokens.at(-1) !== 'Z') reject('Path must start with absolute M and end with explicit Z');
  let i = 1;
  const pair = () => {
    if (typeof tokens[i] !== 'number' || typeof tokens[i + 1] !== 'number') reject('Incomplete path coordinate pair');
    return [tokens[i++], tokens[i++]];
  };
  const start = pair(), segments = []; let current = start, command = 'L';
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') {
      command = tokens[i++];
      if (command === 'M') reject('Multiple contours/subpaths are unsupported');
      if (command === 'Z') {
        if (i !== tokens.length) reject('Z must close the only contour at the end');
        break;
      }
      if (typeof tokens[i] !== 'number') reject('Path command requires complete parameters');
    }
    const controls = [current];
    for (let n = 0; n < { L: 1, Q: 2, C: 3 }[command]; n++) controls.push(pair());
    if (controls.every(point => equal(point, current))) reject('Zero-length path segment is unsupported');
    segments.push({ command, controls }); current = controls.at(-1);
    if (segments.length > 512) reject('Path exceeds 512 source segments');
  }
  if (!segments.length) reject('Path must contain drawing segments');
  return { start, segments, closed: true };
}

function distanceToChord(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function split(controls) {
  const left = [controls[0]], right = [controls.at(-1)]; let row = controls;
  while (row.length > 1) { row = row.slice(1).map((point, i) => midpoint(row[i], point)); left.push(row[0]); right.unshift(row.at(-1)); }
  return [left, right];
}

function hull(points) {
  const unique = points.filter((p, i) => !points.slice(0, i).some(q => equal(p, q))).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = rows => { const out = []; for (const p of rows) { while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop(); out.push(p); } return out; };
  return unique.length <= 2 ? unique : [...half(unique).slice(0, -1), ...half([...unique].reverse()).slice(0, -1)];
}

// Conservative topology gate: accepted Bezier control hulls must separate.
// Neighbouring leaves may share only their common endpoint. This rejects
// ambiguous near contacts rather than hiding a source loop inside a coarse chord.
function separateHulls(a, b, shared, guard) {
  const axes = [];
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy);
    if (length) { axes.push([-dy / length, dx / length]); if (polygon.length === 2) axes.push([dx / length, dy / length]); }
  }
  for (const axis of axes) {
    const project = p => p[0] * axis[0] + p[1] * axis[1], aa = a.map(project), bb = b.map(project);
    const amin = Math.min(...aa), amax = Math.max(...aa), bmin = Math.min(...bb), bmax = Math.max(...bb);
    if (bmin - amax > guard || amin - bmax > guard) return true;
    if (!shared) continue;
    const onlyShared = (polygon, values, edge) => polygon.every((p, i) => Math.abs(values[i] - edge) > guard || Math.hypot(p[0] - shared[0], p[1] - shared[1]) <= guard);
    if (amax <= bmin && (onlyShared(a, aa, amax) || onlyShared(b, bb, bmin))) return true;
    if (bmax <= amin && (onlyShared(b, bb, bmax) || onlyShared(a, aa, amin))) return true;
  }
  return false;
}

/** Deterministic left-first subdivision in selected units. The Bezier convex
 * hull lies in the endpoint chord's control-point-distance capsule. */
export function flattenAbsolutePath(parsed, { scale, units, max_error }) {
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[units];
  if (typeof factor !== 'number') reject('Explicit units required: mm, cm, m or in');
  if (typeof max_error !== 'number' || !Number.isFinite(max_error) || max_error * factor < 1e-6 || max_error * factor > 1e6) reject('Path max_error must be explicit, positive and between 0.000001 and 1000000 mm in selected units');
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) reject('Path scale must be positive and finite');
  const convert = point => point.map(n => {
    const result = n * scale;
    if (!Number.isFinite(result) || Math.abs(result * factor) > 1e6 || n !== 0 && result === 0) reject('Scaled path controls must stay within ±1000000 mm without underflow');
    return result === 0 ? 0 : result;
  });
  const segments = parsed.segments.map(segment => ({ ...segment, controls: segment.controls.map(convert) }));
  const magnitude = Math.max(1 / factor, ...segments.flatMap(segment => segment.controls.flat().map(Math.abs)));
  const numericalGuard = magnitude * Number.EPSILON * 128;
  if (numericalGuard >= max_error / 4) reject('Requested path tolerance is too small for these coordinates in binary64');
  const points = [convert(parsed.start)], lineage = [], leaves = []; let maxBound = 0;
  const append = (controls, sourceSegment, t0, t1, bound) => {
    const point = controls.at(-1);
    if (equal(point, points.at(-1))) reject('Flattening produced duplicate points; choose a different source/tolerance explicitly');
    points.push(point); lineage.push({ source_segment: sourceSegment, t0, t1, control_hull_bound: bound });
    leaves.push(controls);
    maxBound = Math.max(maxBound, bound);
    if (points.length > 129) reject('Path tolerance requires more than 128 profile vertices; tolerance is never relaxed automatically');
  };
  const visit = (controls, depth, sourceSegment, t0, t1) => {
    const bound = Math.max(0, ...controls.slice(1, -1).map(p => distanceToChord(p, controls[0], controls.at(-1)))) + numericalGuard;
    const delta = [controls.at(-1)[0] - controls[0][0], controls.at(-1)[1] - controls[0][1]];
    const monotone = !equal(controls[0], controls.at(-1)) && controls.slice(1).every((p, i) => (p[0] - controls[i][0]) * delta[0] + (p[1] - controls[i][1]) * delta[1] >= 0);
    if (bound <= max_error && monotone) { append(controls, sourceSegment, t0, t1, bound); return; }
    if (depth >= 16) reject('Path tolerance exceeds the 16-level subdivision bound');
    const [left, right] = split(controls), middle = (t0 + t1) / 2;
    visit(left, depth + 1, sourceSegment, t0, middle); visit(right, depth + 1, sourceSegment, middle, t1);
  };
  for (const [index, segment] of segments.entries()) visit(segment.controls, 0, index + 1, 0, 1);
  const repeated = equal(points[0], points.at(-1)); if (repeated) points.pop();
  if (points.length < 3 || points.length > 128) reject('Flattened path needs 3–128 profile vertices');
  if (!repeated) leaves.push([points.at(-1), points[0]]);
  const hulls = leaves.map(hull);
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const shared = j === i + 1 ? leaves[i].at(-1) : i === 0 && j === leaves.length - 1 ? points[0] : null;
    if (!separateHulls(hulls[i], hulls[j], shared, numericalGuard)) reject('Path control hulls cross, touch or are too close to establish a simple contour; use a finer explicit tolerance or revise the source');
  }
  return { points, removed_closing_endpoint: repeated, approximation: { algorithm: PATH_ALGORITHM, units, max_error, numerical_guard: numericalGuard,
    maximum_accepted_bound: maxBound, source_segment_count: segments.length, flattened_segment_count: lineage.length + (repeated ? 0 : 1), vertex_count: points.length,
    maximum_depth: 16, maximum_vertices: 128, segment_mapping: lineage,
    closing_segment: repeated ? 'Final source segment returns to start' : 'Explicit Z contributes one exact closing line',
    topology_check: 'Each accepted leaf is monotone along its chord; pairwise control hulls separate except shared adjacent endpoints. Ambiguous contacts reject conservatively.',
    error_definition: 'Maximum Euclidean distance to each accepted endpoint chord is bounded by the Bezier control hull, plus binary64 guard, in selected units. Original decimal coordinates and arithmetic are binary64, not certified engineering tolerances.' } };
}
