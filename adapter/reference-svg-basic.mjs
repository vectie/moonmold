import { AdapterRejection } from './protocol.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-svg-profile', message); };

// Inscribed equal-angle polygons: an ellipse is the affine image of a unit
// circle, so the largest radius times the circle sagitta bounds chord error.
export function flattenBasicEllipse(shape, { scale, units, max_error }) {
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[units];
  if (typeof factor !== 'number') reject('Explicit units required: mm, cm, m or in');
  if (typeof max_error !== 'number' || !Number.isFinite(max_error) || max_error * factor < 1e-6 || max_error * factor > 1e6) reject('Circle/ellipse max_error must be explicit and between 0.000001 and 1000000 mm in selected units');
  const [cx, cy, rx, ry] = [shape.cx, shape.cy, shape.rx, shape.ry].map(n => n * scale);
  if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0 || (Math.abs(cx) + rx) * factor > 1e6 || (Math.abs(cy) + ry) * factor > 1e6) reject('Scaled ellipse must have positive radii and stay within ±1000000 mm');
  const radius = Math.max(rx, ry);
  const guard = Math.max(1 / factor, Math.abs(cx) + rx, Math.abs(cy) + ry) * Number.EPSILON * 128;
  if (guard >= max_error / 4) reject('Requested ellipse tolerance is too small for these coordinates in binary64');
  let count = 4;
  const bound = n => 2 * radius * Math.sin(Math.PI / (2 * n)) ** 2 + guard;
  while (count <= 128 && bound(count) > max_error) count += 4;
  if (count > 128) reject('Circle/ellipse tolerance requires more than 128 profile vertices; tolerance is never relaxed automatically');
  const points = Array.from({ length: count }, (_, i) => {
    // Exact cardinal points retain source bounds rather than trig residuals.
    const quadrant = i * 4 / count;
    const cos = Number.isInteger(quadrant) ? [1, 0, -1, 0][quadrant] : Math.cos(2 * Math.PI * i / count);
    const sin = Number.isInteger(quadrant) ? [0, 1, 0, -1][quadrant] : Math.sin(2 * Math.PI * i / count);
    return [cx + rx * cos, cy + ry * sin];
  });
  return { points, removed_closing_endpoint: false, approximation: {
    algorithm: 'equal-angle-inscribed-ellipse.v1', units, max_error,
    numerical_guard: guard, maximum_accepted_bound: bound(count), vertex_count: count,
    maximum_vertices: 128, source_segment_count: 1,
    error_definition: 'Ellipse-to-chord Euclidean distance is bounded by max(scaled radii) times circle sagitta plus binary64 guard, in selected units. Not a certified engineering tolerance.',
  } };
}
