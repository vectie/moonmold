import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const MIRROR_CONTRACT = 'moonmold.reference-layout-mirror.v1';
export const MIRROR_MAX_FILE_BYTES = 3_100_000;
const reject = message => { throw new AdapterRejection('invalid-reference-mirror', message); };
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) reject(`${label} must be an object with only ${fields.join(', ')}`);
}

// Reflection has negative determinant: swap two triangle indices so front faces
// reflect with the geometry. The ordinary positive-scale placement schema stays
// unchanged; mirrored copies are millimetre OBJ siblings of the original sources.
export function mirrorReferenceLayout(input) {
  object(input, ['contract_id', 'layout', 'instance_ids', 'plane', 'suffix'], 'mirror request');
  if (input.contract_id !== undefined && input.contract_id !== MIRROR_CONTRACT) reject(`contract_id must be ${MIRROR_CONTRACT}`);
  const ids = input.instance_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 15 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) reject('instance_ids needs 1 through 15 unique instance IDs');
  object(input.plane, ['axis', 'position_mm'], 'plane');
  const { axis, position_mm } = input.plane;
  if (!['x', 'y', 'z'].includes(axis)) reject('plane axis must be x, y or z');
  if (typeof position_mm !== 'number' || !Number.isFinite(position_mm) || Math.abs(position_mm) > 1e9) reject('plane position_mm must be finite and within ±1000000000');
  if (typeof input.suffix !== 'string' || !/^[a-zA-Z0-9._-]{1,79}$/.test(input.suffix)) reject('suffix needs 1 through 79 alphanumeric, dot, dash or underscore characters');
  const before = composeReferenceLayout(input.layout);
  if (ids.some(id => !before.parts.some(part => part.id === id))) reject('Every mirror instance must exist in the layout');
  if (before.instance_count + ids.length > 16) reject('Originals plus mirrored copies exceed 16 instances');
  const selected = before.parts.filter(part => ids.includes(part.id));
  for (const part of selected) {
    if (part.id.length + input.suffix.length > 80) reject(`Mirrored instance ID exceeds 80 characters: ${part.id}`);
    if (before.parts.some(other => other.id === part.id + input.suffix)) reject(`Mirrored instance ID already exists: ${part.id + input.suffix}`);
  }
  const plane = { axis, position_mm: position_mm === 0 ? 0 : position_mm };
  const instance_ids = selected.map(part => part.id);
  const recipe = { contract_id: MIRROR_CONTRACT, layout: before.layout, instance_ids, plane, suffix: input.suffix };
  const recipeHash = hash(recipe), recipeText = JSON.stringify(recipe, null, 2) + '\n';
  if (Buffer.byteLength(recipeText) > MIRROR_MAX_FILE_BYTES) reject('Saved mirror recipe exceeds 3100000 bytes');
  const instances = [...before.layout.instances], observations = [], coordinate = ['x', 'y', 'z'].indexOf(axis);
  for (const part of selected) {
    const id = part.id + input.suffix;
    const vertices = before.vertices.slice(part.vertex_range.start, part.vertex_range.start + part.vertex_range.count).map(point => point.map((n, i) => {
      const reflected = i === coordinate ? 2 * plane.position_mm - n : n;
      if (!Number.isFinite(reflected) || Math.abs(reflected) > 1e9) reject(`${id}: reflected coordinate exceeds ±1000000000 mm`);
      return reflected === 0 ? 0 : reflected;
    }));
    const triangles = before.triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count)
      .map(face => [face[0], face[2], face[1]].map(index => index - part.vertex_range.start));
    const obj = `# MoonMold mirrored reference copy; units mm; triangle winding reversed\n# parent layout ${before.layout_sha256}\n# source bytes ${part.source_sha256}\n# mirror recipe ${recipeHash}\n# world ${axis} = ${plane.position_mm} mm\n` +
      vertices.map(point => `v ${point.join(' ')}`).join('\n') + '\n' + triangles.map(face => `f ${face.map(n => n + 1).join(' ')}`).join('\n') + '\n';
    if (Buffer.byteLength(obj) > 400_000) reject(`${id}: derived mirror source exceeds 400000 bytes; use a smaller reference`);
    instances.push({ id, source: { name: id, input_format: 'obj', units: 'mm', text: obj } });
    observations.push({ instance_id: id, parent_instance_id: part.id, source_sha256: part.source_sha256,
      source_format: part.source_format, source_units: part.source_units, source_transform: part.transform, source_losses: part.losses,
      parent_vertex_range: part.vertex_range, parent_triangle_range: part.triangle_range,
      vertex_correspondence: 'Same local vertex index in the parent placed instance and mirrored copy, including unused vertices',
      triangle_correspondence: 'Same local triangle index; local corners [0,1,2] become [0,2,1]', winding_reversed: true });
  }
  const result = composeReferenceLayout({ ...before.layout, instances });
  result.mirror = { contract_id: 'moonmold.reference-layout-mirror-report.v1',
    recipe_sha256: recipeHash, parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256, instance_ids, plane, suffix: input.suffix,
    parts: observations.map(observation => {
      const part = result.parts.find(item => item.id === observation.instance_id);
      return { ...observation, derived_source_sha256: part.source_sha256, vertex_range: part.vertex_range, triangle_range: part.triangle_range };
    }),
    coordinate_frame: 'Right-handed world XYZ in millimetres, Z-up; plane evaluated after the complete original placement',
    operation: 'Keep all originals, append mirrored copies in original layout order; reflect the chosen coordinate as 2 * plane position - coordinate',
    losses: ['Mirrored copies bake source units, selection and placement into new millimetre OBJ sources with identity transforms',
      'Copy triangle winding is reversed; source normals, materials, texture coordinates and object/group labels are not retained',
      'Keep the separate mirror recipe to reopen original bytes, selections and transforms and change the reflection plane',
      'Copies are independent editable references; there is no persistent symmetry link, welding or removal of plane-coincident duplicates'],
    qualification: 'Reference surface reflection only; no solid union, collision, topology repair, engineering or manufacturing assessment', physical_authority: false };
  result.exports.recipe = recipeText;
  return result;
}
