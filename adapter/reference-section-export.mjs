const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const number = value => Number(value.toPrecision(9)).toString();
const csv = value => `"${String(value).replaceAll('"', '""')}"`;

// The metadata row is retained even when the section has zero segments.
export function sectionCsv(section) {
  const fields = ["record_type", "section_sha256", "source_sha256", "transformed_mesh_sha256", "transform_sha256", "units", "axis", "position_mm", "tolerance_mm", "status", "coplanar_triangles", "point_contact_count", "segment_id", "start_x_mm", "start_y_mm", "start_z_mm", "end_x_mm", "end_y_mm", "end_z_mm", "length_mm", "triangle_ids", "transform_json"];
  const identity = [section.section_sha256, section.source_sha256, section.transformed_mesh_sha256, section.transform_sha256, section.units, section.plane.axis, section.plane.position_mm, section.tolerance_mm, section.status, section.diagnostics.coplanar_triangles, section.point_contact_count];
  const rows = [["metadata", ...identity, ...Array(9).fill(""), JSON.stringify(section.transform)],
    ...section.segments.map((line, i) => ["segment", ...identity, i, ...line.start_mm, ...line.end_mm, line.length_mm, line.triangle_ids.join(";"), JSON.stringify(section.transform)])];
  return fields.join(",")+"\r\n"+rows.map(row => row.map(csv).join(",")).join("\r\n")+"\r\n";
}

export function sectionSvg(section) {
  const bounds = section.bounds_uv_mm;
  const size = bounds?.size ?? [0, 0];
  const extent = Math.max(...size, 1e-12);
  const scale = 380/extent;
  const center = bounds ? bounds.min.map((n, i) => n+size[i]/2) : [0, 0];
  const point = p => [500+(p[0]-center[0])*scale, 320-(p[1]-center[1])*scale];
  const [u, v] = section.plane.projected_axes.map(n => n.toUpperCase());
  const title = `${section.name}: ${section.plane.axis.toUpperCase()} = ${number(section.plane.position_mm)} mm`;
  const lines = section.segments.map(line => {
    const [x1, y1] = point(line.start_uv_mm), [x2, y2] = point(line.end_uv_mm);
    return `<line${line.instance_id ? ` data-instance-id="${xml(line.instance_id)}"` : ""} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${line.instance_id ? `<title>${xml(`${line.instance_id}; source triangles ${line.triangle_ids.join(", ")}`)}</title>` : ""}</line>`;
  }).join("\n");
  const dots = section.point_contacts.map(contact => {
    const [cx, cy] = point(contact.uv_mm);
    return `<circle${contact.instance_id ? ` data-instance-id="${xml(contact.instance_id)}"` : ""} cx="${cx}" cy="${cy}" r="3">${contact.instance_id ? `<title>${xml(`${contact.instance_id}; source triangles ${contact.triangle_ids.join(", ")}`)}</title>` : ""}</circle>`;
  }).join("\n");
  const label = (y, text, font = 14) => `<text x="24" y="${y}" font-size="${font}">${xml(text)}</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="730" viewBox="0 0 1000 730" role="img" aria-labelledby="title description">
<title id="title">${xml(title)}</title>
<desc id="description">${xml(section.qualification)} ${xml(section.coplanar_policy)}</desc>
<metadata>${xml(JSON.stringify(section))}</metadata>
<rect width="1000" height="730" fill="#fff"/>
<g fill="#18313e" font-family="sans-serif">
${label(32, title, 22)}
${label(58, `${section.segment_count} segments · ${section.point_contact_count} point contacts · ${section.diagnostics.coplanar_triangles} coplanar triangles omitted`)}
${label(82, `${u} increases right; ${v} increases up. Units mm. Diagram auto-fitted; not a print-scale template.`)}
<g stroke="#137c70" stroke-width="2" fill="none">${lines}</g>
<g fill="#b44b00">${dots}</g>
${!bounds ? label(300, section.status === "coplanar-only" ? "Coplanar triangles omitted. No finite segment section shown." : "No triangle intersection at this plane.", 18) : ""}
${label(548, bounds ? `${u}: ${number(bounds.min[0])} to ${number(bounds.max[0])} mm; ${v}: ${number(bounds.min[1])} to ${number(bounds.max[1])} mm; spans ${size.map(number).join(" × ")} mm` : "No section bounds")}
${label(572, `Segment-length sum: ${number(section.segment_length_sum_mm)} mm. Tolerance: ${number(section.tolerance_mm)} mm. No closed contours inferred.`)}
${label(599, section.layout_sha256 ? `Layout SHA-256: ${section.layout_sha256}` : `Source ${section.source_format.toUpperCase()} (${section.source_units}): ${section.source_sha256}`, 12)}
${label(620, `Transformed mesh SHA-256: ${section.geometry_sha256 ?? section.transformed_mesh_sha256}`, 12)}
${label(641, section.layout_sha256 ? `${section.instance_count} independent instances; per-instance identities and tolerances in metadata. Tolerance above is maximum.` : `Transform SHA-256: ${section.transform_sha256}`, 12)}
${label(662, `Section SHA-256: ${section.section_sha256}`, 12)}
${label(687, "Coplanar facets are omitted; neighboring on-plane edges can remain. Point contacts are orange.", 13)}
${label(710, "Unqualified reference geometry. No solid, watertightness or manufacturing suitability assessment.", 13)}
</g></svg>\n`;
}

// Every instance has a metadata record, including empty or omitted observations.
// JSON cells preserve all original numeric precision and lineage identifiers.
export function layoutSectionCsv(section) {
  const fields = ["record_type", "section_sha256", "layout_sha256", "geometry_sha256", "instance_id", "source_sha256", "transform_sha256", "transformed_mesh_sha256", "part_section_sha256", "units", "axis", "position_mm", "tolerance_mm", "status", "coplanar_triangles", "observation_id", "observation_json", "transform_json"];
  const rows = [];
  for (const part of section.parts) {
    const identity = [section.section_sha256, section.layout_sha256, section.geometry_sha256, part.instance_id, part.source_sha256, part.transform_sha256, part.transformed_mesh_sha256, part.section_sha256, section.units, section.plane.axis, section.plane.position_mm, part.tolerance_mm, part.status, part.diagnostics.coplanar_triangles];
    rows.push(["metadata", ...identity, "", JSON.stringify({ diagnostics: part.diagnostics, point_contact_count: part.point_contact_count, triangle_range: part.triangle_range, qualification: section.qualification, coplanar_policy: section.coplanar_policy }), JSON.stringify(part.transform)]);
    for (const [type, items] of [["segment", part.segments], ["point-contact", part.point_contacts]]) {
      for (const [index, item] of items.entries()) rows.push([type, ...identity, index, JSON.stringify({ ...item, layout_triangle_ids: item.triangle_ids.map(id => id + part.triangle_range.start) }), JSON.stringify(part.transform)]);
    }
  }
  return fields.join(",") + "\r\n" + rows.map(row => row.map(csv).join(",")).join("\r\n") + "\r\n";
}
