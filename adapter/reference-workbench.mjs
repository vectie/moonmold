import { importReferenceMesh, describeReferenceMesh } from "./reference-mesh.mjs";
import { AdapterRejection } from "./protocol.mjs";
import { rotateReferencePoint } from "./reference-rotation.mjs";

const reject = message => { throw new AdapterRejection("invalid-reference-transform", message); };
const vector = (value, label) => {
  if (!Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== "number" || !Number.isFinite(n))) reject(`${label} must contain three finite numbers`);
  return [...value];
};

// Every edit is evaluated from the original mesh, avoiding cumulative rounding.
// This is reference placement, never an engineering or semantic-scene mutation.
export function transformReferenceMesh(input = {}) {
  const source = importReferenceMesh(input);
  const edit = input.transform ?? {};
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) reject("transform must be an object");
  if (Object.keys(edit).some(key => !["scale", "rotation_deg", "translation_mm", "center_and_ground"].includes(key))) reject("Unknown transform field");
  const scale = edit.scale ?? 1;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 1e-6 || scale > 1e6) reject("scale must be between 0.000001 and 1000000");
  const rotation = vector(edit.rotation_deg ?? [0,0,0], "rotation_deg");
  const translation = vector(edit.translation_mm ?? [0,0,0], "translation_mm");
  const ground = edit.center_and_ground ?? false;
  if (typeof ground !== "boolean") reject("center_and_ground must be a boolean");
  let vertices = source.vertices.map(point => rotateReferencePoint(point.map(n => n * scale), rotation));
  const min = [0,1,2].map(axis => Math.min(...vertices.map(p => p[axis])));
  const max = [0,1,2].map(axis => Math.max(...vertices.map(p => p[axis])));
  const placement = ground ? [-(min[0]+max[0])/2, -(min[1]+max[1])/2, -min[2]] : [0,0,0];
  vertices = vertices.map(p => p.map((n,i) => n+placement[i]+translation[i]));
  if (vertices.some(p => p.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9))) reject("Edited coordinate exceeds reference range");
  // Tiny scales can collapse triangles at very large translations in IEEE doubles.
  for (const indices of source.triangles) {
    const [a,b,c] = indices.map(i => vertices[i]);
    const u = b.map((n,i) => n-a[i]), v = c.map((n,i) => n-a[i]);
    if (Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]) === 0) reject("Transform collapses a triangle at this coordinate precision");
  }
  return describeReferenceMesh(vertices, source.triangles, {
    contract_id: source.contract_id, name: source.name, representation: source.representation,
    source_format: source.source_format, source_units: source.source_units,
    ...(source.source_encoding ? { source_encoding: source.source_encoding } : {}),
    source_sha256: source.source_sha256, losses: source.losses,
    ...(source.obj_parts ? { source: source.source, obj_parts: source.obj_parts,
      source_faces: source.source_faces, source_vertex_indices: source.source_vertex_indices,
      triangle_source_faces: source.triangle_source_faces,
      ...(source.selection ? { selection: source.selection } : {}) } : {}),
    ...(source.glb_nodes ? { source: source.source, glb_nodes: source.glb_nodes,
      glb_scene_index: source.glb_scene_index, glb_node_ids: source.glb_node_ids,
      coordinate_mapping: source.coordinate_mapping } : {}),
    transform: { scale, rotation_deg: rotation, center_and_ground: ground, translation_mm: translation },
    transform_order: "uniform scale; rotate X, Y, Z about source origin; optional XY center and Z ground; translate",
    source_bounds: source.bounds,
  });
}
