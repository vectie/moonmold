import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const ISLAND_SPLIT_CONTRACT = 'moonmold.reference-island-split.v1';
export const ISLAND_MAX_FILE_BYTES = 3_100_000;
const reject = message => { throw new AdapterRejection('invalid-reference-islands', message); };
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const connectivity = 'Triangles connect through a complete undirected edge whose two endpoint XYZ coordinates are exactly equal in the placed millimetre mesh. No tolerance, vertex-only connection, intersection test or welding.';
const qualification = 'Reference triangle connectivity only; no solid topology, watertightness, repair, engineering, manufacturing or physical suitability assessment.';

function analyze(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['contract_id', 'layout', 'instance_id'].includes(key))) reject('Expected layout and instance_id only, with optional split contract_id');
  if (input.contract_id !== undefined && input.contract_id !== ISLAND_SPLIT_CONTRACT) reject(`contract_id must be ${ISLAND_SPLIT_CONTRACT}`);
  if (typeof input.instance_id !== 'string') reject('instance_id must name an existing instance');
  const before = composeReferenceLayout(input.layout), part = before.parts.find(item => item.id === input.instance_id);
  if (!part) reject('instance_id must name an existing instance');
  const vertices = before.vertices.slice(part.vertex_range.start, part.vertex_range.start + part.vertex_range.count);
  const triangles = before.triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count).map(face => face.map(index => index - part.vertex_range.start));
  // Coordinate equality discovers adjacency across separately indexed seams and
  // STL facets. Output retains those indices; discovery never welds geometry.
  const coordinateIds = new Map(), pointIds = vertices.map(point => {
    const key = point.join(','); // JS numeric spelling is round-trip exact; -0 equals 0.
    if (!coordinateIds.has(key)) coordinateIds.set(key, coordinateIds.size);
    return coordinateIds.get(key);
  });
  const parents = triangles.map((_, index) => index), ranks = triangles.map(() => 0), edges = new Map();
  function root(index) { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; }
  function join(a, b) {
    a = root(a); b = root(b); if (a === b) return;
    if (ranks[a] < ranks[b]) [a, b] = [b, a];
    parents[b] = a; if (ranks[a] === ranks[b]) ranks[a]++;
  }
  triangles.forEach((face, index) => {
    for (let edge = 0; edge < 3; edge++) {
      const a = pointIds[face[edge]], b = pointIds[face[(edge + 1) % 3]];
      // A collapsed edge cannot establish connectivity, even if input placement
      // has lost coordinate precision. Reopening derived geometry still validates.
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) join(index, edges.get(key)); else edges.set(key, index);
    }
  });
  const groups = new Map();
  triangles.forEach((_, index) => { const key = root(index); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(index); });
  const components = [...groups.values()].map((triangleIndices, index) => {
    const vertexIndices = [...new Set(triangleIndices.flatMap(i => triangles[i]))].sort((a, b) => a - b);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const i of vertexIndices) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], vertices[i][axis]); max[axis] = Math.max(max[axis], vertices[i][axis]); }
    return { id: `island-${index + 1}`, triangle_count: triangleIndices.length, vertex_count: vertexIndices.length,
      parent_local_triangle_indices: triangleIndices, parent_local_vertex_indices: vertexIndices,
      bounds: { min, max, size: max.map((value, axis) => value - min[axis]) } };
  });
  const used = new Set(triangles.flat());
  const report = { contract_id: 'moonmold.reference-islands.v1', layout_sha256: before.layout_sha256, geometry_sha256: before.geometry_sha256,
    instance_id: part.id, source_sha256: part.source_sha256, source_format: part.source_format, source_units: part.source_units,
    source_transform: part.transform, source_losses: part.losses,
    ...(part.selection ? { source_selection: part.selection } : {}),
    ...(before.layout.instances.find(item => item.id === part.id).source.node_ids ? { source_node_ids: before.layout.instances.find(item => item.id === part.id).source.node_ids } : {}),
    parent_vertex_range: part.vertex_range, parent_triangle_range: part.triangle_range,
    coordinate_frame: 'Placed layout XYZ in millimetres', connectivity, component_count: components.length,
    triangle_count: triangles.length, unused_vertex_count: vertices.length - used.size,
    resulting_instance_count: before.instance_count - 1 + components.length, components, qualification, physical_authority: false };
  return { before, part, vertices, triangles, report };
}

export function inspectReferenceIslands(input) { return analyze(input).report; }

export function splitReferenceIslands(input) {
  const { before, part, vertices, triangles, report } = analyze(input);
  if (report.component_count < 2) reject('Selected reference has only one edge-connected island; there is nothing to separate');
  if (report.resulting_instance_count > 16) reject(`Separating ${report.component_count} islands would create ${report.resulting_instance_count} instances; maximum is 16. Inspect the catalog and use a smaller reference or layout`);
  const recipe = { contract_id: ISLAND_SPLIT_CONTRACT, layout: before.layout, instance_id: part.id };
  const recipeHash = hash(recipe), recipeText = JSON.stringify(recipe, null, 2) + '\n';
  if (Buffer.byteLength(recipeText) > ISLAND_MAX_FILE_BYTES) reject('Saved split recipe exceeds 3100000 bytes');
  const ids = new Set(before.layout.instances.filter(item => item.id !== part.id).map(item => item.id));
  const replacements = [], components = [];
  for (const component of report.components) {
    const base = `${part.id.slice(0, 60)}.${component.id}`;
    let id = base, suffix = 2; while (ids.has(id)) id = `${base}-${suffix++}`; ids.add(id);
    const remap = new Map(component.parent_local_vertex_indices.map((index, offset) => [index, offset]));
    const text = `# MoonMold separate reference island; units mm; no welding\n# parent layout ${before.layout_sha256}\n# source bytes ${part.source_sha256}\n# split recipe ${recipeHash}; ${component.id}\n` +
      component.parent_local_vertex_indices.map(index => `v ${vertices[index].join(' ')}`).join('\n') + '\n' +
      component.parent_local_triangle_indices.map(index => `f ${triangles[index].map(vertex => remap.get(vertex) + 1).join(' ')}`).join('\n') + '\n';
    if (Buffer.byteLength(text) > 400_000) reject(`${component.id}: derived OBJ exceeds 400000 bytes; use a smaller reference`);
    replacements.push({ id, source: { name: id, input_format: 'obj', units: 'mm', text } });
    components.push({ ...component, instance_id: id });
  }
  const instances = before.layout.instances.flatMap(instance => instance.id === part.id ? replacements : [instance]);
  const result = composeReferenceLayout({ ...before.layout, instances });
  result.island_split = { contract_id: 'moonmold.reference-island-split-report.v1', parent_layout_sha256: before.layout_sha256,
    parent_geometry_sha256: before.geometry_sha256, layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    recipe_sha256: recipeHash, inspection: report, components,
    losses: ['Selected source units, selection and placement are baked into new millimetre OBJ sources with identity placements',
      'Triangle winding and retained source-index sharing are preserved within each island; no vertices are welded. Vertex-only shared indices may appear in separate outputs',
      'Unused vertices, object/group labels and earlier source indices are omitted from derived OBJ; keep this report for parent-local triangle/vertex mappings',
      'The separate recipe preserves the complete normalized original layout, original bytes, selections and placements. Later ordinary edits identify only the derived OBJ sources'],
    qualification, physical_authority: false };
  result.exports.recipe = recipeText;
  return result;
}
