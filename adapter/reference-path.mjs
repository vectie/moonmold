import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { resolveReferenceEndpoint } from './reference-measurement.mjs';

export const PATH_CONTRACT = 'moonmold.reference-vertex-path.v1';
export const PATH_MAX_ENDPOINTS = 64;
// One shared contract bound for the exact pretty-printed downloadable observation.
export const PATH_MAX_OBSERVATION_BYTES = 1_000_000;
const reject = message => { throw new AdapterRejection('invalid-reference-path', message); };

// Observe the supplied order only. The composer and shared endpoint resolver own
// unit conversion, placed geometry and imported/part-selected vertex indexing.
export function measureReferencePath(input) {
  const fields = ['layout', 'endpoints', 'closed', 'expected_layout_sha256', 'expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) reject('Path observation has invalid or unknown fields');
  if (!Array.isArray(input.endpoints) || input.endpoints.length < 2 || input.endpoints.length > PATH_MAX_ENDPOINTS) reject('Choose 2 through 64 ordered endpoints');
  if (input.closed !== undefined && typeof input.closed !== 'boolean') reject('closed must be a boolean');
  for (const key of ['expected_layout_sha256', 'expected_geometry_sha256']) {
    if (typeof input[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input[key])) reject(`${key} must bind the ordered choices to the current composition`);
  }
  const composed = composeReferenceLayout(input.layout);
  if (input.expected_layout_sha256 !== composed.layout_sha256 || input.expected_geometry_sha256 !== composed.geometry_sha256) reject('Stale path selection: layout or geometry changed; select the path again');
  const endpoints = input.endpoints.map((value, index) => resolveReferenceEndpoint(composed, value, `endpoints[${index}]`));
  const closed = input.closed ?? false, segments = [];
  let total = 0;
  for (let index = 0; index < endpoints.length - 1 + Number(closed); index++) {
    const next = (index + 1) % endpoints.length;
    const delta = endpoints[next].coordinates_mm.map((value, axis) => value - endpoints[index].coordinates_mm[axis]);
    const length = Math.hypot(...delta);
    total += length;
    if (!Number.isFinite(length) || !Number.isFinite(total)) reject('Path length is not finite at the represented coordinate precision');
    segments.push({ index, from_endpoint_index: index, to_endpoint_index: next,
      closing: next === 0, delta_mm: delta, length_mm: length, cumulative_length_mm: total });
  }
  const report = {
    contract_id: PATH_CONTRACT, layout_name: composed.layout.name,
    layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
    measurement_kind: 'ordered-straight-segment-path', units: 'mm',
    frame: 'placed layout XYZ; Z is the grounding axis', closed,
    endpoint_count: endpoints.length, segment_count: segments.length,
    endpoints, segments, total_length_mm: total, transform_order: composed.transform_order,
    physical_authority: false,
    qualification: 'Descriptive sum of straight 3D segments between ordered placed reference vertices only. Not a surface or geodesic distance, shortest route, mesh edge traversal, clearance, tolerance, engineering or physical-suitability assessment, or a human review.',
    limitations: [
      'Order and repeated endpoints are preserved. Coincident consecutive points contribute zero length. Closing adds a final last-to-first segment even if the last point already equals the first; no deduplication, sorting or topology inference occurs.',
      'Zero-based local indices use the current imported/part-selected order, including retained unreferenced vertices. STL vertices may repeat per triangle. Segments can cross empty space and distinct instances.',
      'IEEE double precision and represented source precision apply; a zero segment can reflect coordinate precision. No tolerance or accuracy guarantee is inferred.',
      'This separate observation binds the exact full layout, geometry, source identities and placements. Save the editable layout too. Source, part selection or placement changes require a fresh observation; the saved layout schema is unchanged.',
    ],
  };
  if (Buffer.byteLength(JSON.stringify(report, null, 2) + '\n', 'utf8') > PATH_MAX_OBSERVATION_BYTES) reject('Path observation exceeds 1000000 bytes; reduce ordered endpoints or selected parts');
  return report;
}
