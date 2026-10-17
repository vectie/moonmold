import { createHash } from 'node:crypto';
import { AdapterRejection } from './protocol.mjs';
import { EXTRUSION_CONTRACT, extrudeReferenceProfile } from './reference-extrusion.mjs';

export const DXF_PROFILE_MAX_BYTES = 400_000;
const reject = message => { throw new AdapterRejection('invalid-reference-dxf-profile', message); };
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function number(value, label) {
  if (!decimal.test(value) || !Number.isFinite(Number(value))) reject(`${label} must be a finite decimal`);
  if (Number(value) === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) reject(`${label} underflows the supported numeric range`);
  return Number(value);
}
function integer(value, label) {
  if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) reject(`${label} must be an exact integer`);
  return Number(value);
}
function one(groups, code, fallback) {
  const values = groups.filter(g => g.code === code);
  if (values.length > 1) reject(`Duplicate DXF group ${code}`);
  return values.length ? values[0].value : fallback;
}

// This is a bounded drawing reader, not an AutoCAD interpreter. It never follows
// blocks, references, filenames, scripts or external resources in a drawing.
function parseDrawing(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > DXF_PROFILE_MAX_BYTES) reject('DXF must be text no larger than 400000 UTF-8 bytes');
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) reject('Only ASCII DXF is supported; binary and non-ASCII drawings must be converted first');
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.some(line => line.includes('\r')) || lines.length % 2 || lines.length > 40_000) reject('DXF needs complete code/value line pairs, at most 20000 pairs');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = integer(lines[i].trim(), `Group code at line ${i + 1}`);
    if (code < 0 || code > 1071) reject(`Unsupported group code at line ${i + 1}`);
    pairs.push({ code, value: lines[i + 1].trim(), line: i + 1 });
  }
  const sections = [], entities = [];
  let active = null, record = null, ended = false, comments = 0;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (ended) reject('Data follows the DXF EOF marker');
    if (pair.code === 999) { comments++; continue; }
    if (pair.code === 0 && pair.value === 'SECTION') {
      if (active !== null || pairs[i + 1]?.code !== 2) reject('Malformed DXF section start');
      active = pairs[++i].value;
      if (!active || sections.includes(active)) reject('DXF section names must be nonempty and unique');
      sections.push(active); record = null;
    } else if (pair.code === 0 && pair.value === 'ENDSEC') {
      if (active === null) reject('Unexpected DXF ENDSEC');
      active = null; record = null;
    } else if (pair.code === 0 && pair.value === 'EOF') {
      if (active !== null) reject('DXF section is not closed before EOF');
      ended = true;
    } else {
      if (active === null) reject('DXF data outside a section');
      if (active === 'ENTITIES') {
        if (pair.code === 0) {
          if (!/^[A-Z][A-Z0-9_]*$/.test(pair.value)) reject('Invalid DXF entity type');
          if (entities.length >= 1000) reject('DXF exceeds 1000 entities');
          record = { type: pair.value, index: entities.length + 1, line: pair.line, groups: [] };
          entities.push(record);
        } else {
          if (!record) reject('DXF ENTITIES contains data before its first entity');
          record.groups.push(pair);
        }
      }
    }
  }
  if (!ended || active !== null || !sections.includes('ENTITIES')) reject('DXF requires a complete ENTITIES section and EOF');
  return { entities, sections, comments, source_sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

function polyline(entity) {
  const g = entity.groups;
  one(g, 8, '0'); one(g, 5, null);
  // Geometry-affecting extensions are rejected. Common display/identity tags
  // are tolerated but do not define the selected outline's shape or units.
  const allowed = new Set([5, 330, 100, 8, 6, 62, 420, 430, 440, 48, 60, 370, 390, 347, 67, 410, 90, 70, 43, 38, 39, 10, 20, 91, 40, 41, 42, 210, 220, 230]);
  for (const group of g) if (!allowed.has(group.code)) reject(`Unsupported LWPOLYLINE group ${group.code}`);
  const count = integer(one(g, 90, ''), 'Vertex count');
  if (count < 3 || count > 128) reject('Selected outline needs 3–128 vertices');
  const flags = integer(one(g, 70, '0'), 'Polyline flags');
  if (flags !== 1 && flags !== 129) reject('Select a closed straight LWPOLYLINE (closed flag required)');
  if (integer(one(g, 67, '0'), 'Space flag') !== 0) reject('Paper-space outlines are unsupported; choose model-space geometry');
  if (one(g, 410, 'Model') !== 'Model') reject('Only the Model layout is supported; paper-space layouts are not imported');
  for (const code of [38, 39, 43]) if (number(one(g, code, '0'), `Group ${code}`) !== 0) reject('Nonzero elevation, thickness or width is unsupported');
  for (const [code, expected] of [[210, 0], [220, 0], [230, 1]]) if (number(one(g, code, String(expected)), `Group ${code}`) !== expected) reject('Only the default XY extrusion normal (0,0,1) is supported');
  const vertices = []; let vertex = null;
  for (const group of g) {
    if (group.code === 10) {
      if (vertex && vertex.y === undefined) reject('Each vertex requires one X and one Y');
      vertex = { x: number(group.value, 'Vertex X'), tags: new Set([10]) }; vertices.push(vertex);
    } else if ([20, 40, 41, 42, 91].includes(group.code)) {
      if (!vertex || vertex.tags.has(group.code)) reject('Misordered or duplicate per-vertex group');
      vertex.tags.add(group.code);
      if (group.code === 20) vertex.y = number(group.value, 'Vertex Y');
      else if (group.code === 91) integer(group.value, 'Vertex identifier');
      else if (number(group.value, `Vertex group ${group.code}`) !== 0) reject('Curved bulges and variable widths are unsupported; convert to a straight zero-width outline explicitly');
    }
  }
  if (vertices.length !== count || vertices.some(v => v.y === undefined)) reject('Declared vertex count and complete XY pairs must agree');
  return vertices.map(v => [v.x, v.y]);
}

function inventory(drawing) {
  const counts = {};
  const candidates = drawing.entities.filter(e => e.type === 'LWPOLYLINE').map(entity => {
    let vertices = null, reason = null;
    try { vertices = polyline(entity); } catch (error) { reason = error.message; }
    return { entity_index: entity.index, source_line: entity.line,
      layer: entity.groups.find(g => g.code === 8)?.value ?? '0',
      handle: entity.groups.find(g => g.code === 5)?.value ?? null,
      supported: vertices !== null, vertex_count: vertices?.length ?? null, reason };
  });
  for (const entity of drawing.entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return { contract_id: 'moonmold.reference-dxf-inventory.v1', source_sha256: drawing.source_sha256,
    entity_count: drawing.entities.length, entity_type_counts: counts, candidates,
    omitted_sections: drawing.sections.filter(s => s !== 'ENTITIES'), comment_count: drawing.comments,
    qualification: 'Straight closed model-space LWPOLYLINE candidates only; simple-ring geometry is validated when built. Units must be chosen explicitly; header unit hints are not applied.', physical_authority: false };
}

export function inspectReferenceDxf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'text')) reject('Expected {text} only');
  return inventory(parseDrawing(input.text));
}

export function importReferenceDxfProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['text', 'entity', 'units', 'height', 'name'].includes(key))) reject('Expected text, entity, units, height and name only');
  const drawing = parseDrawing(input.text);
  if (!Number.isSafeInteger(input.entity) || input.entity < 1) reject('Choose an explicit one-based ENTITIES entity index');
  const selected = drawing.entities[input.entity - 1];
  if (!selected || selected.type !== 'LWPOLYLINE') reject('Selected entity must be a LWPOLYLINE in this drawing');
  const vertices = polyline(selected);
  const result = extrudeReferenceProfile({ contract_id: EXTRUSION_CONTRACT, name: input.name, units: input.units, coordinate_frame: 'xy-z-up', vertices, height: input.height });
  const review = inventory(drawing);
  result.dxf_import = { contract_id: 'moonmold.reference-dxf-profile-import.v1',
    source_sha256: drawing.source_sha256, entity_index: input.entity, source_line: selected.line,
    layer: one(selected.groups, 8, '0'), handle: one(selected.groups, 5, null),
    source_units: input.units, recipe_sha256: result.extrusion.recipe_sha256,
    geometry_sha256: result.geometry_sha256, layout_sha256: result.layout_sha256,
    omitted_entity_count: drawing.entities.length - 1, entity_type_counts: review.entity_type_counts,
    omitted_sections: review.omitted_sections, comment_count: drawing.comments,
    losses: ['Only the selected outline was imported; other entities, sections, display styling and drawing constraints are not modeled',
      'Drawing header unit hints are not applied; the operator explicitly interprets XY coordinates and extrusion height in the chosen units',
      'Profile JSON is an editable derivative, not a DXF archive. Keep original drawing bytes and this report to correlate the original import; later recipe edits have new identity'],
    qualification: result.qualification, physical_authority: false };
  return result;
}
