import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
const reject = message => { throw new AdapterRejection('invalid-reference-path-array', message); };

// World-space origins sampled by arc length. Orientation and scale are retained:
// this is placement of independent instances, not bending or sweeping geometry.
export function arrayReferencePath(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['layout','instance_id','points_mm','count'].includes(k))) reject('Expected layout, instance_id, points_mm and count');
  const { points_mm: points, count } = input;
  if (!Number.isInteger(count) || count < 2 || count > 16) reject('count must be an integer from 2 through 16');
  if (!Array.isArray(points) || points.length < 2 || points.length > 64 || points.some(p => !Array.isArray(p) || p.length !== 3 || p.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9))) reject('points_mm needs 2 through 64 world points with three finite coordinates within +/-1000000000');
  if (!Array.isArray(input.layout?.instances) || input.layout.instances.length + count - 1 > 16) reject('Expanded layout exceeds 16 instances');
  const lengths = points.slice(1).map((p,i) => Math.hypot(...p.map((n,a)=>n-points[i][a])));
  if (lengths.some(n => n === 0)) reject('Consecutive path points must be distinct');
  const total = lengths.reduce((a,b)=>a+b,0);
  const before = composeReferenceLayout(input.layout);
  const template = before.layout.instances.find(i=>i.id===input.instance_id);
  if (!template) reject('instance_id must identify an existing layout instance');
  const layout = structuredClone(before.layout), ids = new Set(layout.instances.map(i=>i.id));
  const samples = [];
  let next = 1;
  for (let index = 0; index < count; index++) {
    const distance = total * index / (count - 1);
    let segment = 0, start = 0;
    while (segment < lengths.length - 1 && start + lengths[segment] < distance) start += lengths[segment++];
    const t = Math.min(1,Math.max(0,(distance-start)/lengths[segment]));
    const point = index === count-1 ? [...points.at(-1)] : points[segment].map((n,a)=>n+(points[segment+1][a]-n)*t);
    let item;
    if (index === 0) item = layout.instances.find(i=>i.id===template.id);
    else {
      while(ids.has(`path-${next}`)) next++;
      item = structuredClone(template); item.id=`path-${next++}`; ids.add(item.id); layout.instances.push(item);
    }
    item.transform.translation_mm = point;
    samples.push({ instance_id:item.id, distance_mm:distance, segment_index:segment, origin_mm:[...point] });
  }
  const result = composeReferenceLayout(layout);
  result.path_array = { contract_id:'moonmold.reference-path-array.v1', parent_layout_sha256:before.layout_sha256,
    template_instance_id:template.id, points_mm:structuredClone(points), count, path_length_mm:total, spacing_mm:total/(count-1), samples,
    semantics:'Equal arc-length placement including both endpoints. Moves the template origin to the first point; appends independent copies. Original scale and rotation retained. No tangent alignment, collision avoidance, bending, engineering or manufacturing qualification.' };
  return result;
}
