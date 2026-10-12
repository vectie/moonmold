import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const MEASUREMENT_CONTRACT = 'moonmold.reference-vertex-measurement.v1';
const reject = message => { throw new AdapterRejection('invalid-reference-measurement', message); };
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) reject(`${label} has invalid or unknown fields`);
}

// The composer is the single placement implementation. Local indices refer to
// its imported/part-selected vertex order, never a triangle index or a mesh gap.
export function measureReferenceLayout(input) {
  object(input, ['layout', 'endpoint_a', 'endpoint_b', 'expected_layout_sha256', 'expected_geometry_sha256'], 'measurement');
  for (const key of ['expected_layout_sha256', 'expected_geometry_sha256']) {
    if (typeof input[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input[key])) reject(`${key} must bind the endpoint choices to the current composition`);
  }
  const composed = composeReferenceLayout(input.layout);
  if (input.expected_layout_sha256 !== composed.layout_sha256 || input.expected_geometry_sha256 !== composed.geometry_sha256) reject('Stale endpoint selection: layout or geometry identity changed; inspect and select endpoints again');
  const a = resolveReferenceEndpoint(composed, input.endpoint_a, 'endpoint_a'), b = resolveReferenceEndpoint(composed, input.endpoint_b, 'endpoint_b');
  const delta = b.coordinates_mm.map((n, i) => n - a.coordinates_mm[i]);
  return {
    contract_id: MEASUREMENT_CONTRACT, layout_name: composed.layout.name,
    layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
    units: 'mm', frame: 'placed layout XYZ; Z is the grounding axis',
    endpoint_a: a, endpoint_b: b,
    delta_b_minus_a_mm: { x: delta[0], y: delta[1], z: delta[2] }, distance_mm: Math.hypot(...delta),
    transform_order: composed.transform_order, physical_authority: false,
    qualification: 'Descriptive distance between two selected retained reference vertices only. Not minimum mesh separation, collision, clearance, topology, engineering accuracy or physical suitability evidence.',
    limitations: ['Zero-based local vertex indices refer to the current imported/part-selected order, including retained unreferenced vertices; STL vertices may repeat per triangle.',
      'IEEE double precision and source precision apply; the result is computed from the represented coordinates, not a tolerance or accuracy guarantee.',
      'This separate observation is bound to the exact layout, geometry and source identities. Re-select and measure after changes; the saved layout schema is unchanged.']
  };
}

// Internal module helper: callers obtain composed exclusively from the composer.
export function resolveReferenceEndpoint(composed, value, label) {
  object(value, ['instance_id', 'vertex_index'], label);
  const part = composed.parts.find(item => item.id === value.instance_id);
  if (!part) reject(`${label}.instance_id must identify an existing instance`);
  if (!Number.isSafeInteger(value.vertex_index) || value.vertex_index < 0 || value.vertex_index >= part.vertex_range.count) reject(`${label}.vertex_index must be a zero-based integer from 0 to ${part.vertex_range.count - 1}`);
  const index = part.vertex_range.start + value.vertex_index;
  return {
    instance_id: part.id, vertex_index: value.vertex_index, layout_vertex_index: index,
    coordinates_mm: [...composed.vertices[index]], vertex_range: { ...part.vertex_range },
    source_name: part.source_name, source_format: part.source_format,
    ...(part.source_encoding ? { source_encoding: part.source_encoding } : {}),
    source_units: part.source_units, source_sha256: part.source_sha256,
    ...(part.selection ? { selection: structuredClone(part.selection), source_vertex_index: part.source_vertex_indices[value.vertex_index] } : {}),
    transform: structuredClone(part.transform), losses: [...part.losses]
  };
}
