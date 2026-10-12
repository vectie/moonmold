import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const SURFACE_AREA_CONTRACT = 'moonmold.reference-surface-area.v1';
export const SURFACE_AREA_MAX_REQUEST_BYTES = 3_100_000;
export const SURFACE_AREA_COLUMNS = Object.freeze([
  'contract_id', 'layout_sha256', 'geometry_sha256', 'instance_id',
  'source_sha256', 'source_format', 'source_units', 'triangle_count',
  'triangle_sum_area_mm2', 'triangle_sum_area_m2',
  'surface_centroid_x_mm', 'surface_centroid_y_mm', 'surface_centroid_z_mm', 'physical_authority',
]);
const reject = message => { throw new AdapterRejection('invalid-reference-surface-area', message); };

// Compensated sums reduce accumulation loss; they do not correct source or
// transformed-coordinate precision and are not an accuracy guarantee.
function sum() {
  let value = 0, correction = 0;
  return { add(next) { const adjusted = next - correction, total = value + adjusted; correction = (total - value) - adjusted; value = total; }, get: () => value };
}
function accumulator() {
  const area = sum(), moments = [sum(), sum(), sum()];
  let count = 0;
  return {
    add(weight, centroid) {
      count++;
      area.add(weight); centroid.forEach((coordinate, axis) => moments[axis].add(weight * coordinate));
    },
    result() {
      const total = area.get();
      return { triangle_count: count,
        triangle_sum_area_mm2: total, triangle_sum_area_m2: total / 1_000_000,
        surface_centroid_mm: moments.map(moment => moment.get() / total) };
    },
  };
}

// Observe the existing composer's placed triangles; never alter original
// sources, infer solids, weld coincident faces, or treat a bounding box as area.
export function measureReferenceSurfaceArea(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['layout', 'instance_ids'].includes(key))) reject('Surface-area request accepts only layout and instance_ids');
  const ids = input.instance_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) reject('Choose 1 through 16 unique existing instance IDs');
  const composed = composeReferenceLayout(input.layout);
  if (ids.some(id => !composed.parts.some(part => part.id === id))) reject('Every selected instance ID must exist in this layout');
  const chosen = new Set(ids), total = accumulator(), parts = [];
  for (const [index, part] of composed.parts.entries()) {
    if (!chosen.has(part.id)) continue;
    const measured = accumulator();
    for (let i = part.triangle_range.start; i < part.triangle_range.start + part.triangle_range.count; i++) {
      const [a, b, c] = composed.triangles[i].map(vertex => composed.vertices[vertex]);
      const u = b.map((n, axis) => n - a[axis]), v = c.map((n, axis) => n - a[axis]);
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
      if (!(area > 0) || !Number.isFinite(area)) reject('Triangle area is not positive and finite at this coordinate precision');
      const centroid = a.map((n, axis) => (n + b[axis] + c[axis]) / 3);
      measured.add(area, centroid); total.add(area, centroid);
    }
    const source = composed.layout.instances[index].source;
    parts.push({ instance_id: part.id, source_sha256: part.source_sha256,
      source_name: part.source_name, source_format: part.source_format, source_units: part.source_units,
      ...(source.part_ids ? { part_ids: [...source.part_ids] } : {}),
      ...(source.node_ids ? { node_ids: [...source.node_ids] } : {}),
      transform: structuredClone(part.transform), triangle_range: { ...part.triangle_range },
      ...measured.result(), source_losses: [...part.losses] });
  }
  const report = {
    contract_id: SURFACE_AREA_CONTRACT, layout_name: composed.layout.name,
    layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
    instance_ids: parts.map(part => part.instance_id), instance_count: parts.length,
    layout_instance_count: composed.instance_count, frame: 'placed layout XYZ; Z is the grounding axis',
    measurement_kind: 'unsigned-triangle-sum', parts, total: total.result(),
    physical_authority: false,
    qualification: 'Descriptive triangle-sum area only. Not exposed exterior area, material quantity, solid volume, mass, engineering accuracy or physical suitability evidence.',
    limitations: [
      'Each represented triangle is counted once regardless of winding. Duplicate, overlapping, internal and coincident faces count independently, including separate instances. No exterior-surface union or occlusion test is performed.',
      'An open sheet is counted as the sum of its faces, without an inferred second side, thickness, waste or material allowance. Source polygon triangulation and import losses apply.',
      'Unreferenced vertices contribute neither area nor surface centroid. The centroid is area-weighted over represented triangles, not a volume center of mass. Degenerate source or collapsed transformed triangles reject through the composer; nonpositive or nonfinite measured area also rejects.',
      'IEEE double and source precision apply. Measurement uses actual placed coordinates, so very small geometry at large translations may lose precision. Collapsed triangles reject instead of generating a schedule. No tolerance, repair or precision guarantee is inferred.',
      'This separate observation binds to the exact full layout and geometry, including unchosen instances. Save the editable layout too; remeasure after any source, selection or placement edit. CSV is a read-only schedule, not an editable layout.',
    ],
  };
  const rows = parts.map(part => [SURFACE_AREA_CONTRACT, report.layout_sha256, report.geometry_sha256,
    part.instance_id, part.source_sha256, part.source_format, part.source_units, part.triangle_count,
    part.triangle_sum_area_mm2, part.triangle_sum_area_m2,
    ...part.surface_centroid_mm, false]);
  // Only validated identifiers, hashes, numeric values and fixed literals are
  // emitted. Arbitrary source names are kept in JSON, never executable cells.
  return { ...report, exports: {
    json: JSON.stringify(report, null, 2) + '\n',
    csv: [SURFACE_AREA_COLUMNS, ...rows].map(row => row.join(',')).join('\r\n') + '\r\n',
  } };
}
