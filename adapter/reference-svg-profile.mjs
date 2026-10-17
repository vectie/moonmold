import { createHash } from 'node:crypto';
import { AdapterRejection, canonicalJson } from './protocol.mjs';
import { EXTRUSION_CONTRACT, EXTRUSION_CUTOUT_CONTRACT, extrudeReferenceProfile } from './reference-extrusion.mjs';
import { parseAbsolutePath, flattenAbsolutePath } from './reference-svg-path.mjs';
import { flattenBasicEllipse } from './reference-svg-basic.mjs';

export const SVG_PROFILE_MAX_BYTES = 400_000;
export const SVG_PROFILE_IMPORT_CONTRACT = 'moonmold.reference-svg-profile-import.v1';
export const SVG_PATH_IMPORT_CONTRACT = 'moonmold.reference-svg-profile-import.v2';
export const SVG_BASIC_IMPORT_CONTRACT = 'moonmold.reference-svg-profile-import.v3';
export const SVG_CUTOUT_IMPORT_CONTRACT = 'moonmold.reference-svg-profile-import.v4';
const outlineTags = ['polygon', 'polyline', 'path', 'rect', 'circle', 'ellipse'];
const basicAttributes = { rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'] };
const reject = message => { throw new AdapterRejection('invalid-reference-svg-profile', message); };
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const drawingTags = new Set(['polygon', 'polyline', 'path', 'rect', 'circle', 'ellipse', 'line', 'text', 'use', 'image']);
const containers = new Set(['svg', 'g', 'defs', 'symbol', 'clipPath', 'mask']);
const displayAttributes = ['id', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-opacity', 'opacity'];
const coordinateConvention = 'svg-y-down-to-xy-y-up';

function number(value, label) {
  if (!decimal.test(value) || !Number.isFinite(Number(value))) reject(`${label} must be a finite decimal`);
  if (Number(value) === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) reject(`${label} underflows the supported numeric range`);
  return Number(value);
}

// Deliberately a small XML reader. No DOM rendering, entity expansion, scripts,
// stylesheets, reference resolution or external resource reads. Selected paths
// use the separate strict bounded absolute-command parser.
function decodeAttribute(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) reject('Only predefined and numeric XML entities are supported');
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity in named) return named[entity];
    const point = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isSafeInteger(point) || point < 32 && ![9, 10, 13].includes(point) || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff || [0xfffe, 0xffff].includes(point)) reject('Invalid XML character entity');
    return String.fromCodePoint(point);
  });
}

function attributes(raw) {
  const attrs = Object.create(null);
  const attribute = /\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  let offset = 0;
  while (raw.slice(offset).trim()) {
    attribute.lastIndex = offset; const match = attribute.exec(raw);
    if (!match) reject('SVG attributes must be distinct, quoted XML attributes');
    if (Object.hasOwn(attrs, match[1])) reject(`Duplicate SVG attribute ${match[1]}`);
    attrs[match[1]] = decodeAttribute(match[2] ?? match[3]); offset = attribute.lastIndex;
  }
  return attrs;
}

function parseDrawing(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > SVG_PROFILE_MAX_BYTES) reject('SVG must be UTF-8 text no larger than 400000 bytes');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.toString('utf8') !== text || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(text)) reject('SVG contains unsupported XML characters');
  const xml = text.replace(/^\ufeff/, '').replace(/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])UTF-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>/i, '');
  const tokens = /<!--[\s\S]*?-->|<\/[A-Za-z_][A-Za-z0-9_.:-]*\s*>|<[A-Za-z_][A-Za-z0-9_.:-]*(?:\s+[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/gy;
  const stack = [], elements = [], shapes = []; let offset = 0, root = null, commentCount = 0;
  while (offset < xml.length) {
    tokens.lastIndex = offset; const match = tokens.exec(xml);
    if (!match) reject('Unsupported or malformed SVG XML; DTD, CDATA and processing instructions are not supported');
    const token = match[0]; offset = tokens.lastIndex;
    if (token.startsWith('<!--')) { if (token.slice(4, -3).includes('--')) reject('Malformed SVG XML comment'); commentCount++; continue; }
    if (!token.startsWith('<')) {
      if (token.trim() && !['title', 'desc', 'text'].includes(stack.at(-1)?.tag)) reject('Unexpected text outside an SVG text element');
      decodeAttribute(token); continue;
    }
    if (token.startsWith('</')) {
      const tag = token.slice(2, -1).trim(); if (stack.pop()?.tag !== tag) reject('SVG XML elements must close in order'); continue;
    }
    const parts = /^<([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*?)(\/?)>$/.exec(token), tag = parts[1];
    if (!containers.has(tag) && !drawingTags.has(tag) && !['title', 'desc'].includes(tag)) reject(`Unsupported SVG element <${tag}>; convert to an unstyled polygon or closed polyline`);
    if (elements.length >= 1000 || stack.length >= 32) reject('SVG exceeds 1000 elements or 32 nesting levels');
    if (!root && tag !== 'svg' || root && stack.length === 0) reject('SVG requires exactly one root <svg> element');
    if (root && tag === 'svg') reject('Nested SVG viewports are unsupported');
    if (stack.some(parent => drawingTags.has(parent.tag) || ['title', 'desc'].includes(parent.tag))) reject('Nested content inside drawing/text elements is unsupported');
    const node = { tag, attrs: attributes(parts[2]), index: elements.length + 1, parents: [...stack] };
    if (tag === 'svg' && node.attrs.xmlns !== undefined && node.attrs.xmlns !== 'http://www.w3.org/2000/svg') reject('Root namespace must be the SVG namespace');
    if (Object.keys(node.attrs).some(key => /^on/i.test(key))) reject('SVG event handlers are unsupported');
    elements.push(node); if (!root) root = node;
    if (drawingTags.has(tag)) shapes.push(node);
    if (!parts[3]) stack.push(node);
  }
  if (!root || stack.length) reject('SVG requires a complete root element');
  return { root, elements, shapes, commentCount, bytes, source_sha256: createHash('sha256').update(bytes).digest('hex') };
}

function outline(node) {
  if (!node || !outlineTags.includes(node.tag)) reject('Select a supported closed outline or basic shape from the inventory');
  for (const ancestor of [...node.parents, node]) {
    if (!['svg', 'g', ...outlineTags].includes(ancestor.tag)) reject(`Outline inside <${ancestor.tag}> is unsupported; use a directly drawn outline`);
    const allowed = new Set([...displayAttributes, ...(ancestor.tag === 'svg' ? ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'version'] : []), ...(['polygon', 'polyline'].includes(ancestor.tag) ? ['points'] : []), ...(ancestor.tag === 'path' ? ['d'] : []), ...(basicAttributes[ancestor.tag] ?? [])]);
    for (const key of Object.keys(ancestor.attrs)) if (!allowed.has(key)) reject(`Unsupported ${key} on <${ancestor.tag}>; transforms, CSS, clipping and references must be resolved explicitly before import`);
    if (node.tag === 'path' && 'fill-rule' in ancestor.attrs) reject('Path fill-rule interpretation is unsupported; supply a single simple contour without fill-rule');
  }
  if (node.tag === 'path') return { path: parseAbsolutePath(node.attrs.d), points: null, removed_closing_endpoint: null };
  if (basicAttributes[node.tag]) {
    const read = (key, fallback) => number(node.attrs[key] ?? fallback, `SVG ${node.tag} ${key}`);
    if (node.tag === 'rect') {
      const x = read('x', '0'), y = read('y', '0'), width = read('width'), height = read('height');
      if (width <= 0 || height <= 0) reject('Rectangle width and height must be positive');
      if (read('rx', '0') !== 0 || read('ry', '0') !== 0) reject('Rounded rectangles are unsupported; rx and ry must be absent or zero');
      return { points: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], removed_closing_endpoint: false, basic: { x, y, width, height } };
    }
    const cx = read('cx', '0'), cy = read('cy', '0');
    const rx = read(node.tag === 'circle' ? 'r' : 'rx'), ry = node.tag === 'circle' ? rx : read('ry');
    if (rx <= 0 || ry <= 0) reject('Circle/ellipse radii must be positive');
    return { points: null, ellipse: { cx, cy, rx, ry }, basic: { cx, cy, rx, ry }, removed_closing_endpoint: false };
  }
  const raw = node.attrs.points;
  if (typeof raw !== 'string' || !raw.trim()) reject('Selected outline requires a points attribute');
  // SVG comma/whitespace lists are accepted, including exponents. No repair of
  // missing coordinates or geometric guesses is performed.
  if (/^\s*,|,\s*$|,\s*,/.test(raw)) reject('points requires comma/whitespace-separated XY pairs');
  const values = raw.trim().split(/[\s,]+/).map(value => number(value, 'SVG point'));
  if (values.length % 2) reject('points requires complete XY pairs');
  const points = [];
  for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
  const repeated = points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  if (node.tag === 'polyline' && !repeated) reject('Polyline must explicitly repeat its first point at the end; open outlines are not closed automatically');
  if (repeated) points.pop();
  if (points.length < 3 || points.length > 128) reject('Selected outline needs 3–128 vertices after removing one closing endpoint');
  return { points, removed_closing_endpoint: repeated };
}

function inventory(drawing) {
  const counts = {};
  for (const node of drawing.shapes) counts[node.tag] = (counts[node.tag] ?? 0) + 1;
  const candidates = drawing.shapes.filter(node => outlineTags.includes(node.tag)).map(node => {
    let parsed = null, reason = null;
    try { parsed = outline(node); } catch (error) { reason = error.message; }
    return { element_index: node.index, element_id: node.attrs.id ?? null, element_type: node.tag, supported: parsed !== null,
      vertex_count: parsed?.points?.length ?? null, removed_closing_endpoint: parsed?.removed_closing_endpoint ?? null,
      requires_tolerance: ['path', 'circle', 'ellipse'].includes(node.tag), source_segment_count: parsed?.path?.segments.length ?? (parsed?.ellipse ? 1 : null), reason };
  });
  return { contract_id: 'moonmold.reference-svg-inventory.v2', source_sha256: drawing.source_sha256, source_byte_length: drawing.bytes.length,
    element_count: drawing.elements.length, drawing_element_count: drawing.shapes.length, drawing_element_type_counts: counts, candidates,
    viewport_hints: { width: drawing.root.attrs.width ?? null, height: drawing.root.attrs.height ?? null, viewBox: drawing.root.attrs.viewBox ?? null, preserveAspectRatio: drawing.root.attrs.preserveAspectRatio ?? null },
    qualification: 'Raw polygon/closed-polyline, unrounded rect, circle, ellipse or one absolute M/L/Q/C/Z closed path. Curves require explicit max_error; approximation limits and simple-ring geometry checked on import. Explicit scale, units and y-down-to-y-up convention required; viewport hints are never applied.', physical_authority: false };
}

export function inspectReferenceSvg(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'text')) reject('Expected {text} only');
  return inventory(parseDrawing(input.text));
}

export function importReferenceSvgProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['text', 'element', 'opening_element', 'units', 'units_per_svg_unit', 'coordinate_convention', 'height', 'name', 'max_error'].includes(key))) reject('Expected text, element, optional opening_element, units, units_per_svg_unit, coordinate_convention, height, name and optional curve max_error only');
  if (!Number.isSafeInteger(input.element) || input.element < 1) reject('Choose an explicit one-based XML element index from the inventory');
  const hasOpening = Object.hasOwn(input, 'opening_element');
  if (hasOpening && (!Number.isSafeInteger(input.opening_element) || input.opening_element < 1 || input.opening_element === input.element)) reject('opening_element must be an explicit distinct one-based XML element index');
  if (typeof input.units_per_svg_unit !== 'number' || !Number.isFinite(input.units_per_svg_unit) || input.units_per_svg_unit <= 0) reject('units_per_svg_unit must be an explicit positive finite scale in the selected units');
  if (input.coordinate_convention !== coordinateConvention) reject(`coordinate_convention must explicitly be ${coordinateConvention}: x = svg_x × scale, y = −svg_y × scale, z = 0`);
  const drawing = parseDrawing(input.text), selected = drawing.elements[input.element - 1], parsed = outline(selected);
  const opening = hasOpening ? drawing.elements[input.opening_element - 1] : null;
  if (hasOpening && ![selected, opening].every(node => ['polygon', 'polyline', 'rect'].includes(node?.tag))) reject('Outer and opening selections must both be straight-edged polygon, closed polyline or unrounded rect; no paths, curves or inferred holes');
  const parsedOpening = hasOpening ? outline(opening) : null;
  const scale = input.units_per_svg_unit;
  if (!parsed.path && !parsed.ellipse && input.max_error !== undefined) reject('max_error is only for paths/circles/ellipses; omit it for polygon/polyline/rect');
  const flattened = parsed.path ? flattenAbsolutePath(parsed.path, { scale, units: input.units, max_error: input.max_error }) : parsed.ellipse ? flattenBasicEllipse(parsed.ellipse, { scale, units: input.units, max_error: input.max_error }) : null;
  const scaled = flattened?.points ?? parsed.points.map(([x, y]) => [x * scale, y * scale]);
  const vertices = scaled.map(([x, y]) => [x, -y].map(n => n === 0 ? 0 : n));
  const cutout = parsedOpening?.points.map(([x, y]) => [x * scale, -y * scale].map(n => n === 0 ? 0 : n));
  // Both rings enter the same existing containment/intersection and triangulation
  // checks. SVG winding, styling and fill rules never choose a hole for us.
  const result = extrudeReferenceProfile({ contract_id: hasOpening ? EXTRUSION_CUTOUT_CONTRACT : EXTRUSION_CONTRACT, name: input.name, units: input.units, coordinate_frame: 'xy-z-up', vertices, height: input.height, ...(hasOpening ? { cutout } : {}) });
  const review = inventory(drawing);
  const approximation = flattened ? { ...flattened.approximation, vertices, coordinate_convention: coordinateConvention } : null;
  result.svg_import = { contract_id: hasOpening ? SVG_CUTOUT_IMPORT_CONTRACT : parsed.basic ? SVG_BASIC_IMPORT_CONTRACT : flattened ? SVG_PATH_IMPORT_CONTRACT : SVG_PROFILE_IMPORT_CONTRACT,
    source: { media_type: 'image/svg+xml', encoding: 'base64', bytes: drawing.bytes.toString('base64'), byte_length: drawing.bytes.length, sha256: drawing.source_sha256 },
    element_index: selected.index, element_id: selected.attrs.id ?? null, element_type: selected.tag,
    source_points: flattened ? null : parsed.points, removed_closing_endpoint: flattened?.removed_closing_endpoint ?? parsed.removed_closing_endpoint,
    ...(parsed.basic ? { source_basic_shape: parsed.basic } : {}),
    ...(hasOpening ? { opening: { element_index: opening.index, element_id: opening.attrs.id ?? null, element_type: opening.tag,
      source_points: parsedOpening.points, removed_closing_endpoint: parsedOpening.removed_closing_endpoint,
      ...(parsedOpening.basic ? { source_basic_shape: parsedOpening.basic } : {}) } } : {}),
    ...(flattened ? { ...(parsed.path ? { source_path: selected.attrs.d } : {}), approximation, approximation_sha256: createHash('sha256').update(canonicalJson(approximation)).digest('hex') } : {}),
    units: input.units, units_per_svg_unit: scale, coordinate_convention: coordinateConvention, viewport_hints: review.viewport_hints,
    recipe: result.extrusion.recipe, recipe_sha256: result.extrusion.recipe_sha256, geometry_sha256: result.geometry_sha256, layout_sha256: result.layout_sha256,
    omitted_drawing_element_count: drawing.shapes.length - (hasOpening ? 2 : 1), drawing_element_type_counts: review.drawing_element_type_counts,
    losses: [hasOpening ? 'Only the explicitly selected outer outline and opening become geometry. Both use the same scale, units and Y reflection; styling, fill rules, winding and other elements do not infer openings or islands' : 'Only the selected outline is imported; styling, stroke width, metadata and other drawing elements do not become geometry',
      'Root viewport/viewBox/physical size hints are retained but not applied; the operator explicitly supplies units per SVG user-space coordinate',
      flattened ? 'Curves are approximated by straight segments at explicit max_error in selected units; source curves are not editable curves in the point recipe. No tolerance relaxation, geometry repair, transforms, holes or fill-rule interpretation' : 'Y is reflected about the SVG origin; no auto-centering, viewport translation, transform, hole inference or tolerance repair',
      'Y is reflected about the SVG origin. Approximation, original source, editable recipe and derived geometry identities are distinct; no certified dimensional or manufacturing tolerance',
      'The original SVG bytes and initial recipe identity are retained here. Save this import record separately: later recipe edits are new revisions and do not inherit this import attestation'],
    qualification: result.qualification, physical_authority: false };
  return result;
}
