import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { triangulateReferenceProfile } from './reference-profile-caps.mjs';

export const EXTRUSION_CONTRACT = 'moonmold.reference-profile-extrusion.v1';
export const EXTRUSION_CUTOUT_CONTRACT = 'moonmold.reference-profile-extrusion.v2';
export const EXTRUSION_MAX_FILE_BYTES = 32_000;
const reject = message => { throw new AdapterRejection('invalid-reference-extrusion', message); };
const qualification = 'Bounded digital reference mesh from a simple straight-edged XY profile. No engineering CAD, tolerances, material behavior, Blender qualification, manufacturing or physical authority.';

// v1 remains the single-ring recipe. v2 adds one optional interior cutout.
export function extrudeReferenceProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('Expected a profile recipe object');
  const v2 = input.contract_id === EXTRUSION_CUTOUT_CONTRACT;
  if (!v2 && input.contract_id !== EXTRUSION_CONTRACT) reject(`contract_id must be ${EXTRUSION_CONTRACT} or ${EXTRUSION_CUTOUT_CONTRACT}`);
  if (Object.keys(input).some(key => !['contract_id', 'name', 'units', 'coordinate_frame', 'vertices', 'height', ...(v2 ? ['cutout'] : [])].includes(key))) reject('Unexpected profile recipe field');
  if (v2 && !Object.hasOwn(input, 'cutout')) reject('v2 requires cutout: null for no opening, or one ordered XY point array');
  if (typeof input.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(input.name)) reject('name must be 1–80 alphanumeric, dot, dash or underscore characters, starting alphanumeric');
  if (input.coordinate_frame !== 'xy-z-up') reject('coordinate_frame must be xy-z-up: outline in XY at Z=0, extrusion toward +Z');
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[input.units];
  if (typeof input.units !== 'string' || typeof factor !== 'number') reject('Explicit units required: mm, cm, m or in');
  const readRing = (ring, label) => {
    if (!Array.isArray(ring) || ring.length < 3 || ring.length > 128) reject(`${label} needs 3 through 128 ordered XY points, without repeating the first`);
    return ring.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n * factor) > 1e6)) reject('Each XY point must contain two finite numbers within ±1000000 mm');
      return point.map(n => n * factor);
    });
  };
  const outerPoints = readRing(input.vertices, 'vertices');
  const holePoints = v2 && input.cutout !== null ? readRing(input.cutout, 'cutout') : null;
  const height = input.height * factor;
  if (typeof input.height !== 'number' || !Number.isFinite(height) || height < 1e-6 || height > 1e6) reject('height must be positive and between 0.000001 and 1000000 mm after unit conversion');
  const { points, rings, caps, outerArea, holeArea, area } = triangulateReferenceProfile(outerPoints, holePoints);
  const count = points.length;
  const vertices = [...points.map(([x, y]) => [x, y, 0]), ...points.map(([x, y]) => [x, y, height])];
  const triangles = [], faces = [];
  for (const cap of caps) {
    triangles.push([cap[2], cap[1], cap[0]]); faces.push({ kind: 'bottom', profile_vertex_indices: [cap[2], cap[1], cap[0]] });
    triangles.push(cap.map(i => i + count)); faces.push({ kind: 'top', profile_vertex_indices: [...cap] });
  }
  for (const [ringIndex, ring] of rings.entries()) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    triangles.push([a, b, b + count], [a, b + count, a + count]);
    const lineage = { kind: 'side', profile_edge: [a, b], ...(v2 ? { ring: ringIndex === 0 ? 'outer' : 'cutout' } : {}) };
    faces.push({ ...lineage }, { ...lineage, profile_edge: [...lineage.profile_edge] });
  }
  const recipe = { contract_id: input.contract_id, name: input.name, units: input.units, coordinate_frame: input.coordinate_frame, vertices: input.vertices.map(point => [...point]), height: input.height,
    ...(v2 ? { cutout: input.cutout === null ? null : input.cutout.map(point => [...point]) } : {}) };
  const recipeHash = createHash('sha256').update(canonicalJson(recipe)).digest('hex');
  const text = `# MoonMold profile extrusion; derived reference; units mm\n# editable profile recipe ${recipeHash}\n` + vertices.map(p => `v ${p.join(' ')}`).join('\n') + '\n' + triangles.map(face => `f ${face.map(i => i + 1).join(' ')}`).join('\n') + '\n';
  const result = composeReferenceLayout({ contract_id: 'moonmold.reference-layout.v1', name: input.name, instances: [{ id: input.name, source: { input_format: 'obj', units: 'mm', name: input.name, text } }] });
  result.extrusion = { contract_id: `moonmold.reference-profile-extrusion-report.${v2 ? 'v2' : 'v1'}`, recipe_sha256: recipeHash,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256, recipe,
    coordinate_frame: 'XY profile at Z=0; extrusion along +Z; output XYZ in millimetres',
    source_winding: outerArea > 0 ? 'counterclockwise' : 'clockwise', height_mm: height, profile_area_mm2: area,
    ...(v2 ? { outer_area_mm2: Math.abs(outerArea) / 2, cutout_area_mm2: Math.abs(holeArea) / 2,
      cutout_winding: holePoints ? holeArea > 0 ? 'counterclockwise' : 'clockwise' : null,
      profile_vertex_lineage: points.map((_, i) => ({ ring: i < outerPoints.length ? 'outer' : 'cutout', vertex_index: i < outerPoints.length ? i : i - outerPoints.length })) } : {}),
    cap_triangle_count: caps.length, triangle_lineage: faces,
    losses: ['OBJ/STL and ordinary layout contain triangulated reference geometry; retain the profile recipe to edit the outline or height',
      v2 ? 'One simple outer ring and at most one strictly interior polygon cutout; no multiple openings, nested islands, curves, bevels, parametric CAD constraints or solid boolean operations' : 'One simple straight-edged ring only; no holes, curves, bevels, parametric CAD constraints or solid boolean operations',
      'Binary64 arithmetic and a span-squared times 1e-12 cross-product rejection band apply; no certified dimensional tolerance'],
    qualification, physical_authority: false };
  result.exports.recipe = JSON.stringify(recipe, null, 2) + '\n';
  result.qualification = qualification;
  return result;
}
