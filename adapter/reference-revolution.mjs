import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { triangulateReferenceProfile } from './reference-profile-caps.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const REVOLUTION_CONTRACT = 'moonmold.reference-revolution.v1';
export const REVOLUTION_MAX_BYTES = 16000;
const reject = message => { throw new AdapterRejection('invalid-reference-revolution', message); };

// A simple radius/height boundary swept around +Z, with one shared seam.
export function revolveReferenceProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.contract_id !== REVOLUTION_CONTRACT) reject('Expected a reference-revolution.v1 recipe');
  if (Object.keys(input).some(k => !['contract_id', 'name', 'units', 'coordinate_frame', 'vertices', 'segments'].includes(k))) reject('Unexpected revolution recipe field');
  if (typeof input.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(input.name)) reject('Use a bounded reference name');
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4 }[input.units];
  if (typeof factor !== 'number' || input.coordinate_frame !== 'radius-z') reject('Declare units mm, cm, m or in and radius-z coordinates');
  if (!Number.isInteger(input.segments) || input.segments < 8 || input.segments > 64) reject('Full revolution requires 8–64 explicit angular segments');
  if (!Array.isArray(input.vertices) || input.vertices.length < 3 || input.vertices.length > 32) reject('Use 3–32 radius,height boundary points');
  const points = input.vertices.map(p => {
    if (!Array.isArray(p) || p.length !== 2 || p.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v * factor) > 100000)) reject('Finite radius,height pairs within 100000 mm are required');
    if (p[0] * factor < 0.001) reject('Every radius must be at least 0.001 mm; axis-touching and axis-crossing profiles are unsupported');
    return p.map(v => v * factor);
  });
  const { rings: [ring] } = triangulateReferenceProfile(points);
  const count = points.length, sectors = input.segments, vertices = [], triangles = [];
  for (let s = 0; s < sectors; s++) {
    const angle = 2 * Math.PI * s / sectors;
    for (const [r, z] of points) vertices.push([r * Math.cos(angle), r * Math.sin(angle), z]);
  }
  for (let s = 0; s < sectors; s++) for (let e = 0; e < count; e++) {
    const i = ring[e], j = ring[(e + 1) % count], next = (s + 1) % sectors;
    const a = s * count + i, b = s * count + j, c = next * count + i, d = next * count + j;
    triangles.push([a, c, b], [b, c, d]);
  }
  const recipe = { contract_id: REVOLUTION_CONTRACT, name: input.name, units: input.units, coordinate_frame: 'radius-z', vertices: input.vertices.map(p => [...p]), segments: sectors };
  const digest = createHash('sha256').update(canonicalJson(recipe)).digest('hex');
  const text = '# Faceted full revolution in millimetres; editable recipe ' + digest + '\n' + vertices.map(p => `v ${p.join(' ')}`).join('\n') + '\n' + triangles.map(t => `f ${t.map(i => i + 1).join(' ')}`).join('\n') + '\n';
  const result = composeReferenceLayout({ contract_id: 'moonmold.reference-layout.v1', name: recipe.name, instances: [{ id: recipe.name, source: { input_format: 'obj', units: 'mm', name: recipe.name, text } }] });
  const qualification = 'Faceted digital reference only; no engineering CAD, certified tolerance, Blender qualification, manufacturing or physical authority.';
  result.revolution = { contract_id: 'moonmold.reference-revolution-report.v1', recipe, recipe_sha256: digest, geometry_sha256: result.geometry_sha256, layout_sha256: result.layout_sha256,
    angle_degrees: 360, segments: sectors, coordinate_frame: 'XYZ millimetres; radius about +Z, zero angle at +X',
    maximum_radial_chord_deviation_mm: Math.max(...points.map(p => p[0])) * (1 - Math.cos(Math.PI / sectors)),
    losses: ['Circular sweeps are replaced by explicit planar angular facets; reported chord deviation is geometric approximation, not certified tolerance.', 'Only one simple straight-edged radial boundary away from the axis; no partial sweeps, holes in the radial profile, curved profiles or parametric constraints.', 'OBJ/STL/layout retain triangulated reference geometry; keep the recipe for radius/height editing. Binary64 arithmetic applies.'], qualification, physical_authority: false };
  result.exports.recipe = JSON.stringify(recipe, null, 2) + '\n';
  result.qualification = qualification;
  return result;
}
