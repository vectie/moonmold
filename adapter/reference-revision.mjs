import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { referenceWireframe } from './reference-drawing.mjs';

export const REVISION_MAX_REQUEST_BYTES = 6_100_000;
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const num = value => Number(value.toPrecision(9)).toString();
const sheetNum = value => Number(value.toFixed(6)).toString();

function describePart(composed, part, index) {
  const vertices = composed.vertices.slice(part.vertex_range.start, part.vertex_range.start + part.vertex_range.count);
  const triangles = composed.triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count)
    .map(face => face.map(i => i - part.vertex_range.start));
  const source = composed.layout.instances[index].source;
  return { index, source_sha256: part.source_sha256,
    source: { name: source.name, input_format: source.input_format, units: source.units,
      part_ids: source.part_ids ?? null, node_ids: source.node_ids ?? null },
    transform: part.transform, bounds: part.bounds,
    vertex_count: vertices.length, triangle_count: triangles.length,
    placed_geometry_sha256: hash({ units: 'mm', vertices, triangles }),
    source_losses: part.losses };
}

// Compare retained source revisions, not an automatic geometric correspondence.
// Recomposition is shared with the actual layout editor and source importers.
export function compareReferenceRevisions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['before', 'after', 'same_world_frame'].includes(key))) {
    throw new AdapterRejection('invalid-reference-revision', 'Expected before and after editable layouts and same_world_frame only');
  }
  if (input.same_world_frame !== true) throw new AdapterRejection('invalid-reference-revision', 'Declare same_world_frame: true only after establishing matching intended origin and axes');
  const before = composeReferenceLayout(input.before), after = composeReferenceLayout(input.after);
  const oldParts = new Map(before.parts.map((p, i) => [p.id, describePart(before, p, i)]));
  const newParts = new Map(after.parts.map((p, i) => [p.id, describePart(after, p, i)]));
  const ids = [...oldParts.keys(), ...[...newParts.keys()].filter(id => !oldParts.has(id))];
  const changes = ids.map(id => {
    const a = oldParts.get(id) ?? null, b = newParts.get(id) ?? null, changed_fields = [];
    if (a && b) {
      if (a.source_sha256 !== b.source_sha256) changed_fields.push('source-bytes');
      for (const key of ['name', 'input_format', 'units', 'part_ids', 'node_ids']) {
        if (!equal(a.source[key], b.source[key])) changed_fields.push(`source-${key}`);
      }
      if (!equal(a.transform, b.transform)) changed_fields.push('placement');
      if (a.placed_geometry_sha256 !== b.placed_geometry_sha256) changed_fields.push('indexed-placed-geometry');
      if (a.index !== b.index) changed_fields.push('export-index');
    }
    const bounds_delta_mm = a && b ? Object.fromEntries(['min', 'max', 'size'].map(key =>
      [key, b.bounds[key].map((n, i) => n - a.bounds[key][i])])) : null;
    return { id, status: !a ? 'added' : !b ? 'removed' : changed_fields.length ? 'changed' : 'unchanged',
      changed_fields, before: a, after: b, bounds_delta_mm };
  });
  const revision = composed => ({ name: composed.name, layout_sha256: composed.layout_sha256,
    geometry_sha256: composed.geometry_sha256, bounds: composed.bounds,
    instance_order: composed.parts.map(p => p.id) });
  const min = before.bounds.min.map((v, i) => Math.min(v, after.bounds.min[i]));
  const max = before.bounds.max.map((v, i) => Math.max(v, after.bounds.max[i]));
  const bounds = { min, max, size: max.map((v, i) => v - min[i]) };
  const center = min.map((v, i) => v + bounds.size[i] / 2);
  const scale = 280 / Math.max(...bounds.size, 1e-12);
  const views = [['top', [0, 1]], ['front', [0, 2]], ['right', [1, 2]]].map(([id, axes], i) => ({
    id, projected_axes: axes.map(a => ['x', 'y', 'z'][a]),
    sheet_center: [240 + i * 470, 360], center_uv_mm: axes.map(a => center[a]), sheet_units_per_mm: scale,
  }));
  const report = {
    contract_id: 'moonmold.reference-revision-comparison.v1', units: 'mm', coordinate_frame: 'right-handed XYZ; Z up',
    before: revision(before), after: revision(after), same_world_frame_declared: true,
    name_changed: before.name !== after.name,
    instance_order_changed: !equal(before.parts.map(p => p.id), after.parts.map(p => p.id)),
    summary: Object.fromEntries(['added', 'removed', 'changed', 'unchanged'].map(status => [status, changes.filter(c => c.status === status).length])),
    bounds_delta_mm: Object.fromEntries(['min', 'max', 'size'].map(key => [key, after.bounds[key].map((n, i) => n - before.bounds[key][i])])),
    changes, overlay_bounds_mm: bounds, views,
    matching_policy: 'Exact instance IDs only; renaming appears as removal plus addition. No inferred source, vertex or object correspondence.',
    comparison_policy: 'Exact normalized declarations and binary64 indexed placed geometry, without tolerances. Index order changes can change a digest even when the represented surface is equivalent.',
    frame_policy: 'Both inputs use the layout contract right-handed XYZ / Z-up frame after explicit source-unit conversion to millimetres. No registration or reprojection; caller must establish the same intended world origin and axes.',
    overlay_policy: 'Before is orange dashed, after is blue solid. Same common auto-fit scale and world origin in all views; all triangle edges, including hidden edges, plus orphan vertex dots. Not print scale.',
    losses: ['Projection removes depth; overlaps do not establish contact or clearance.',
      'SVG coordinates round to six decimals, labels to nine significant digits; exact values remain in JSON metadata.',
      'Comparison omits original source bytes; keep both editable layout files to reopen and reproduce.',
      'Source comments and unused vertices affect identity; geometry equality does not establish design or physical equivalence.'],
    backend: 'deterministic reference recomposition; no Blender execution',
    qualification: 'Digital revision inspection only; no engineering acceptance, design tolerance, collision, clearance or physical suitability assessment.',
    physical_authority: false,
  };
  report.comparison_sha256 = hash(report);
  return { ...report, exports: { svg: renderComparison(report, before, after) } };
}

function renderComparison(report, before, after) {
  const height = 855 + 76 * report.changes.length;
  const text = (x, y, value, size = 14) => `<text x="${x}" y="${y}" font-size="${size}">${xml(value)}</text>`;
  const wires = [before, after].map(c => c.parts.map(p => referenceWireframe(c, p)));
  const panels = report.views.map((view, v) => {
    const axes = view.projected_axes.map(a => ['x', 'y', 'z'].indexOf(a));
    const project = p => [view.sheet_center[0] + (p[axes[0]] - view.center_uv_mm[0]) * view.sheet_units_per_mm,
      view.sheet_center[1] - (p[axes[1]] - view.center_uv_mm[1]) * view.sheet_units_per_mm];
    const layers = [before, after].map((c, revision) => c.parts.map((part, i) => {
      const wire = wires[revision][i], color = revision ? '#146b82' : '#a7461b';
      const path = wire.edges.map(([a, b]) => `M${project(c.vertices[a]).map(sheetNum).join(' ')}L${project(c.vertices[b]).map(sheetNum).join(' ')}`).join('');
      return `<g data-revision="${revision ? 'after' : 'before'}" data-instance-id="${xml(part.id)}" stroke="${color}" fill="${color}"><title>${xml(part.id)}</title><path data-edge-count="${wire.edges.length}" d="${path}" fill="none" stroke-width="${revision ? 1.3 : 2}"${revision ? '' : ' stroke-dasharray="5 3"'}/>${wire.orphanIndices.map(i => { const [x,y] = project(c.vertices[i]); return `<circle cx="${sheetNum(x)}" cy="${sheetNum(y)}" r="${revision ? 2 : 3}"/>`; }).join('')}</g>`;
    }).join('')).join('');
    return `<g id="view-${view.id}"><rect x="${20 + v * 470}" y="175" width="440" height="405" fill="#f8fafb" stroke="#c7d3da"/>${text(36 + v * 470, 203, `${view.id.toUpperCase()}: +${view.projected_axes[0]} right, +${view.projected_axes[1]} up`, 18)}${layers}</g>`;
  }).join('');
  const ledger = report.changes.map((item, i) => {
    const y = 689 + i * 76;
    return `<g data-change-id="${xml(item.id)}">${text(24, y, `${item.id}: ${item.status} ${item.changed_fields.join(', ')}`, 13)}
${text(24, y + 20, `Before source: ${item.before?.source_sha256 ?? '(absent)'}`, 12)}
${text(24, y + 38, `After source:  ${item.after?.source_sha256 ?? '(absent)'}`, 12)}
${text(24, y + 56, item.bounds_delta_mm ? `World bound span change XYZ: ${item.bounds_delta_mm.size.map(num).join(', ')} mm` : 'No paired bound delta for an added or removed ID.', 12)}</g>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="revision-title revision-desc">
<title id="revision-title">Layout revision comparison</title><desc id="revision-desc">${xml(report.overlay_policy + ' ' + report.qualification)}</desc><metadata>${xml(JSON.stringify(report))}</metadata>
<rect width="1440" height="${height}" fill="white"/><g font-family="sans-serif" fill="#18313e">
${text(24, 34, 'Saved layout revision → current applied layout', 23)}
${text(24, 59, `Before: ${report.before.name} · orange dashed | After: ${report.after.name} · blue solid`, 14)}
${text(24, 84, `Before layout SHA-256: ${report.before.layout_sha256}`, 12)}
${text(24, 104, `After layout SHA-256:  ${report.after.layout_sha256}`, 12)}
${text(24, 128, 'Millimetres · shared XYZ world frame · common auto-fit · NOT print scale · no automatic registration', 14)}
${text(24, 151, `Added ${report.summary.added} · Removed ${report.summary.removed} · Changed ${report.summary.changed} · Unchanged ${report.summary.unchanged}`, 14)}
${panels}${text(24, 610, 'Orange dashes may be covered by identical blue edges. All hidden edges and triangulation diagonals remain visible.', 14)}
${text(24, 634, 'Matched by exact instance ID. Renames are removals/additions. Exact indexed geometry; no tolerances or physical claims.', 14)}
${text(24, 658, `Layout name changed: ${report.name_changed}; instance list/order changed: ${report.instance_order_changed}`, 13)}
${ledger}${text(24, height - 76, `Comparison SHA-256: ${report.comparison_sha256}`, 12)}
${text(24, height - 53, 'Keep both editable layouts. JSON metadata contains exact changes, transforms, bounds, identities and source-loss notes.', 14)}
${text(24, height - 30, report.qualification, 13)}
</g></svg>\n`;
}
