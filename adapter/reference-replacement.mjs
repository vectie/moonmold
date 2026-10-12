import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-replacement', message); };
const identity = part => ({
  source_sha256: part.source_sha256, source_format: part.source_format,
  source_units: part.source_units, source_name: part.source_name,
  ...(part.selection ? { part_ids: part.selection.part_ids } : {}),
  ...(part.glb_nodes ? { node_ids: part.glb_nodes.map(node => node.node_index) } : {}),
  bounds: part.bounds, vertex_count: part.vertex_range.count,
  triangle_count: part.triangle_range.count, losses: part.losses,
});

// Replace only explicit targets. Selections describe the new bytes; old OBJ
// occurrence/GLB node indices never silently carry across source revisions.
export function replaceReferenceSources(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['layout', 'instance_ids', 'source'].includes(key))) {
    reject('Expected layout, instance_ids and source');
  }
  const ids = input.instance_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16 ||
      ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    reject('instance_ids needs 1 through 16 unique existing instance IDs');
  }
  const before = composeReferenceLayout(input.layout);
  if (ids.some(id => !before.layout.instances.some(item => item.id === id))) reject('Every replacement target must exist in this layout');
  const targets = new Set(ids);
  const layout = structuredClone(before.layout);
  for (const item of layout.instances) if (targets.has(item.id)) item.source = structuredClone(input.source);
  // The existing importer/composer checks replacement source, selection, units,
  // transformed coordinates and the total resulting layout resource envelope.
  const after = composeReferenceLayout(layout);
  after.replacement = {
    contract_id: 'moonmold.reference-source-replacement.v1',
    parent_layout_sha256: before.layout_sha256,
    parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: after.layout_sha256, geometry_sha256: after.geometry_sha256,
    instance_ids: before.parts.filter(part => targets.has(part.id)).map(part => part.id),
    changes: before.parts.flatMap((part, index) => targets.has(part.id) ? [{
      instance_id: part.id, transform: after.parts[index].transform,
      before: identity(part), after: identity(after.parts[index]),
    }] : []),
    semantics: 'Explicit instances receive the complete new source and its explicit selections. IDs, order and placement recipes are retained. Source-origin changes alter placement; center/ground is recomputed from the revised geometry. No fit, alignment, persistent constraint, collision or physical-suitability claim.',
  };
  return after;
}
