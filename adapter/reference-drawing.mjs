import { composeReferenceLayout } from './reference-layout.mjs';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const labelNumber = value => Number(value.toPrecision(9)).toString();
const sheetNumber = value => Number(value.toFixed(6)).toString();
const colors = ['#146b82', '#a7461b', '#5d3a92', '#287448', '#9a335f', '#756016', '#2459ad', '#935328', '#77588a', '#38716d', '#963745', '#586823', '#4e5c91', '#77572d', '#86527c', '#4c6c53'];
const viewSpecs = [
  { id: 'top', name: 'Top · looking from +Z', axes: [0, 1], direction: [0, 0, -1] },
  { id: 'front', name: 'Front · looking from −Y', axes: [0, 2], direction: [0, 1, 0] },
  { id: 'right', name: 'Right · looking from +X', axes: [1, 2], direction: [-1, 0, 0] },
];
const axisNames = ['X', 'Y', 'Z'];

// Triangulation edges are deduplicated only by vertex-index pair within an
// instance. Coincident/disconnected geometry and distinct instances stay distinct.
export function referenceWireframe(composed, part) {
  const seen = new Set(), used = new Set(), edges = [];
  for (const face of composed.triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count)) {
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3];
      used.add(a); used.add(b);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  }
  const orphanIndices = [];
  for (let i = part.vertex_range.start; i < part.vertex_range.start + part.vertex_range.count; i++) if (!used.has(i)) orphanIndices.push(i);
  return { edges, orphanIndices };
}

// Recompose embedded originals through the existing editor, so units, selected
// OBJ parts/GLB nodes and applied transforms have exactly one implementation.
export function drawReferenceLayout(layout) {
  return drawComposedReferenceLayout(composeReferenceLayout(layout));
}

// Shared renderer; the HTTP boundary never accepts precomputed geometry.
export function drawComposedReferenceLayout(composed, dimensionReport = null) {
  const center = composed.bounds.min.map((n, i) => n + composed.bounds.size[i] / 2);
  const scale = 280 / Math.max(...composed.bounds.size, 1e-12);
  const wires = composed.parts.map(part => referenceWireframe(composed, part));
  const views = viewSpecs.map((spec, i) => ({
    id: spec.id, title: spec.name, projected_axes: spec.axes.map(a => axisNames[a].toLowerCase()),
    viewing_direction: spec.direction, positive_axes: 'first right, second up',
    bounds_uv_mm: { min: spec.axes.map(a => composed.bounds.min[a]), max: spec.axes.map(a => composed.bounds.max[a]), size: spec.axes.map(a => composed.bounds.size[a]) },
    sheet_center: [240 + i * 470, 370], center_uv_mm: spec.axes.map(a => center[a]),
    sheet_units_per_mm: scale,
  }));
  const parts = composed.parts.map((part, i) => ({
    id: part.id, color: colors[i], source_name: part.source_name, source_format: part.source_format,
    source_units: part.source_units, source_sha256: part.source_sha256,
    ...(part.source_encoding ? { source_encoding: part.source_encoding } : {}),
    ...(part.selection ? { selection: part.selection } : {}),
    ...(part.glb_nodes ? { glb_nodes: part.glb_nodes, glb_scene_index: part.glb_scene_index, coordinate_mapping: part.coordinate_mapping } : {}),
    transform: part.transform, bounds: part.bounds, source_losses: part.losses,
    vertex_count: part.vertex_range.count, triangle_count: part.triangle_range.count,
    unique_index_edge_count: wires[i].edges.length, unreferenced_vertex_count: wires[i].orphanIndices.length,
  }));
  const report = {
    contract_id: 'moonmold.reference-layout-drawing.v1', name: composed.name,
    representation: 'reference-layout-orthographic-drawing', layout_sha256: composed.layout_sha256,
    geometry_sha256: composed.geometry_sha256, units: 'mm', coordinate_frame: 'right-handed XYZ; Z up',
    bounds: composed.bounds, instance_count: parts.length, vertex_count: composed.vertex_count,
    triangle_count: composed.triangle_count, views, parts,
    backend: 'deterministic reference projection; no Blender execution',
    scale_policy: 'Common auto-fitted scale across the three views; not a print-scale template',
    edge_policy: 'All triangle edges, including hidden edges and triangulation diagonals; repeated index edges merge within each instance only; unreferenced vertices appear as dots',
    dimension_policy: 'Overall world-axis bounds over all retained vertices; numeric labels rounded to 9 significant digits, exact doubles retained in metadata',
    losses: ['2D projection removes depth along each viewing direction; overlapping lines are not a visibility or contact result',
      'SVG paths round fitted sheet coordinates to 6 decimal places; numeric labels are descriptive bounds, not tolerances or design dimensions',
      'No original source bytes, editable placements or surface/material shading in SVG; keep the editable layout JSON',
      'Source import losses are retained separately for each instance in metadata'],
    qualification: 'Unqualified reference drawing. No live Blender, solid, collision, clearance, engineering or manufacturing suitability assessment.',
    physical_authority: false,
  };
  const sheet = dimensionReport ? { ...report, ...dimensionReport } : report;
  return { ...sheet, exports: { svg: renderDrawing(sheet, composed.vertices, wires) } };
}

function renderDrawing(report, vertices, wires) {
  const dimensions = report.dimensions ?? [];
  const height = 825 + 62 * report.parts.length + (dimensions.length ? 94 + dimensions.length * 74 : 0);
  const text = (x, y, value, size = 14, extra = '') => `<text x="${x}" y="${y}" font-size="${size}"${extra}>${xml(value)}</text>`;
  const panels = report.views.map((view, index) => {
    const axes = viewSpecs[index].axes, x = 20 + 470 * index;
    const project = point => [view.sheet_center[0] + (point[axes[0]] - view.center_uv_mm[0]) * view.sheet_units_per_mm,
      view.sheet_center[1] - (point[axes[1]] - view.center_uv_mm[1]) * view.sheet_units_per_mm];
    const [minU, minV] = view.bounds_uv_mm.min, [maxU, maxV] = view.bounds_uv_mm.max;
    const left = view.sheet_center[0] - view.bounds_uv_mm.size[0] * view.sheet_units_per_mm / 2;
    const right = view.sheet_center[0] + view.bounds_uv_mm.size[0] * view.sheet_units_per_mm / 2;
    const top = view.sheet_center[1] - view.bounds_uv_mm.size[1] * view.sheet_units_per_mm / 2;
    const bottom = view.sheet_center[1] + view.bounds_uv_mm.size[1] * view.sheet_units_per_mm / 2;
    const drawings = report.parts.map((part, p) => {
      const path = wires[p].edges.map(([a, b]) => `M${project(vertices[a]).map(sheetNumber).join(' ')}L${project(vertices[b]).map(sheetNumber).join(' ')}`).join('');
      const dots = wires[p].orphanIndices.map(i => { const [cx, cy] = project(vertices[i]); return `<circle cx="${sheetNumber(cx)}" cy="${sheetNumber(cy)}" r="2"/>`; }).join('');
      return `<g data-instance-id="${xml(part.id)}" stroke="${part.color}" fill="${part.color}"><title>${xml(part.id)}</title><path data-edge-count="${wires[p].edges.length}" d="${path}" fill="none" stroke-width="1.2"/>${dots}</g>`;
    }).join('\n');
    const annotations = dimensions.map((dimension, d) => {
      const ends = [dimension.endpoint_a, dimension.endpoint_b].map(endpoint => project(endpoint.coordinates_mm));
      const [a, b] = ends;
      return `<g data-named-dimension="${dimension.id}" stroke="#ad1766" fill="#ad1766">
<path d="M${a.map(sheetNumber).join(' ')}L${b.map(sheetNumber).join(' ')}" stroke-width="2" stroke-dasharray="5 3" fill="none"/>
${ends.map(([cx,cy],i) => `<circle cx="${sheetNumber(cx)}" cy="${sheetNumber(cy)}" r="4" fill="white" stroke-width="2"/>${text(sheetNumber(cx + 6), sheetNumber(cy + (i ? 15 : -8)), `${dimension.id}${i ? 'B' : 'A'}`, 11, ' stroke="none"')}`).join('')}
</g>`;
    }).join('\n');
    return `<g id="view-${view.id}" data-axes="${view.projected_axes.join(',')}">
<rect x="${x}" y="155" width="440" height="480" rx="8" fill="#f8fafb" stroke="#c7d3da"/>
${text(x + 16, 184, view.title, 18)}
${text(x + 16, 209, `+${view.projected_axes[0].toUpperCase()} right · +${view.projected_axes[1].toUpperCase()} up`, 13)}
${drawings}${annotations}
<g stroke="#637681" stroke-width="1" fill="none">
<path data-dimension="${view.projected_axes[0]}" d="M${sheetNumber(left)} 539V551M${sheetNumber(left)} 545H${sheetNumber(right)}M${sheetNumber(right)} 539V551"/>
<path data-dimension="${view.projected_axes[1]}" d="M${x + 30} ${sheetNumber(top)}H${x + 42}M${x + 36} ${sheetNumber(top)}V${sheetNumber(bottom)}M${x + 30} ${sheetNumber(bottom)}H${x + 42}"/>
</g>
${text(view.sheet_center[0], 567, `${view.projected_axes[0].toUpperCase()} span ${labelNumber(maxU - minU)} mm`, 14, ' text-anchor="middle"')}
${text(x + 20, 370, `${view.projected_axes[1].toUpperCase()} span ${labelNumber(maxV - minV)} mm`, 14, ` text-anchor="middle" transform="rotate(-90 ${x + 20} 370)"`)}
${text(x + 16, 597, `${view.projected_axes[0].toUpperCase()}: ${labelNumber(minU)} to ${labelNumber(maxU)} mm`, 12)}
${text(x + 16, 619, `${view.projected_axes[1].toUpperCase()}: ${labelNumber(minV)} to ${labelNumber(maxV)} mm`, 12)}
</g>`;
  }).join('\n');
  const legend = report.parts.map((part, i) => {
    const y = 731 + i * 62;
    const title = `${i + 1}. ${part.id} · ${part.source_format.toUpperCase()} (${part.source_units}) · XYZ ${part.bounds.size.map(labelNumber).join(' × ')} mm`;
    return `<g data-legend-instance="${xml(part.id)}"><rect x="24" y="${y - 12}" width="12" height="12" fill="${part.color}"/>
${text(46, y, title, 13, title.length > 160 ? ' textLength="1345" lengthAdjust="spacingAndGlyphs"' : '')}
${text(46, y + 20, `Source SHA-256: ${part.source_sha256}`, 12)}
${text(46, y + 38, `${part.unique_index_edge_count} index edges · ${part.unreferenced_vertex_count} unreferenced vertex dots · ${part.source_losses.length} source-loss notes in metadata`, 12)}
</g>`;
  }).join('\n');
  const footer = 741 + report.parts.length * 62;
  const dimensionLedger = dimensions.length ? `
${text(24, footer + 87, 'NAMED VERTEX DIMENSIONS · true 3D distance; dashed view lines are projections', 18)}
${text(24, footer + 110, 'Markers can overlap or coincide. Values below describe selected points only, not minimum separation or tolerances.', 13)}
${dimensions.map((dimension, i) => {
    const y = footer + 140 + i * 74;
    const endpoint = value => `${value.instance_id}[${value.vertex_index}]`;
    const title = `${dimension.id}. ${dimension.name} · 3D distance ${labelNumber(dimension.distance_mm)} mm`;
    return `<g data-dimension-row="${dimension.id}">${text(24, y, title, 15, title.length > 125 ? ' textLength="1360" lengthAdjust="spacingAndGlyphs"' : '')}
${text(24, y + 22, `A ${endpoint(dimension.endpoint_a)} → B ${endpoint(dimension.endpoint_b)} · signed B − A: X ${labelNumber(dimension.delta_b_minus_a_mm.x)}, Y ${labelNumber(dimension.delta_b_minus_a_mm.y)}, Z ${labelNumber(dimension.delta_b_minus_a_mm.z)} mm`, 12, (endpoint(dimension.endpoint_a).length + endpoint(dimension.endpoint_b).length) > 110 ? ' textLength="1320" lengthAdjust="spacingAndGlyphs"' : '')}
${text(24, y + 42, `A XYZ ${dimension.endpoint_a.coordinates_mm.map(labelNumber).join(', ')} · B XYZ ${dimension.endpoint_b.coordinates_mm.map(labelNumber).join(', ')} mm`, 12)}
</g>`;
  }).join('\n')}
${text(24, height - 18, `Dimension set SHA-256: ${report.dimension_set_sha256} · save the companion JSON and editable layout`, 12)}
` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="drawing-title drawing-description">
<title id="drawing-title">${xml(`${report.name} · three-view reference drawing`)}</title>
<desc id="drawing-description">${xml(`${report.scale_policy}. ${report.edge_policy}. ${report.qualification}`)}</desc>
<metadata>${xml(JSON.stringify(report))}</metadata>
<rect width="1440" height="${height}" fill="white"/>
<g fill="#18313e" font-family="sans-serif">
${text(24, 38, `${report.name} · reference drawing`, 23, report.name.length > 70 ? ' textLength="1360" lengthAdjust="spacingAndGlyphs"' : '')}
${text(24, 66, `XYZ spans ${report.bounds.size.map(labelNumber).join(' × ')} mm · ${report.instance_count} instances · Z up · common auto-fit; NOT a print-scale template`, 15)}
${text(24, 92, `Layout SHA-256: ${report.layout_sha256}`, 12)}
${text(24, 113, `Geometry SHA-256: ${report.geometry_sha256}`, 12)}
${text(24, 136, 'Reference projection only; no Blender execution. Save the editable layout JSON with this drawing.', 13)}
${panels}
${text(24, 663, 'All triangle edges are shown, including hidden edges and diagonals. Dots mark retained vertices without faces.', 14)}
${text(24, 686, dimensions.length ? 'Overall spans describe world-axis bounds. Named vertex observations are in the ledger; neither defines tolerances or physical suitability.' : 'Dimensions describe world-axis bounds, not surface distances, tolerances, collision checks or fabrication instructions.', 14)}
${text(24, 712, 'PLACED REFERENCES · original source identities', 13)}
${legend}
${text(24, footer, 'Projection discards depth; colors identify instances, not source materials. Overlapping lines do not prove contact.', 14)}
${text(24, footer + 24, 'Labels use 9 significant digits. Exact bounds, transforms, source losses and view mapping are embedded in metadata.', 14)}
${text(24, footer + 48, report.qualification, 13)}${dimensionLedger}
</g></svg>\n`;
}
