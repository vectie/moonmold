import { sectionDxf } from "./reference-section-dxf.mjs";
import { createHash } from "node:crypto";
import { AdapterRejection, canonicalJson } from "./protocol.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { sectionCsv, sectionSvg } from "./reference-section-export.mjs";

const hash = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
const compare = (a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2];
const key = point => point.join(",");
const reject = message => { throw new AdapterRejection("invalid-reference-section", message); };

// A section is an observation of the final placed reference, never a solid or
// contour repair. Preserve independent segments and their source triangle IDs.
export function sectionReferenceMesh(input = {}) {
  const plane = input.section;
  if (!plane || typeof plane !== "object" || Array.isArray(plane) ||
      Object.keys(plane).some(name => !["axis", "position_mm"].includes(name))) reject("section needs axis and position_mm");
  const axis = ["x", "y", "z"].indexOf(plane.axis);
  if (axis < 0) reject("section axis must be x, y or z");
  const position = plane.position_mm;
  if (typeof position !== "number" || !Number.isFinite(position) || Math.abs(position) > 1e9) reject("section position_mm must be finite and within ±1000000000 mm");
  const mesh = transformReferenceMesh(input);
  const projectedAxes = [0, 1, 2].filter(n => n !== axis);
  const project = point => projectedAxes.map(n => point[n]);
  const maxCoordinate = Math.max(Math.abs(position), Math.abs(mesh.bounds.min[axis]), Math.abs(mesh.bounds.max[axis]));
  const tolerance = Math.max(1e-12, mesh.bounds.size[axis]*1e-10, maxCoordinate*Number.EPSILON*16);
  const segments = new Map(), contacts = new Map();
  const counts = { coplanar_triangles: 0, point_touch_triangles: 0, on_plane_edge_triangles: 0, outside_triangles: 0, merged_duplicate_segments: 0 };
  const onPlane = point => point.map((n, i) => i === axis ? position : n === 0 ? 0 : n);
  for (const [triangleId, triangle] of mesh.triangles.entries()) {
    const points = triangle.map(n => mesh.vertices[n]);
    const signs = points.map(p => Math.abs(p[axis]-position) <= tolerance ? 0 : Math.sign(p[axis]-position));
    if (signs.every(n => n === 0)) { counts.coplanar_triangles++; continue; }
    const intersections = new Map();
    for (let i = 0; i < 3; i++) {
      if (signs[i] === 0) { const p = onPlane(points[i]); intersections.set(key(p), p); }
      const j = (i+1)%3;
      if (signs[i]*signs[j] < 0) {
        // Canonical edge orientation makes shared/reversed edges use identical
        // floating-point arithmetic, including independently indexed STL faces.
        const [a, b] = [points[i], points[j]].sort(compare);
        const fraction = (position-a[axis])/(b[axis]-a[axis]);
        const p = onPlane(a.map((n, k) => n+(b[k]-n)*fraction));
        intersections.set(key(p), p);
      }
    }
    const hits = [...intersections.values()].sort(compare);
    if (!hits.length) { counts.outside_triangles++; continue; }
    if (hits.length === 1) {
      counts.point_touch_triangles++;
      const id = key(hits[0]);
      if (!contacts.has(id)) contacts.set(id, { point_mm: hits[0], uv_mm: project(hits[0]), triangle_ids: [] });
      contacts.get(id).triangle_ids.push(triangleId);
      continue;
    }
    const [a, b] = hits;
    const id = `${key(a)};${key(b)}`;
    if (signs.filter(n => n === 0).length === 2) counts.on_plane_edge_triangles++;
    if (!segments.has(id)) segments.set(id, {
      start_mm: a, end_mm: b, start_uv_mm: project(a), end_uv_mm: project(b),
      length_mm: Math.hypot(...a.map((n, i) => b[i]-n)), triangle_ids: [],
    });
    else counts.merged_duplicate_segments++;
    segments.get(id).triangle_ids.push(triangleId);
  }
  const lines = [...segments.values()];
  const points = [...contacts.values()];
  const observed = [...lines.flatMap(line => [line.start_uv_mm, line.end_uv_mm]), ...points.map(p => p.uv_mm)];
  const bounds = observed.length ? observed.reduce((bounds, p) => ({
    min: bounds.min.map((n, i) => Math.min(n, p[i])),
    max: bounds.max.map((n, i) => Math.max(n, p[i])),
  }), { min: [...observed[0]], max: [...observed[0]] }) : null;
  if (bounds) bounds.size = bounds.max.map((n, i) => n-bounds.min[i]);
  const result = {
    contract_id: "moonmold.reference-section.v1", name: mesh.name,
    source_sha256: mesh.source_sha256, source_format: mesh.source_format, source_units: mesh.source_units,
    ...(mesh.source_encoding ? { source_encoding: mesh.source_encoding } : {}),
    ...(mesh.selection ? { selection: mesh.selection, source: mesh.source, source_faces: mesh.source_faces,
      source_vertex_indices: mesh.source_vertex_indices, triangle_source_faces: mesh.triangle_source_faces,
      triangle_id_scope: "Indices in the selected mesh; triangle_source_faces maps each to its original OBJ face" } : {}),
    transform: mesh.transform, transform_order: mesh.transform_order,
    transform_sha256: hash(mesh.transform),
    transformed_mesh_sha256: hash({ units: mesh.units, vertices: mesh.vertices, triangles: mesh.triangles }),
    units: "mm", coordinate_frame: "Transformed source axes; no axis convention inferred",
    plane: { axis: plane.axis, position_mm: position, projected_axes: projectedAxes.map(i => ["x", "y", "z"][i]) },
    tolerance_mm: tolerance,
    coplanar_policy: "Skip triangles whose three vertices are within tolerance of the plane; keep on-plane edges of noncoplanar triangles. No coplanar boundary or filled area is inferred.",
    duplicate_policy: "Merge exactly coincident endpoint pairs, retaining triangle IDs; no approximate welding or contour joining",
    status: lines.length ? "segments" : points.length ? "point-contact" : counts.coplanar_triangles ? "coplanar-only" : "empty",
    segment_count: lines.length, point_contact_count: points.length, source_triangle_count: mesh.triangle_count,
    diagnostics: counts, bounds_uv_mm: bounds,
    segment_length_sum_mm: lines.reduce((sum, line) => sum+line.length_mm, 0),
    segments: lines, point_contacts: points, source_losses: mesh.losses,
    qualification: "Unqualified reference section; open segments and point contacts are retained. No closed contour, area, solid, watertightness or manufacturing suitability is asserted.",
    physical_authority: false,
  };
  result.section_sha256 = hash(result);
  return { ...result, exports: { dxf: sectionDxf(result), svg: sectionSvg(result), csv: sectionCsv(result) } };
}
