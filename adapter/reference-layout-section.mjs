import { sectionDxf } from "./reference-section-dxf.mjs";
import { createHash } from "node:crypto";
import { canonicalJson } from "./protocol.mjs";
import { composeReferenceLayout } from "./reference-layout.mjs";
import { sectionReferenceMesh } from "./reference-section.mjs";
import { sectionSvg, layoutSectionCsv } from "./reference-section-export.mjs";

const hash = value => createHash("sha256").update(canonicalJson(value)).digest("hex");

// Validate the complete layout before observing any part. Section each original
// with its normalized placement; never re-import a flattened derived OBJ/STL.
export function sectionReferenceLayout(layout, plane) {
  const composed = composeReferenceLayout(layout);
  const parts = composed.layout.instances.map((instance, index) => {
    const { exports: ignored, ...section } = sectionReferenceMesh({ ...instance.source, transform: instance.transform, section: plane });
    return { instance_id: instance.id, triangle_range: composed.parts[index].triangle_range, ...section };
  });
  const flatten = field => parts.flatMap(part => part[field].map(observation => ({
    instance_id: part.instance_id, source_sha256: part.source_sha256,
    transformed_mesh_sha256: part.transformed_mesh_sha256, transform_sha256: part.transform_sha256,
    part_section_sha256: part.section_sha256, ...observation,
    layout_triangle_ids: observation.triangle_ids.map(id => id + part.triangle_range.start),
  })));
  const segments = flatten("segments"), point_contacts = flatten("point_contacts");
  const diagnostics = Object.fromEntries(Object.keys(parts[0].diagnostics).map(key => [key, parts.reduce((sum, part) => sum + part.diagnostics[key], 0)]));
  const bounds = parts.map(part => part.bounds_uv_mm).filter(Boolean);
  const bounds_uv_mm = bounds.length ? {
    min: [0, 1].map(i => Math.min(...bounds.map(b => b.min[i]))),
    max: [0, 1].map(i => Math.max(...bounds.map(b => b.max[i]))),
  } : null;
  if (bounds_uv_mm) bounds_uv_mm.size = bounds_uv_mm.max.map((n, i) => n - bounds_uv_mm.min[i]);
  const result = {
    contract_id: "moonmold.reference-layout-section.v1", name: composed.name,
    layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
    units: "mm", coordinate_frame: parts[0].coordinate_frame, plane: parts[0].plane,
    instance_count: parts.length, parts,
    tolerance_mm: Math.max(...parts.map(part => part.tolerance_mm)),
    tolerance_policy: "Tolerance computed independently per placed instance; aggregate value is the maximum, not a layout-wide intersection tolerance",
    coplanar_policy: parts[0].coplanar_policy,
    duplicate_policy: "Exact duplicate segments merge only within each instance, never across instances; local and layout triangle IDs are zero-based",
    status: segments.length ? "segments" : point_contacts.length ? "point-contact" : diagnostics.coplanar_triangles ? "coplanar-only" : "empty",
    segment_count: segments.length, point_contact_count: point_contacts.length,
    source_triangle_count: composed.triangle_count, diagnostics, bounds_uv_mm,
    segment_length_sum_mm: parts.reduce((sum, part) => sum + part.segment_length_sum_mm, 0),
    segments, point_contacts,
    qualification: "Unqualified placed reference layout section. No collision, clearance, closed contour, area, solid, engineering, watertightness or manufacturing suitability assessment.",
    physical_authority: false,
  };
  result.section_sha256 = hash(result);
  return { ...result, exports: { dxf: sectionDxf(result), svg: sectionSvg(result), csv: layoutSectionCsv(result) } };
}
