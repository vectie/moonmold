import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-envelope-fit', message); };
const center = bounds => bounds.min.map((n, i) => (n + bounds.max[i]) / 2);

// One bounded placement edit, not a persistent constraint solver. The envelope
// follows world XYZ, and its center is the selected instance's current AABB center.
export function fitReferenceEnvelope(input) {
  const fields = ['layout', 'instance_id', 'size_mm', 'allow_enlarge', 'expected_layout_sha256', 'expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) reject('Unknown envelope-fit request field');
  if (!Array.isArray(input.size_mm) || input.size_mm.length !== 3 || input.size_mm.some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e9)) reject('Envelope XYZ dimensions must be finite positive millimetres, at most 1000000000');
  if (typeof input.allow_enlarge !== 'boolean') reject('allow_enlarge must be boolean');
  const before = composeReferenceLayout(input.layout);
  if (input.expected_layout_sha256 !== before.layout_sha256 || input.expected_geometry_sha256 !== before.geometry_sha256) reject('Envelope fit requires the current layout and geometry identities');
  const part = before.parts.find(item => item.id === input.instance_id);
  if (!part) reject('Choose an existing instance');
  const ratios = part.bounds.size.map((size, i) => size > 0 ? input.size_mm[i] / size : Infinity);
  let factor = Math.min(...ratios);
  if (!Number.isFinite(factor)) reject('Selected reference has no nonzero dimension');
  if (!input.allow_enlarge) factor = Math.min(1, factor);
  const candidate = structuredClone(before.layout);
  const item = candidate.instances.find(item => item.id === input.instance_id);
  const originalCenter = center(part.bounds);
  if (factor !== 1) {
    item.transform.scale *= factor;
    // Recompose instead of assuming a pivot: existing center/ground transforms
    // change the pivot, and their exact semantics must remain intact.
    const scaled = composeReferenceLayout(candidate);
    const scaledPart = scaled.parts.find(item => item.id === input.instance_id);
    const scaledCenter = center(scaledPart.bounds);
    item.transform.translation_mm = item.transform.translation_mm.map((n, i) => n + originalCenter[i] - scaledCenter[i]);
  }
  const next = composeReferenceLayout(candidate);
  const after = next.parts.find(item => item.id === input.instance_id);
  const tolerance = Math.max(1, ...originalCenter.map(Math.abs), ...input.size_mm) * Number.EPSILON * 32;
  if (after.bounds.size.some((size, i) => size > input.size_mm[i] + tolerance) || center(after.bounds).some((n, i) => Math.abs(n - originalCenter[i]) > tolerance)) reject('Fit cannot be represented accurately at these coordinates');
  next.envelope_fit = {
    contract_id: 'moonmold.reference-envelope-fit.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: next.layout_sha256, geometry_sha256: next.geometry_sha256,
    instance_id: part.id, frame: 'world-xyz-mm', size_mm: [...input.size_mm], center_mm: originalCenter,
    allow_enlarge: input.allow_enlarge, scale_factor: factor,
    before_size_mm: part.bounds.size, after_size_mm: after.bounds.size,
    remaining_space_mm: after.bounds.size.map((n, i) => input.size_mm[i] - n),
    physical_authority: false,
    qualification: 'One-time uniform placement fit to a world-axis bounding envelope. Includes all imported vertices. No collision, tolerance, persistent constraint, engineering or fabrication qualification.',
  };
  return next;
}
