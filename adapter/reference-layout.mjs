import { createHash } from "node:crypto";
import { AdapterRejection, canonicalJson } from "./protocol.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { describeReferenceMesh } from "./reference-mesh.mjs";

export const LAYOUT_CONTRACT = "moonmold.reference-layout.v1";
export const LAYOUT_MAX_JSON_BYTES = 2_000_000;
export const LAYOUT_MAX_FILE_BYTES = 3_000_000;
const reject = message => { throw new AdapterRejection("invalid-reference-layout", message); };
const hash = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
function object(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(`${label} must be an object`);
  if (Object.keys(value).some(key => !allowed.includes(key))) reject(`${label} has an unknown field`);
}
function identifier(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) reject(`${label} needs 1–80 alphanumeric, dot, dash or underscore characters, starting alphanumeric`);
}

// A portable editing document, with embedded original input rather than filesystem
// paths or fetched URLs. Recomposition always starts from each original source.
export function composeReferenceLayout(input) {
  object(input, ["contract_id", "name", "instances"], "layout");
  if (input.contract_id !== LAYOUT_CONTRACT) reject(`contract_id must be ${LAYOUT_CONTRACT}`);
  identifier(input.name, "layout name");
  if (!Array.isArray(input.instances) || input.instances.length < 1 || input.instances.length > 16) reject("layout needs 1 through 16 instances");
  if (Buffer.byteLength(JSON.stringify(input)) > LAYOUT_MAX_JSON_BYTES) reject("layout exceeds 2000000 compact JSON bytes");
  const vertices = [], triangles = [], parts = [], instances = [], ids = new Set();
  for (const item of input.instances) {
    object(item, ["id", "source", "transform"], "instance");
    identifier(item.id, "instance id");
    if (ids.has(item.id)) reject(`Duplicate instance id: ${item.id}`);
    ids.add(item.id);
    object(item.source, ["input_format", "units", "name", "text", "data_base64", "part_ids", "node_ids"], `source for ${item.id}`);
    if (!["obj", "stl", "ply", "glb"].includes(item.source.input_format)) reject(`${item.id}: source input_format must be obj, stl, ply or glb`);
    if (item.transform === null) reject(`${item.id}: transform must be an object`);
    let mesh;
    try { mesh = transformReferenceMesh({ ...item.source, transform: item.transform }); }
    catch (error) {
      if (error instanceof AdapterRejection) reject(`${item.id}: ${error.message}`);
      throw error;
    }
    if (vertices.length + mesh.vertex_count > 40_000 || triangles.length + mesh.triangle_count > 40_000) reject("Combined layout exceeds 40000 vertices or 40000 triangles");
    const vertexStart = vertices.length, triangleStart = triangles.length;
    for (const point of mesh.vertices) vertices.push(point);
    for (const face of mesh.triangles) triangles.push(face.map(index => index + vertexStart));
    // Explicitly copy recognized source fields; original bytes and source units
    // are preserved, including binary STL through canonical base64.
    const source = { input_format: mesh.source_format, units: mesh.source_units, name: mesh.name,
      ...(item.source.text !== undefined ? { text: item.source.text } : { data_base64: item.source.data_base64 }),
      ...(mesh.selection ? { part_ids: mesh.selection.part_ids } : {}),
      ...(mesh.glb_node_ids ? { node_ids: mesh.glb_node_ids } : {}) };
    instances.push({ id: item.id, source, transform: mesh.transform });
    parts.push({ id: item.id, source_name: mesh.name, source_format: mesh.source_format,
      ...(mesh.source_encoding ? { source_encoding: mesh.source_encoding } : {}),
      source_units: mesh.source_units, source_sha256: mesh.source_sha256,
      ...(mesh.glb_nodes ? { glb_nodes: mesh.glb_nodes, glb_scene_index: mesh.glb_scene_index,
        coordinate_mapping: mesh.coordinate_mapping } : {}),
      source_bounds: mesh.source_bounds, transform: mesh.transform,
      bounds: mesh.bounds, losses: mesh.losses,
      ...(mesh.selection ? { selection: mesh.selection, source_faces: mesh.source_faces,
        source_vertex_indices: mesh.source_vertex_indices, triangle_source_faces: mesh.triangle_source_faces } : {}),
      vertex_range: { start: vertexStart, count: mesh.vertex_count },
      triangle_range: { start: triangleStart, count: mesh.triangle_count } });
  }
  const layout = { contract_id: LAYOUT_CONTRACT, name: input.name, instances };
  // Ensure normalization never produces a saved layout that cannot be reopened.
  if (Buffer.byteLength(JSON.stringify(layout)) > LAYOUT_MAX_JSON_BYTES) reject("Normalized layout exceeds 2000000 compact JSON bytes");
  const layoutText = JSON.stringify(layout, null, 2) + "\n";
  if (Buffer.byteLength(layoutText) > LAYOUT_MAX_FILE_BYTES) reject("Saved layout exceeds 3000000 bytes");
  const result = describeReferenceMesh(vertices, triangles, {
    contract_id: "moonmold.reference-layout-result.v1", name: input.name,
    representation: "reference-layout-derived", layout, layout_sha256: hash(layout),
    geometry_sha256: hash({ units: "mm", vertices, triangles }),
    instance_count: parts.length, parts,
    transform_order: "For each original: convert to mm; uniform scale; rotate X, Y, Z; optional XY center and Z ground; translate in mm",
    losses: ["OBJ/STL bake placement into millimetre vertices; reopen layout JSON to edit original units and transforms",
      "STL flattens instance identity; OBJ retains object names only",
      "STL omits unreferenced vertices; reported bounds and OBJ include all imported vertices",
      "Source materials, textures, normals and other discarded fields are listed per instance"],
  });
  // Named OBJ objects remain independent index ranges. No shared-coordinate
  // welding, topology repair, intersection test or solid boolean is performed.
  result.exports.obj = `# MoonMold placed reference layout; units mm; no welding or boolean union\n${vertices.map(point => `v ${point.join(" ")}`).join("\n")}\n` +
    parts.map(part => `o ${part.id}\n` + triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count).map(face => `f ${face.map(index => index + 1).join(" ")}`).join("\n")).join("\n") + "\n";
  result.exports.layout = layoutText;
  result.qualification = "Reference placement composition only. No welding, boolean union, collision detection, topology, watertightness or physical suitability assessment";
  return result;
}
