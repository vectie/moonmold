import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const VOLUME_CONTRACT = 'moonmold.reference-shell-volume.v1';
export const VOLUME_MAX_REQUEST_BYTES = 3_100_000;
const reject = message => { throw new AdapterRejection('invalid-reference-volume', message); };
const sum = () => {
  let value = 0, correction = 0;
  return { add(n) { const a = n - correction, b = value + a; correction = (b - value) - a; value = b; }, get: () => value };
};

// Observation only. Exact coordinate matching supports triangle-soup STL but
// never modifies source topology or welds a saved/editable representation.
function inspectPart(composed, part) {
  const points = [], indices = new Map(), faces = [], edges = new Map();
  for (let i = part.triangle_range.start; i < part.triangle_range.start + part.triangle_range.count; i++) {
    const face = composed.triangles[i].map(index => {
      const point = composed.vertices[index], key = point.join(',');
      if (!indices.has(key)) { indices.set(key, points.length); points.push(point); }
      return indices.get(key);
    });
    const faceIndex = faces.length; faces.push(face);
    for (let edge = 0; edge < 3; edge++) {
      const a = face[edge], b = face[(edge + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ face: faceIndex, direction: a < b ? 1 : -1 });
    }
  }
  let boundary = 0, nonmanifold = 0, inconsistent = 0;
  const parent = faces.map((_, i) => i);
  function root(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  for (const uses of edges.values()) {
    if (uses.length === 1) boundary++;
    if (uses.length > 2) nonmanifold++;
    if (uses.length === 2 && uses[0].direction === uses[1].direction) inconsistent++;
    for (let i = 1; i < uses.length; i++) parent[root(uses[i].face)] = root(uses[0].face);
  }
  const result = { instance_id: part.id, source_sha256: part.source_sha256,
    source_format: part.source_format, source_units: part.source_units,
    transform: structuredClone(part.transform), source_losses: [...part.losses],
    triangle_count: faces.length, topology: { boundary_edges: boundary, nonmanifold_edges: nonmanifold,
      inconsistent_edges: inconsistent, matching: 'exact-placed-coordinate-edges; no tolerance or source repair' } };
  if (boundary || nonmanifold || inconsistent) return { ...result, status: 'unavailable-topology', components: [], shell_sum_volume_mm3: null, volume_centroid_mm: null };
  const groups = new Map();
  faces.forEach((face, i) => { const key = root(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(face); });
  const components = [];
  for (const triangles of groups.values()) {
    const origin = points[triangles[0][0]], volume = sum(), moments = [sum(), sum(), sum()];
    for (const face of triangles) {
      const [a, b, c] = face.map(index => points[index].map((x, axis) => x - origin[axis]));
      const six = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      volume.add(six / 6);
      moments.forEach((moment, axis) => moment.add(six / 24 * (a[axis] + b[axis] + c[axis])));
    }
    const signed = volume.get(), centroid = moments.map((moment, axis) => origin[axis] + moment.get() / signed);
    if (!Number.isFinite(signed) || signed === 0 || centroid.some(x => !Number.isFinite(x))) {
      return { ...result, status: 'unavailable-zero-or-nonfinite-volume', components: [], shell_sum_volume_mm3: null, volume_centroid_mm: null };
    }
    components.push({ component: components.length + 1, triangle_count: triangles.length,
      signed_volume_mm3: signed, absolute_algebraic_volume_mm3: Math.abs(signed),
      volume_centroid_mm: centroid, winding: signed > 0 ? 'positive' : 'negative' });
  }
  const total = sum(), moments = [sum(), sum(), sum()];
  for (const component of components) { total.add(component.absolute_algebraic_volume_mm3); moments.forEach((m, axis) => m.add(component.volume_centroid_mm[axis] * component.absolute_algebraic_volume_mm3)); }
  const value = total.get(), centroid = moments.map(m => m.get() / value);
  if (!Number.isFinite(value) || centroid.some(x => !Number.isFinite(x))) reject('Volume accumulation overflows');
  return { ...result, status: 'algebraic-shell-estimate', components,
    shell_sum_volume_mm3: value, volume_centroid_mm: centroid };
}

export function measureReferenceVolume(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['layout', 'instance_ids'].includes(key))) reject('Volume request accepts only layout and instance_ids');
  const ids = input.instance_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) reject('Choose 1 through 16 unique existing instance IDs');
  const composed = composeReferenceLayout(input.layout);
  if (ids.some(id => !composed.parts.some(part => part.id === id))) reject('Every selected instance ID must exist in this layout');
  const parts = composed.parts.filter(part => ids.includes(part.id)).map(part => inspectPart(composed, part));
  const complete = parts.every(part => part.status === 'algebraic-shell-estimate');
  const total = complete ? parts.reduce((n, part) => n + part.shell_sum_volume_mm3, 0) : null;
  if (total !== null && !Number.isFinite(total)) reject('Volume sum overflows');
  const report = { contract_id: VOLUME_CONTRACT, layout_name: composed.layout.name,
    layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
    instance_ids: parts.map(part => part.instance_id), instance_count: parts.length,
    measurement_kind: 'sum-of-absolute-algebraic-shell-volumes', status: complete ? 'algebraic-shell-estimate' : 'partial-unavailable',
    parts, shell_sum_volume_mm3: total, shell_sum_volume_m3: total === null ? null : total / 1e9,
    physical_authority: false,
    qualification: 'Algebraic closed-shell estimate only. Not Boolean union, cavity-aware volume, mass, capacity, watertightness certification or manufacturing evidence.',
    limitations: [
      'Every edge-connected shell contributes the absolute value of its signed tetrahedral volume. Reversing the whole shell reverses signed volume but preserves its absolute estimate and centroid.',
      'Nested, overlapping, coincident or separate shells and instances count independently. Cavities are not subtracted, overlaps are not removed, and no collision or self-intersection test is performed. Even a closed consistently oriented mesh may self-intersect, so these values are algebraic estimates, not certified enclosed solids.',
      'Exact placed-coordinate edge matching supports separate but equal STL vertices; no tolerance-based welding, hole filling, normal repair or change to editable sources occurs. Every edge must occur twice with opposite directions. Open, nonmanifold or inconsistently wound parts retain unavailable results while other parts remain inspectable.',
      'Volume centroid assumes the represented shell volume without material density and is not a mass center. IEEE double precision, source triangulation and import losses apply; zero or nonfinite volume is unavailable. No accuracy or physical suitability guarantee.',
      'The report binds the full applied layout and geometry. Save the editable layout separately and recalculate after source, selection, scale or placement edits.',
    ] };
  const columns = ['contract_id', 'layout_sha256', 'geometry_sha256', 'instance_id', 'status', 'source_sha256', 'shell_count', 'shell_sum_volume_mm3', 'centroid_x_mm', 'centroid_y_mm', 'centroid_z_mm', 'boundary_edges', 'nonmanifold_edges', 'inconsistent_edges', 'physical_authority'];
  const rows = parts.map(part => [VOLUME_CONTRACT, report.layout_sha256, report.geometry_sha256, part.instance_id, part.status, part.source_sha256, part.components.length,
    part.shell_sum_volume_mm3 ?? '', ...(part.volume_centroid_mm ?? ['', '', '']), part.topology.boundary_edges, part.topology.nonmanifold_edges, part.topology.inconsistent_edges, false]);
  return { ...report, exports: { json: JSON.stringify(report, null, 2) + '\n',
    csv: [columns, ...rows].map(row => row.join(',')).join('\r\n') + '\r\n' } };
}
