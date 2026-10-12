import { createHash } from "node:crypto";
import { AdapterRejection } from "./protocol.mjs";
import { parseReferenceStl } from "./reference-stl.mjs";
import { parseReferencePly } from "./reference-ply.mjs";
import { parseReferenceGlb } from "./reference-glb-import.mjs";

const reject = (message) => { throw new AdapterRejection("invalid-reference-mesh", message); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const sub = (a, b) => a.map((v, i) => v-b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s+v*b[i], 0);

// Geometry-only reference input. No OBJ directive is executed or fetched.
export function importReferenceMesh({ text, data_base64, input_format = "obj", units, name = "reference", part_ids, node_ids } = {}) {
  if (!["obj", "stl", "ply", "glb"].includes(input_format)) reject("input_format must be obj, stl, ply or glb");
  if (part_ids !== undefined && input_format !== "obj") reject("part_ids requires an OBJ source");
  if (node_ids !== undefined && input_format !== "glb") reject("node_ids requires a GLB source");
  if (input_format === "glb" && units !== "m") reject("GLB requires units m; glTF defines metres/Y-up and import converts to mm/Z-up");
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[units];
  if (typeof units !== "string" || typeof factor !== "number") reject("Explicit units required: mm, cm, m, or in");
  if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) reject("Use a short alphanumeric mesh name");
  if (["ply", "stl", "glb"].includes(input_format)) {
    const label = input_format.toUpperCase();
    let bytes;
    if (data_base64 !== undefined) {
      if (text !== undefined || typeof data_base64 !== "string" || data_base64.length > 533_336 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data_base64)) reject(`${label} needs text or canonical base64 bytes, never both`);
      bytes = Buffer.from(data_base64, "base64");
      if (bytes.toString("base64") !== data_base64) reject(`${label} data_base64 must be canonical base64`);
    } else {
      if (typeof text !== "string") reject(`${label} needs text or data_base64`);
      if (Buffer.byteLength(text) > 400_000) reject(`${label} input must be at most 400000 bytes`);
      bytes = Buffer.from(text, "utf8");
    }
    if (bytes.length > 400_000) reject(`${label} input must be at most 400000 bytes`);
    if (input_format === "glb" && data_base64 === undefined) reject("GLB requires data_base64 to preserve original binary bytes");
    const parsed = input_format === "glb" ? parseReferenceGlb(bytes, node_ids) : input_format === "ply" ? parseReferencePly(bytes, factor) : parseReferenceStl(bytes, factor);
    if (input_format === "ply" && parsed.encoding !== "ascii" && data_base64 === undefined) reject("Binary PLY requires data_base64 to preserve its exact bytes");
    return describeReferenceMesh(parsed.vertices, parsed.triangles, {
      contract_id: "moonmold.reference-mesh.v1", name,
      representation: "reference-set", source_format: input_format, source_encoding: parsed.encoding, source_units: units,
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      losses: parsed.losses,
      ...(input_format === "glb" ? {
        source: { input_format, units, name, data_base64, node_ids: parsed.glb_node_ids },
        glb_nodes: parsed.glb_nodes, glb_scene_index: parsed.glb_scene_index,
        glb_node_ids: parsed.glb_node_ids, coordinate_mapping: parsed.coordinate_mapping,
      } : {}),
    });
  }
  if (data_base64 !== undefined || typeof text !== "string" || Buffer.byteLength(text) > 400_000) reject("OBJ text must be at most 400000 UTF-8 bytes");
  // Reject lone surrogates: hashes and saved source must represent the same UTF-8 bytes.
  if (Buffer.from(text, "utf8").toString("utf8") !== text) reject("OBJ text must be valid UTF-8");
  const vertices = [], triangles = [], ignored = new Set(), parts = [], faces = [], triangleFaces = [];
  let objectNumber = 0, groupNumber = 0, activeGroups = [], faceMemberships = 0;
  const makePart = (kind, number, label, line) => {
    if (parts.length >= 256) reject("OBJ supports at most 256 object/group occurrences");
    const part = { id: `${kind}-${number}`, kind, name: label, source_line: line, source_face_indices: [] };
    parts.push(part); return part;
  };
  let activeObject = makePart("object", 0, null, 0);
  let normals = 0, textures = 0;
  function index(value, count, line) {
    if (!/^-?[1-9][0-9]*$/.test(value)) reject(`Line ${line}: invalid OBJ index`);
    const n = Number(value), i = n > 0 ? n-1 : count+n;
    if (!Number.isSafeInteger(n) || i < 0 || i >= count) reject(`Line ${line}: index outside currently declared data`);
    return i;
  }
  for (const [offset, raw] of text.split(/\r?\n/).entries()) {
    const fields = raw.split("#", 1)[0].trim().split(/\s+/), op = fields.shift(), line = offset+1;
    if (!op) continue;
    if (op === "v" || op === "vn" || op === "vt") {
      const expected = op === "vt" ? [1, 2, 3] : [3];
      if (!expected.includes(fields.length) || fields.some((v) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) || !Number.isFinite(Number(v)))) reject(`Line ${line}: invalid ${op} coordinates`);
      if (op === "v") {
        const point = fields.map((v) => Number(v)*factor);
        if (point.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9)) reject(`Line ${line}: coordinate exceeds reference range`);
        vertices.push(point);
      } else if (op === "vn") { normals++; ignored.add("vertex normals"); }
      else { textures++; ignored.add("texture coordinates"); }
    } else if (op === "f") {
      if (fields.length < 3 || fields.length > 64) reject(`Line ${line}: face needs 3 through 64 vertices`);
      const face = fields.map((field) => {
        const parts = field.split("/");
        if (parts.length > 3 || (parts.length === 2 && !parts[1]) || (parts.length === 3 && !parts[2])) reject(`Line ${line}: invalid face reference`);
        if (parts[1]) index(parts[1], textures, line);
        if (parts[2]) index(parts[2], normals, line);
        return index(parts[0], vertices.length, line);
      });
      if (new Set(face).size !== face.length) reject(`Line ${line}: repeated face vertex`);
      const points = face.map((i) => vertices[i]);
      const normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
      const magnitude = Math.hypot(...normal);
      if (magnitude === 0) reject(`Line ${line}: degenerate face`);
      const unit = normal.map((v) => v/magnitude);
      const size = Math.max(...points.map((p) => Math.hypot(...sub(p, points[0]))));
      if (points.some((p) => Math.abs(dot(sub(p, points[0]), unit)) > size*1e-8)) reject(`Line ${line}: triangulate non-planar faces before import`);
      // Every other point must lie on the inner side of each oriented edge.
      // This also rejects concave and self-intersecting polygon fans.
      for (let i = 0; i < points.length; i++) {
        const edge = sub(points[(i+1)%points.length], points[i]);
        for (let j = 0; j < points.length; j++) {
          if (j === i || j === (i+1)%points.length) continue;
          if (dot(cross(edge, sub(points[j], points[i])), unit) <= 0) reject(`Line ${line}: triangulate concave or collinear polygons before import`);
        }
      }
      const faceIndex = faces.length, start = triangles.length;
      faceMemberships += 1 + activeGroups.length;
      if (faceMemberships > 100_000) reject("OBJ supports at most 100000 face-to-part memberships");
      for (let i = 1; i+1 < face.length; i++) { triangles.push([face[0], face[i], face[i+1]]); triangleFaces.push(faceIndex); }
      if (triangles.length > 40_000) reject("OBJ supports at most 40000 triangles");
      activeObject.source_face_indices.push(faceIndex);
      for (const group of activeGroups) group.source_face_indices.push(faceIndex);
      faces.push({ source_face_index: faceIndex, source_line: line, source_vertex_indices: face,
        object_id: activeObject.id, group_ids: activeGroups.map(part => part.id),
        source_triangle_range: { start, count: triangles.length - start } });
    } else if (op === "o" || op === "g") {
      if (fields.some(value => /[\u0000-\u001f\u007f]/u.test(value)) || fields.join(" ").length > 200) reject(`Line ${line}: part names must be at most 200 characters without control characters`);
      if (op === "o") activeObject = makePart("object", ++objectNumber, fields.join(" ") || null, line);
      else {
        if (fields.length > 32 || new Set(fields).size !== fields.length) reject(`Line ${line}: use at most 32 distinct group names`);
        activeGroups = fields.map(label => makePart("group", ++groupNumber, label, line));
      }
    } else if (["s", "usemtl", "mtllib"].includes(op)) {
      ignored.add(op);
    } else reject(`Line ${line}: unsupported OBJ directive ${op}`);
  }
  if (!vertices.length || !triangles.length) reject("OBJ requires vertices and faces");
  const boundsOf = points => {
    const min = [0,1,2].map(axis => Math.min(...points.map(point => point[axis])));
    const max = [0,1,2].map(axis => Math.max(...points.map(point => point[axis])));
    return { min, max, size: max.map((value, axis) => value-min[axis]) };
  };
  const catalog = parts.filter(part => part.source_face_indices.length).map(part => {
    const indices = [...new Set(part.source_face_indices.flatMap(i => faces[i].source_vertex_indices))];
    return { ...part, vertex_count: indices.length,
      triangle_count: part.source_face_indices.reduce((sum,i) => sum+faces[i].source_triangle_range.count, 0),
      bounds: boundsOf(indices.map(i => vertices[i])) };
  });
  let selectedIds;
  if (part_ids !== undefined) {
    if (!Array.isArray(part_ids) || !part_ids.length || part_ids.length > 256 || part_ids.some(id => typeof id !== "string") || new Set(part_ids).size !== part_ids.length) reject("part_ids needs 1 through 256 unique object/group IDs");
    if (part_ids.some(id => !catalog.some(part => part.id === id))) reject("Unknown or empty OBJ part ID; inspect the current source first");
    selectedIds = catalog.filter(part => part_ids.includes(part.id)).map(part => part.id);
  }
  const selectedFaces = selectedIds ? new Set(catalog.filter(part => selectedIds.includes(part.id)).flatMap(part => part.source_face_indices)) : null;
  const selectedTriangles = triangles.filter((_,i) => !selectedFaces || selectedFaces.has(triangleFaces[i]));
  // Share by original vertex index, never by coordinate; union overlapping faces once.
  const vertexIndices = selectedFaces ? [...new Set(selectedTriangles.flat())].sort((a,b) => a-b) : vertices.map((_,i) => i);
  const remap = new Map(vertexIndices.map((index, position) => [index, position]));
  return describeReferenceMesh(vertexIndices.map(i => vertices[i]), selectedTriangles.map(face => face.map(i => remap.get(i))), {
    contract_id: "moonmold.reference-mesh.v1", name,
    representation: "reference-set", source_format: "obj", source_units: units,
    source_sha256: createHash("sha256").update(text).digest("hex"),
    losses: [...ignored].sort(),
    source: { input_format, units, name, text, ...(selectedIds ? { part_ids: selectedIds } : {}) },
    obj_parts: catalog,
    source_faces: faces.filter(face => !selectedFaces || selectedFaces.has(face.source_face_index)),
    source_vertex_indices: vertexIndices,
    triangle_source_faces: triangleFaces.filter(index => !selectedFaces || selectedFaces.has(index)),
    ...(selectedIds ? { selection: { part_ids: selectedIds, source_face_count: faces.length, selected_face_count: selectedFaces.size } } : {}),
  });
}

// Shared export path keeps edited geometry, bounds and downloadable siblings equal.
export function describeReferenceMesh(vertices, triangles, metadata) {
  const { name } = metadata;
  const min = [0,1,2].map((axis) => Math.min(...vertices.map((p) => p[axis])));
  const max = [0,1,2].map((axis) => Math.max(...vertices.map((p) => p[axis])));
  const partMap = new Map((metadata.obj_parts ?? []).map(part => [part.id, part]));
  const faceMap = new Map((metadata.source_faces ?? []).map(face => [face.source_face_index, face]));
  let previousObject, previousGroups;
  const objFaces = triangles.map((triangle,i) => {
    const face = faceMap.get(metadata.triangle_source_faces?.[i]);
    let labels = "";
    if (face) {
      if (face.object_id !== previousObject) { labels += `o${partMap.get(face.object_id)?.name ? " " + partMap.get(face.object_id).name : ""}\n`; previousObject = face.object_id; }
      const groups = face.group_ids.join(",");
      if (groups !== previousGroups) { labels += `g${face.group_ids.length ? " " + face.group_ids.map(id => partMap.get(id).name).join(" ") : ""}\n`; previousGroups = groups; }
    }
    return labels + `f ${triangle.map(index => index+1).join(" ")}`;
  });
  const obj = `# MoonMold reference mesh; units mm\n${vertices.map((p) => `v ${p.join(" ")}`).join("\n")}\n${objFaces.join("\n")}\n`;
  const facets = triangles.map((t) => {
    const [a,b,c] = t.map((i) => vertices[i]), n = cross(sub(b,a),sub(c,a)), length = Math.hypot(...n);
    return `  facet normal ${n.map((v) => v/length).join(" ")}\n    outer loop\n${[a,b,c].map((p) => `      vertex ${p.join(" ")}`).join("\n")}\n    endloop\n  endfacet`;
  });
  return {
    ...metadata,
    units: "mm", vertices, triangles,
    bounds: { min, max, size: max.map((v,i) => v-min[i]) },
    vertex_count: vertices.length, triangle_count: triangles.length,
    qualification: "Unqualified reference geometry; topology, watertightness and physical suitability are not assessed",
    physical_authority: false,
    exports: { obj, stl: `solid ${name}\n${facets.join("\n")}\nendsolid ${name}\n` },
  };
}
