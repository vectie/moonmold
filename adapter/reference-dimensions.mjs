import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { resolveReferenceEndpoint } from './reference-measurement.mjs';
import { drawComposedReferenceLayout } from './reference-drawing.mjs';

export const DIMENSIONS_CONTRACT = 'moonmold.reference-dimensions.v1';
export const DIMENSIONS_MAX_FILE_BYTES = 32000;
export const DIMENSIONS_MAX_REQUEST_BYTES = 3_100_000;
const reject = message => { throw new AdapterRejection('invalid-reference-dimensions', message); };
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) reject(`${label} has invalid or unknown fields`);
}

// The companion is an observation set, never an editable geometry or tolerance source.
export function drawReferenceDimensions(input) {
  object(input, ['layout', 'dimensions'], 'dimension drawing request');
  const set = input.dimensions;
  object(set, ['contract_id', 'expected_layout_sha256', 'expected_geometry_sha256', 'dimensions'], 'dimension set');
  if (set.contract_id !== DIMENSIONS_CONTRACT) reject(`contract_id must be ${DIMENSIONS_CONTRACT}`);
  if (Buffer.byteLength(JSON.stringify(set)) > DIMENSIONS_MAX_FILE_BYTES) reject('Dimension set exceeds 32000 bytes');
  for (const key of ['expected_layout_sha256', 'expected_geometry_sha256']) {
    if (typeof set[key] !== 'string' || !/^[a-f0-9]{64}$/.test(set[key])) reject(`${key} must bind the named endpoint choices to the current layout`);
  }
  if (!Array.isArray(set.dimensions) || set.dimensions.length < 1 || set.dimensions.length > 12) reject('Dimension set needs 1 through 12 named pairs');
  const composed = composeReferenceLayout(input.layout);
  if (set.expected_layout_sha256 !== composed.layout_sha256 || set.expected_geometry_sha256 !== composed.geometry_sha256) reject('Stale dimension set: layout or geometry changed; inspect and select the named endpoints again');
  const names = new Set();
  const dimensions = set.dimensions.map((item, i) => {
    object(item, ['name', 'endpoint_a', 'endpoint_b'], `dimension ${i + 1}`);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name !== item.name.trim() || item.name.length > 60 || /[\x00-\x1f\x7f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(item.name)) reject('Dimension name needs 1–60 characters of XML-compatible text without outer whitespace or ASCII control characters');
    if (names.has(item.name)) reject(`Duplicate dimension name: ${item.name}`);
    names.add(item.name);
    let a, b;
    try {
      a = resolveReferenceEndpoint(composed, item.endpoint_a, `dimension ${i + 1}.endpoint_a`);
      b = resolveReferenceEndpoint(composed, item.endpoint_b, `dimension ${i + 1}.endpoint_b`);
    } catch (error) { if (error instanceof AdapterRejection) reject(error.message); throw error; }
    const delta = b.coordinates_mm.map((n, axis) => n - a.coordinates_mm[axis]);
    return { id: `D${i + 1}`, name: item.name, endpoint_a: a, endpoint_b: b,
      delta_b_minus_a_mm: { x: delta[0], y: delta[1], z: delta[2] }, distance_mm: Math.hypot(...delta) };
  });
  const dimensionSet = { contract_id: DIMENSIONS_CONTRACT,
    expected_layout_sha256: composed.layout_sha256, expected_geometry_sha256: composed.geometry_sha256,
    dimensions: set.dimensions.map(item => ({ name: item.name,
      endpoint_a: { instance_id: item.endpoint_a.instance_id, vertex_index: item.endpoint_a.vertex_index },
      endpoint_b: { instance_id: item.endpoint_b.instance_id, vertex_index: item.endpoint_b.vertex_index } })) };
  const report = drawComposedReferenceLayout(composed, {
    contract_id: 'moonmold.reference-dimension-drawing.v1', representation: 'reference-layout-named-dimension-drawing',
    dimension_set_sha256: createHash('sha256').update(canonicalJson(dimensionSet)).digest('hex'),
    dimension_count: dimensions.length, dimensions,
    named_dimension_policy: 'True Euclidean 3D distance and signed world-axis B minus A deltas between selected retained vertices. Dashed SVG lines are 2D projections and may collapse or overlap; not minimum mesh separation, clearance, tolerance or accuracy evidence.',
    dimension_precision: 'IEEE double precision and source precision apply. Labels use 9 significant digits; exact doubles and endpoint provenance are retained in metadata.',
  });
  report.exports.dimensions = JSON.stringify(dimensionSet, null, 2) + '\n';
  return report;
}
