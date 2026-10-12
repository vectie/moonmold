import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

export const PLACEMENTS_CONTRACT = 'moonmold.reference-placements.v1';
export const PLACEMENTS_MAX_BYTES = 16000;
export const PLACEMENT_COLUMNS = Object.freeze([
  'contract_id', 'base_layout_sha256', 'instance_id', 'source_sha256', 'source_format', 'source_units',
  'scale', 'rotation_x_deg', 'rotation_y_deg', 'rotation_z_deg', 'center_and_ground',
  'translation_x_mm', 'translation_y_mm', 'translation_z_mm',
]);
const reject = message => { throw new AdapterRejection('invalid-reference-placements', message); };
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Bounded RFC-style comma CSV. Quoted cells and UTF-8 BOM allow spreadsheet
// round trips; no formulas or locale-dependent numeric coercion are evaluated.
function parseCsv(csv) {
  if (typeof csv !== 'string' || !csv.length || Buffer.byteLength(csv) > PLACEMENTS_MAX_BYTES || /[\uD800-\uDFFF]/u.test(csv)) reject('Placement CSV must be valid UTF-8 text, 1–16000 bytes');
  const text = csv.replace(/^\uFEFF/, ''), rows = [];
  let row = [], cell = '', state = 'start';
  const finishCell = () => { row.push(cell); cell = ''; state = 'start'; };
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > 17) reject('Placement CSV allows one header and at most 16 rows'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else state = 'closed'; }
      else cell += c;
    } else if (c === ',') finishCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r') { if (text[i + 1] !== '\n') reject('Use LF or CRLF line endings'); i++; }
      finishRow();
    } else if (state === 'closed') reject('Unexpected text after closing CSV quote');
    else if (c === '"') { if (state !== 'start') reject('Quote must begin a CSV cell'); state = 'quoted'; }
    else { cell += c; state = 'plain'; }
  }
  if (state === 'quoted') reject('Unterminated quoted CSV cell');
  if (row.length || cell.length || state !== 'start') finishRow();
  if (rows.length < 2 || canonicalJson(rows[0]) !== canonicalJson(PLACEMENT_COLUMNS)) reject('Use the complete exported placement CSV header, unchanged');
  return rows.slice(1);
}

export function exportReferencePlacements(layout) {
  const current = composeReferenceLayout(layout);
  const rows = current.parts.map(part => [PLACEMENTS_CONTRACT, current.layout_sha256, part.id, part.source_sha256,
    part.source_format, part.source_units, part.transform.scale, ...part.transform.rotation_deg,
    part.transform.center_and_ground, ...part.transform.translation_mm]);
  // All identity cells are validated identifiers/hex, never source names or
  // arbitrary strings, so no exported cell can become a spreadsheet formula.
  return { contract_id: PLACEMENTS_CONTRACT, layout_sha256: current.layout_sha256,
    geometry_sha256: current.geometry_sha256, instance_count: current.instance_count,
    csv: [PLACEMENT_COLUMNS, ...rows].map(row => row.join(',')).join('\r\n') + '\r\n',
    physical_authority: false };
}

export function applyReferencePlacements(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['layout', 'csv'].includes(key))) reject('Placement request accepts only layout and csv');
  const rows = parseCsv(input.csv), before = composeReferenceLayout(input.layout);
  if (rows.length !== before.instance_count) reject('Keep exactly one row for every instance; do not add or remove rows');
  const candidate = structuredClone(before.layout), used = new Set();
  const decimal = (text, label) => {
    // Trim whitespace around numeric/boolean data only. Identity cells are exact.
    const value = text.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) reject(`${label} must be a finite decimal number, not a formula`);
    return Number(value);
  };
  for (const [index, row] of rows.entries()) {
    if (row.length !== PLACEMENT_COLUMNS.length) reject(`Row ${index + 2} must have ${PLACEMENT_COLUMNS.length} cells`);
    const [contract, base, id, sourceSha, format, units] = row;
    if (contract !== PLACEMENTS_CONTRACT) reject(`Row ${index + 2} has an unsupported contract`);
    if (base !== before.layout_sha256) reject('Stale placement table: export again from this exact applied layout');
    const part = before.parts.find(item => item.id === id);
    if (!part || used.has(id)) reject(`Unknown or duplicate instance: ${id}`);
    if (sourceSha !== part.source_sha256 || format !== part.source_format || units !== part.source_units) reject(`Source identity or units changed for ${id}; keep identity columns unchanged`);
    used.add(id);
    if (!/^(true|false)$/i.test(row[10].trim())) reject(`${id}: center_and_ground must be true or false`);
    candidate.instances.find(item => item.id === id).transform = {
      scale: decimal(row[6], `${id} scale`),
      rotation_deg: row.slice(7, 10).map((cell, axis) => decimal(cell, `${id} rotation ${axis}`)),
      center_and_ground: row[10].trim().toLowerCase() === 'true',
      translation_mm: row.slice(11, 14).map((cell, axis) => decimal(cell, `${id} translation ${axis}`)),
    };
  }
  // Delegate all actual geometry/transform semantics and bounds to the existing
  // product composer. A failed row or composition never mutates the input.
  const result = composeReferenceLayout(candidate);
  result.placement_table = {
    contract_id: PLACEMENTS_CONTRACT,
    parent_layout_sha256: before.layout_sha256, parent_geometry_sha256: before.geometry_sha256,
    layout_sha256: result.layout_sha256, geometry_sha256: result.geometry_sha256,
    csv_sha256: sha256(input.csv),
    changed_instances: before.parts.flatMap((part, i) => canonicalJson(part.transform) === canonicalJson(result.parts[i].transform) ? [] : [{
      instance_id: part.id, source_sha256: part.source_sha256, source_format: part.source_format, source_units: part.source_units,
      before_transform: part.transform, after_transform: result.parts[i].transform,
      before_bounds_mm: part.bounds, after_bounds_mm: result.parts[i].bounds,
    }]),
    semantics: 'Absolute placement replacement, keyed by instance ID. Row order does not reorder instances. Source bytes, units and selectors are retained.',
    limitations: ['One-time batch placement edit, not a spreadsheet link or persistent constraint.',
      'Existing scale/rotation/ground/translation order and reference bounds apply. No topology, collision, accuracy or physical-use qualification.',
      'Save the editable layout and this inspection report; CSV alone does not contain source meshes.'],
    physical_authority: false,
  };
  return result;
}
