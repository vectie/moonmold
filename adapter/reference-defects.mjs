import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { transformReferenceMesh } from './reference-workbench.mjs';
import { drawComposedReferenceLayout } from './reference-drawing.mjs';
export const DEFECT_MAX_REQUEST_BYTES = 3_100_000;
export const DEFECT_MAX_EDGES = 256;
const reject = message => { throw new AdapterRejection('invalid-reference-defects', message); };

// Same exact placed-coordinate criterion as reference-volume. This observes
// triangle incidence; it neither merges editable vertices nor repairs topology.
export function locateReferenceDefects(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['layout','instance_id'].includes(k))) reject('Accepts only layout and instance_id');
  const composed = composeReferenceLayout(input.layout);
  const part = composed.parts.find(p => p.id === input.instance_id);
  if (!part) reject('Select one existing retained instance');
  const original = composed.layout.instances.find(p => p.id === part.id);
  const mesh = transformReferenceMesh({ ...original.source, transform: original.transform });
  const faceMap = new Map((mesh.source_faces ?? []).map(f => [f.source_face_index, f]));
  const edges = new Map();
  mesh.triangles.forEach((face, triangle_index) => {
    for (let i = 0; i < 3; i++) {
      const local = [face[i], face[(i + 1) % 3]], points = local.map(v => mesh.vertices[v]);
      const keys = points.map(p => p.join(',')), forward = keys[0] < keys[1];
      const key = (forward ? keys : [...keys].reverse()).join('|');
      if (!edges.has(key)) edges.set(key, { coordinates_mm: forward ? points : [...points].reverse(), uses: [] });
      const sourceFace = faceMap.get(mesh.triangle_source_faces?.[triangle_index]);
      edges.get(key).uses.push({ triangle_index, local_vertex_indices: local,
        source_locator: sourceFace ? { kind: 'original-obj', face_index: sourceFace.source_face_index,
          line: sourceFace.source_line, vertex_indices: local.map(v => mesh.source_vertex_indices[v]),
          obj_vertex_numbers: local.map(v => mesh.source_vertex_indices[v] + 1), object_id: sourceFace.object_id,
          group_ids: sourceFace.group_ids } : { kind: 'retained-triangulation-only', triangle_index,
          vertex_indices: local, original_face_mapping: 'unavailable' }, direction: forward ? 1 : -1 });
    }
  });
  const defects = [];
  let useCount = 0;
  for (const edge of edges.values()) {
    const kind = edge.uses.length === 1 ? 'boundary' : edge.uses.length > 2 ? 'nonmanifold' : edge.uses[0].direction === edge.uses[1].direction ? 'inconsistent' : null;
    if (!kind) continue;
    useCount += edge.uses.length;
    if (defects.length >= DEFECT_MAX_EDGES || useCount > 4096) reject('Navigation limited to 256 defect edges and 4096 incident triangle uses; isolate a smaller source selection in the original modeling tool');
    defects.push({ id: `E${defects.length + 1}`, kind, ...edge });
  }
  const report = { contract_id: 'moonmold.reference-defect-navigation.v1', instance_id: part.id,
    source_sha256: part.source_sha256, source_format: part.source_format, source_units: part.source_units,
    source_name: part.source_name, transform: part.transform, source_losses: part.losses,
    ...(part.selection ? { selection: part.selection } : {}),
    defect_count: defects.length, defects,
    counts: Object.fromEntries(['boundary','nonmanifold','inconsistent'].map(k => [k, defects.filter(e => e.kind === k).length])),
    locator_policy: 'All triangle/local vertex/OBJ face indices are zero-based; OBJ vertex numbers and source lines are one-based. Original OBJ locators include selected object/group remapping. Other formats expose retained triangulation only, never invented original face locators.',
    matching: 'exact-placed-coordinate-edges; no tolerance or source repair',
    qualification: 'Defect navigation only. No repair, watertightness, self-intersection, solid or physical qualification.',
    physical_authority: false };
  const drawing = drawComposedReferenceLayout(composed, report);
  const { exports, ...observation } = drawing;
  const json = JSON.stringify(observation, null, 2) + '\n';
  if (Buffer.byteLength(json) > 1_000_000 || Buffer.byteLength(exports.svg) > 4_000_000) reject('Defect observation exceeds 1000000 JSON or 4000000 SVG bytes; isolate a smaller source selection');
  return { ...observation, exports: { ...exports, json } };
}
