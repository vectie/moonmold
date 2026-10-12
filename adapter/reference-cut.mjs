import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const CUT_CONTRACT = 'moonmold.reference-layout-cut.v1';
export const CUT_MAX_FILE_BYTES = 3_100_000;
const reject = message => { throw new AdapterRejection('invalid-reference-cut', message); };
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const object = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) reject(`${label} must be an object with only ${fields.join(', ')}`);
};
const nonzeroArea = (a,b,c) => {
  const u = b.map((n,i) => n-a[i]), v = c.map((n,i) => n-a[i]);
  return Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) > 0;
};

// Clip triangles, never a solid. Edge keys retain connectivity only when source
// indices already share it; equal coordinates with distinct IDs are not welded.
function clipPart(composed, part, plane) {
  const axis = ['x','y','z'].indexOf(plane.axis), position = plane.position_mm;
  const sign = plane.keep === 'positive' ? 1 : -1;
  const vertices = [], triangles = [], triangleSources = [], indices = new Map(), points = new Map();
  const point = key => points.get(key);
  const original = index => {
    const key = `v${index}`;
    if (!points.has(key)) points.set(key, composed.vertices[part.vertex_range.start+index]);
    return key;
  };
  const distance = key => sign*(point(key)[axis]-position);
  const intersection = (a,b) => {
    if (point(a)[axis] === position) return a;
    if (point(b)[axis] === position) return b;
    // Canonical endpoint order makes shared edges produce bit-identical points.
    const [first,second] = a < b ? [a,b] : [b,a], key = `${first}:${second}`;
    if (!points.has(key)) {
      const p = point(first), q = point(second), t = (position-p[axis])/(q[axis]-p[axis]);
      const cut = p.map((n,i) => i === axis ? position : n + (q[i]-n)*t);
      if (cut.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) reject('Cut intersection exceeds the coordinate range');
      points.set(key, cut);
    }
    return key;
  };
  const index = key => {
    if (!indices.has(key)) { indices.set(key,vertices.length); vertices.push(point(key)); }
    return indices.get(key);
  };
  const counts = { unchanged_triangles: 0, crossed_triangles: 0, excluded_triangles: 0, boundary_only_triangles: 0, precision_discarded_triangles: 0 };
  for (let local = 0; local < part.triangle_range.count; local++) {
    const face = composed.triangles[part.triangle_range.start+local].map(i => original(i-part.vertex_range.start));
    const ds = face.map(distance);
    if (ds.every(d => d >= 0)) counts.unchanged_triangles++;
    else if (ds.every(d => d < 0)) { counts.excluded_triangles++; continue; }
    else if (!ds.some(d => d > 0)) { counts.boundary_only_triangles++; continue; }
    else counts.crossed_triangles++;
    const polygon = [];
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i+1)%3], ai = distance(a) >= 0, bi = distance(b) >= 0;
      if (ai) polygon.push(a);
      if (ai !== bi) polygon.push(intersection(a,b));
    }
    const unique = polygon.filter((key,i) => i === 0 || key !== polygon[i-1]);
    if (unique.length > 1 && unique[0] === unique.at(-1)) unique.pop();
    for (let i = 1; i+1 < unique.length; i++) {
      const keys = [unique[0],unique[i],unique[i+1]];
      if (!nonzeroArea(...keys.map(point))) { counts.precision_discarded_triangles++; continue; }
      triangles.push(keys.map(index)); triangleSources.push(local);
      if (triangles.length > 40_000 || vertices.length > 40_000) reject('Cut exceeds 40000 vertices or triangles; split the input into smaller selections');
    }
  }
  return { vertices, triangles, triangleSources, counts };
}

// A saved recipe embeds the normalized original layout. Reopening it reevaluates
// that original, while the resulting ordinary layout edits the derived mesh.
export function cutReferenceLayout(input) {
  object(input, ['contract_id','layout','instance_ids','plane'], 'cut request');
  if (input.contract_id !== undefined && input.contract_id !== CUT_CONTRACT) reject(`contract_id must be ${CUT_CONTRACT}`);
  const ids = input.instance_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) reject('instance_ids needs 1 through 16 unique instance IDs');
  object(input.plane, ['axis','position_mm','keep'], 'plane');
  const { axis, position_mm, keep } = input.plane;
  if (!['x','y','z'].includes(axis)) reject('plane axis must be x, y or z');
  if (typeof position_mm !== 'number' || !Number.isFinite(position_mm) || Math.abs(position_mm) > 1e9) reject('plane position_mm must be finite and within ±1000000000');
  if (!['positive','negative'].includes(keep)) reject('plane keep must be positive or negative');
  const before = composeReferenceLayout(input.layout);
  if (ids.some(id => !before.parts.some(part => part.id === id))) reject('Every cut instance must exist in the layout');
  const plane = { axis, position_mm: position_mm === 0 ? 0 : position_mm, keep };
  const instance_ids = before.parts.filter(part => ids.includes(part.id)).map(part => part.id);
  const recipe = { contract_id: CUT_CONTRACT, layout: before.layout, instance_ids, plane };
  const recipeHash = hash(recipe);
  const recipeText = JSON.stringify(recipe,null,2)+'\n';
  if (Buffer.byteLength(recipeText) > CUT_MAX_FILE_BYTES) reject('Saved cut recipe exceeds 3100000 bytes');
  const instances = [], observations = [];
  for (let i = 0; i < before.parts.length; i++) {
    const part = before.parts[i], instance = before.layout.instances[i];
    if (!ids.includes(part.id)) { instances.push(instance); continue; }
    const clipped = clipPart(before,part,plane);
    const observation = { instance_id: part.id, source_sha256: part.source_sha256,
      source_format: part.source_format, source_units: part.source_units,
      source_transform: part.transform, source_losses: part.losses,
      parent_vertex_range: part.vertex_range, parent_triangle_range: part.triangle_range,
      status: clipped.triangles.length ? 'retained-derived' : 'removed-empty',
      output_triangle_count: clipped.triangles.length,
      output_triangle_parent_local_indices: clipped.triangleSources, ...clipped.counts };
    observations.push(observation);
    if (!clipped.triangles.length) continue;
    const obj = `# MoonMold open surface cut; units mm; no caps\n# parent layout ${before.layout_sha256}\n# source bytes ${part.source_sha256}\n# cut recipe ${recipeHash}\n# world ${plane.axis} ${plane.keep === 'positive' ? '>=' : '<='} ${plane.position_mm} mm\n` +
      clipped.vertices.map(p => `v ${p.join(' ')}`).join('\n')+'\n'+clipped.triangles.map(face => `f ${face.map(n => n+1).join(' ')}`).join('\n')+'\n';
    if (Buffer.byteLength(obj) > 400_000) reject(`${part.id}: derived cut source exceeds 400000 bytes; use a smaller reference`);
    instances.push({ id: instance.id, source: { name: instance.id, input_format: 'obj', units: 'mm', text: obj } });
  }
  if (!instances.length) reject('Cut leaves no triangle surfaces; choose another plane or keep side');
  const result = composeReferenceLayout({ ...before.layout, instances });
  result.cut = { contract_id: 'moonmold.reference-layout-cut-report.v1',
    recipe_sha256: recipeHash, parent_layout_sha256: before.layout_sha256,
    parent_geometry_sha256: before.geometry_sha256, layout_sha256: result.layout_sha256,
    geometry_sha256: result.geometry_sha256, instance_ids, plane, parts: observations,
    coordinate_frame: 'Placed layout XYZ in millimetres; plane evaluated after the complete source placement',
    boundary_policy: 'Keep the plane inclusively; coplanar triangles retained, isolated edge/point contacts omitted. Exact IEEE double comparison, no tolerance snapping or welding.',
    losses: ['Cut triangles are retriangulated with their winding retained; no cut caps are added, and a closed input may become open',
      'Selected output sources bake units, selections and placements into new millimetre OBJ geometry; unused vertices and object/group labels are omitted',
      'Original bytes, units, selections and transforms remain in the separate cut recipe; keep that recipe to change the plane from the original',
      'Output triangle parent indices address the composed selected input mesh, not stable vertex IDs across source revisions'],
    qualification: 'Unqualified reference surface extraction; no solid boolean, topology repair, watertightness, engineering or manufacturing assessment', physical_authority: false };
  result.exports.recipe = recipeText;
  return result;
}
