import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-array', message); };

// A one-time expansion into ordinary editable instances, not a hidden parametric
// dependency: later editing any generated instance cannot alter its siblings.
export function arrayReferenceLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['layout', 'instance_id', 'counts', 'pitch_mm'].includes(key))) reject('Expected layout, instance_id, counts and pitch_mm');
  const { counts, pitch_mm: pitch } = input;
  if (!Array.isArray(counts) || counts.length !== 3 || counts.some(n => !Number.isInteger(n) || n < 1 || n > 16)) reject('counts must contain three integers from 1 through 16');
  if (!Array.isArray(pitch) || pitch.length !== 3 || pitch.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9)) reject('pitch_mm must contain three finite numbers within +/-1000000000');
  for (let axis = 0; axis < 3; axis++) if (counts[axis] > 1 && pitch[axis] === 0) reject('Repeated axes require nonzero pitch_mm');
  const count = counts.reduce((a, b) => a * b, 1);
  if (count < 2) reject('Array must contain at least two cells, including the original');
  // Check total before parsing or expanding any source geometry.
  if (!Array.isArray(input.layout?.instances) || input.layout.instances.length + count - 1 > 16) reject('Expanded layout exceeds 16 instances');
  const before = composeReferenceLayout(input.layout);
  const template = before.layout.instances.find(item => item.id === input.instance_id);
  if (!template) reject('instance_id must identify an existing layout instance');
  const ids = new Set(before.layout.instances.map(item => item.id));
  const instances = [], cells = [];
  let next = 1;
  for (let z = 0; z < counts[2]; z++) for (let y = 0; y < counts[1]; y++) for (let x = 0; x < counts[0]; x++) {
    const cell = [x, y, z], offset = cell.map((n, i) => n * pitch[i]);
    let id = template.id;
    if (x || y || z) {
      while (ids.has(`array-${next}`)) next++;
      id = `array-${next++}`; ids.add(id);
      const item = structuredClone(template);
      item.id = id;
      item.transform.translation_mm = template.transform.translation_mm.map((n, i) => n + offset[i]);
      instances.push(item);
    }
    cells.push({ instance_id: id, cell, offset_mm: offset });
  }
  const layout = structuredClone(before.layout);
  // Keep original instance order and append generated copies in X-fastest order.
  layout.instances.push(...instances);
  const result = composeReferenceLayout(layout);
  result.array = { contract_id: 'moonmold.reference-array-operation.v1',
    parent_layout_sha256: before.layout_sha256, template_instance_id: template.id,
    counts: [...counts], pitch_mm: [...pitch], added_instance_count: instances.length, cells,
    semantics: 'One-time expansion; world-axis pitch between matching origins, not bounding-box clearance. Original retained at cell [0,0,0]. Instances edit independently.' };
  return result;
}
