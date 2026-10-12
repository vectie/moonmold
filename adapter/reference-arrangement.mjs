import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { rotateReferencePoint, composeReferenceRotations } from './reference-rotation.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-arrangement', message); };
function vector(value, label, bounded = false) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || (bounded && Math.abs(n) > 1e9))) reject(`${label} needs three finite numbers${bounded ? ' within ±1000000000 mm' : ''}`);
  return [...value];
}

// One rigid world-space edit applied to a chosen set. The resulting document
// remains ordinary independent placements; neither source bytes nor schema change.
export function moveReferenceArrangement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['layout', 'instance_ids', 'pivot_mm', 'rotation_deg', 'translation_mm'].includes(key))) reject('Arrangement request has an invalid or unknown field');
  const { instance_ids } = input;
  if (!Array.isArray(instance_ids) || !instance_ids.length || instance_ids.length > 16 || instance_ids.some(id => typeof id !== 'string') || new Set(instance_ids).size !== instance_ids.length) reject('instance_ids needs 1–16 unique instance IDs');
  const pivot = vector(input.pivot_mm, 'pivot_mm', true);
  const rotation = vector(input.rotation_deg, 'rotation_deg');
  const translation = vector(input.translation_mm, 'translation_mm', true);
  const before = composeReferenceLayout(input.layout);
  if (instance_ids.some(id => !before.parts.some(part => part.id === id))) reject('Every chosen instance must exist in the layout');
  const chosen = new Set(instance_ids), changes = [];
  const noRotation = rotation.every(n => n % 360 === 0);
  const candidate = structuredClone(before.layout);
  for (let index = 0; index < candidate.instances.length; index++) {
    const item = candidate.instances[index];
    if (!chosen.has(item.id)) continue;
    const old = structuredClone(item.transform);
    if (noRotation) {
      // A pure translation keeps the existing Euler recipe byte-for-byte.
      item.transform.translation_mm = old.translation_mm.map((n, i) => n + translation[i]);
    } else {
      const angles = composeReferenceRotations(old.rotation_deg, rotation);
      const mesh = importReferenceMesh(item.source);
      const local = mesh.vertices.map(p => rotateReferencePoint(p.map(n => n * old.scale), angles));
      const min = [0,1,2].map(i => Math.min(...local.map(p => p[i])));
      const max = [0,1,2].map(i => Math.max(...local.map(p => p[i])));
      const ground = old.center_and_ground ? [-(min[0]+max[0])/2, -(min[1]+max[1])/2, -min[2]] : [0,0,0];
      const anchor = before.vertices[before.parts[index].vertex_range.start];
      const turned = rotateReferencePoint(anchor.map((n, i) => n - pivot[i]), rotation);
      const target = turned.map((n, i) => n + pivot[i] + translation[i]);
      item.transform.rotation_deg = angles;
      item.transform.translation_mm = target.map((n, i) => n - local[0][i] - ground[i]);
    }
    changes.push({ instance_id: item.id, before_transform: old, after_transform: structuredClone(item.transform) });
  }
  const result = composeReferenceLayout(candidate);
  result.arrangement = {
    contract_id: 'moonmold.reference-arrangement-edit.v1',
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    instance_ids: changes.map(change => change.instance_id), pivot_mm: pivot,
    rotation_deg: rotation, translation_mm: translation, instances: changes,
    frame: 'right-handed world XYZ in millimetres, Z-up',
    operation_order: 'Subtract shared pivot; rotate world X then Y then Z; add pivot; translate world XYZ',
    semantics: 'A one-time rigid edit of chosen placements. Embedded sources, selections, scale, center/ground preference and unchosen instances are retained. Euler rotation and translation recipes are recalculated; placements remain independently editable.',
    limits: ['IEEE double-precision coordinates and Euler decomposition may leave rounding residuals', 'No persistent grouping, constraints, collision, engineering or physical-suitability assessment', 'Save the inspection report for the edit recipe; editable layout stores the resulting placements only'],
    physical_authority: false,
  };
  return result;
}
