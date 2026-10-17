import { AdapterRejection } from './protocol.mjs';
import { extrudeReferenceProfile } from './reference-extrusion.mjs';

export const PROFILE_TRANSFORM_CONTRACT = 'moonmold.reference-profile-transform.v1';
export const PROFILE_TRANSFORM_MAX_BYTES = 34_000;
const reject = message => { throw new AdapterRejection('invalid-profile-transform', message); };

// Edit authored XY coordinates, then use the same validated extrusion path as
// a manually edited recipe. Mesh placement and extrusion height are unchanged.
export function transformReferenceProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['contract_id', 'recipe', 'selection', 'translation', 'rotation_degrees', 'scale', 'pivot'].includes(key))) reject('Expected a typed profile transform request');
  if (input.contract_id !== PROFILE_TRANSFORM_CONTRACT) reject(`contract_id must be ${PROFILE_TRANSFORM_CONTRACT}`);
  if (!['outer', 'cutout', 'all'].includes(input.selection)) reject('Select outer, cutout or all profile rings');
  for (const key of ['translation', 'pivot']) if (!Array.isArray(input[key]) || input[key].length !== 2 || input[key].some(n => typeof n !== 'number' || !Number.isFinite(n))) reject(`${key} must be two finite XY numbers in recipe units`);
  if (typeof input.rotation_degrees !== 'number' || !Number.isFinite(input.rotation_degrees)) reject('rotation_degrees must be finite');
  if (typeof input.scale !== 'number' || !Number.isFinite(input.scale) || input.scale <= 0) reject('scale must be a finite positive uniform XY factor');
  const before = extrudeReferenceProfile(input.recipe);
  const recipe = before.extrusion.recipe;
  if (input.selection === 'cutout' && recipe.cutout == null) reject('This profile has no cutout to transform');
  const degrees = ((input.rotation_degrees % 360) + 360) % 360;
  const quadrant = degrees / 90;
  const [cos, sin] = Number.isInteger(quadrant) ? [[1, 0], [0, 1], [-1, 0], [0, -1]][quadrant] : [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)];
  const move = ring => ring.map(([x, y]) => {
    const dx = (x - input.pivot[0]) * input.scale, dy = (y - input.pivot[1]) * input.scale;
    return [input.pivot[0] + dx * cos - dy * sin + input.translation[0], input.pivot[1] + dx * sin + dy * cos + input.translation[1]].map(n => Object.is(n, -0) ? 0 : n);
  });
  if (input.selection !== 'cutout') recipe.vertices = move(recipe.vertices);
  if (input.selection !== 'outer' && recipe.cutout != null) recipe.cutout = move(recipe.cutout);
  // Revalidate the complete profile, including cutout containment, after edits.
  const result = extrudeReferenceProfile(recipe);
  result.profile_transform = {
    contract_id: 'moonmold.reference-profile-transform-report.v1',
    source_recipe_sha256: before.extrusion.recipe_sha256,
    recipe_sha256: result.extrusion.recipe_sha256,
    geometry_sha256: result.geometry_sha256,
    selection: input.selection, units: recipe.units,
    translation: [...input.translation], rotation_degrees: input.rotation_degrees,
    scale: input.scale, pivot: [...input.pivot],
    order: 'Uniform XY scale about pivot, counterclockwise XY rotation about pivot, then translation; height unchanged',
    qualification: result.extrusion.qualification, physical_authority: false,
  };
  return result;
}
