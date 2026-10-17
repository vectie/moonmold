import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';
import { resolveReferenceEndpoint } from './reference-measurement.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { referenceRotationFromMatrix, rotateReferencePoint } from './reference-rotation.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-registration', message); };
const sub = (a,b) => a.map((n,i) => n-b[i]);
const dot = (a,b) => a.reduce((sum,n,i) => sum+n*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = p => p.map(n => n/Math.hypot(...p));
const centroid = points => points[0].map((n,i) => n+(points[1][i]-n)/3+(points[2][i]-n)/3);
function triangleFrame(points, label) {
  const ab=sub(points[1],points[0]),ac=sub(points[2],points[0]);
  const lengths=[Math.hypot(...ab),Math.hypot(...ac),Math.hypot(...sub(points[2],points[1]))];
  const magnitude=Math.max(...points.flat().map(Math.abs),...lengths);
  if (Math.min(...lengths) <= magnitude*Number.EPSILON*128) reject(`${label} vertices are repeated or too small at this coordinate precision`);
  const x=unit(ab), normal=cross(x,unit(ac)), sine=Math.hypot(...normal);
  if (!Number.isFinite(sine) || sine <= 1e-10) reject(`${label} vertices are collinear or too nearly collinear for stable registration`);
  if (lengths[0]*lengths[1]/Math.max(...lengths)*sine <= magnitude*Number.EPSILON*128) reject(`${label} triangle altitude is too small at this coordinate precision`);
  const z=unit(normal),y=unit(cross(z,x));
  return [x,y,z];
}

// Exactly three ordered, non-collinear correspondences span a plane. Express
// both centered triangles in right-handed frames with the same ordered winding.
// Their 2x2 covariance has positive determinant; atan2(cross-sum,dot-sum) is
// therefore the least-squares proper in-plane rotation (the rank-two Kabsch
// solution). Mapping both frame normals keeps the world determinant +1.
export function registerReferenceVertices(input) {
  const fields=['layout','moving','fixed','expected_layout_sha256','expected_geometry_sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(key=>!fields.includes(key))) reject('Registration requires exactly layout, moving, fixed and both parent identities');
  for (const key of ['moving','fixed']) {
    const choice=input[key];
    if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).length!==2 || Object.keys(choice).some(key=>!['instance_id','vertex_indices'].includes(key)) || !Array.isArray(choice.vertex_indices) || choice.vertex_indices.length!==3 || new Set(choice.vertex_indices).size!==3) reject(`${key} requires one instance_id and three distinct ordered vertex_indices`);
  }
  if(input.moving.instance_id===input.fixed.instance_id) reject('Choose two different reference instances');
  const before=composeReferenceLayout(input.layout);
  if(input.expected_layout_sha256!==before.layout_sha256 || input.expected_geometry_sha256!==before.geometry_sha256) reject('Registration requires the current layout and geometry identities');
  const endpoints=key=>input[key].vertex_indices.map(vertex_index=>resolveReferenceEndpoint(before,{instance_id:input[key].instance_id,vertex_index},key));
  const moving=endpoints('moving'),fixed=endpoints('fixed');
  const p=moving.map(e=>e.coordinates_mm),q=fixed.map(e=>e.coordinates_mm);
  const sourceFrame=triangleFrame(p,'Moving'),targetFrame=triangleFrame(q,'Fixed'),sourceCenter=centroid(p),targetCenter=centroid(q);
  const centeredP=p.map(point=>sub(point,sourceCenter)),centeredQ=q.map(point=>sub(point,targetCenter));
  // Independent normalization avoids unnecessary squared-coordinate magnitude.
  const ps=Math.max(...centeredP.map(p=>Math.hypot(...p))),qs=Math.max(...centeredQ.map(p=>Math.hypot(...p)));
  let cosine=0,sine=0;
  for(let i=0;i<3;i++) {
    const a=sourceFrame.slice(0,2).map(axis=>dot(axis,centeredP[i])/ps),b=targetFrame.slice(0,2).map(axis=>dot(axis,centeredQ[i])/qs);
    cosine+=a[0]*b[0]+a[1]*b[1];sine+=a[0]*b[1]-a[1]*b[0];
  }
  const angle=Math.atan2(sine,cosine),c=Math.cos(angle),s=Math.sin(angle);
  const rotatedFrame=[targetFrame[0].map((n,i)=>c*n+s*targetFrame[1][i]),targetFrame[0].map((n,i)=>-s*n+c*targetFrame[1][i]),targetFrame[2]];
  const rotation=[0,1,2].map(i=>[0,1,2].map(j=>rotatedFrame.reduce((sum,axis,k)=>sum+axis[i]*sourceFrame[k][j],0)));
  const map=point=>rotation.map((row,i)=>targetCenter[i]+dot(row,sub(point,sourceCenter)));
  const candidate=structuredClone(before.layout),item=candidate.instances.find(item=>item.id===input.moving.instance_id),old=structuredClone(item.transform);
  const columns=[[1,0,0],[0,1,0],[0,0,1]].map(axis=>rotateReferencePoint(axis,old.rotation_deg));
  const angles=referenceRotationFromMatrix(rotation.map(row=>columns.map(column=>dot(row,column))));
  const mesh=importReferenceMesh(item.source),local=mesh.vertices.map(point=>rotateReferencePoint(point.map(n=>n*old.scale),angles));
  const min=[0,1,2].map(i=>Math.min(...local.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...local.map(p=>p[i])));
  const ground=old.center_and_ground ? [-(min[0]+max[0])/2,-(min[1]+max[1])/2,-min[2]] : [0,0,0];
  const anchor=map(p[0]);
  item.transform.rotation_deg=angles;
  item.transform.translation_mm=anchor.map((n,i)=>n-local[input.moving.vertex_indices[0]][i]-ground[i]);
  const next=composeReferenceLayout(candidate),part=before.parts.find(part=>part.id===item.id);
  const magnitude=Math.max(1,...before.bounds.min.map(Math.abs),...before.bounds.max.map(Math.abs),...next.bounds.min.map(Math.abs),...next.bounds.max.map(Math.abs));
  const tolerance=magnitude*Number.EPSILON*512;
  for(let i=part.vertex_range.start;i<part.vertex_range.start+part.vertex_range.count;i++) {
    const wanted=map(before.vertices[i]);
    if(next.vertices[i].some((n,k)=>Math.abs(n-wanted[k])>tolerance)) reject('Registration cannot be represented accurately at these coordinates');
  }
  const residuals=moving.map((endpoint,i)=>{
    const after=next.vertices[endpoint.layout_vertex_index],delta=sub(after,q[i]);
    return { pair:i+1, moving_vertex_index:endpoint.vertex_index, fixed_vertex_index:fixed[i].vertex_index, before_mm:p[i], target_mm:q[i], after_mm:after, delta_mm:delta, distance_mm:Math.hypot(...delta) };
  });
  const lengths=points=>[[0,1],[1,2],[2,0]].map(([a,b])=>Math.hypot(...sub(points[b],points[a])));
  next.registration={
    contract_id:'moonmold.reference-registration.v1',method:'three-pair-proper-rigid-least-squares',
    parent_layout_sha256:before.layout_sha256,parent_geometry_sha256:before.geometry_sha256,
    layout_sha256:next.layout_sha256,geometry_sha256:next.geometry_sha256,
    moving:structuredClone(input.moving),fixed:structuredClone(input.fixed),
    moving_endpoints:moving,fixed_endpoints:fixed,
    world_rotation:rotation,source_centroid_mm:sourceCenter,target_centroid_mm:targetCenter,
    world_translation_mm:targetCenter.map((n,i)=>n-dot(rotation[i],sourceCenter)),
    before_transform:old,after_transform:structuredClone(item.transform),
    residuals,rms_residual_mm:Math.hypot(...residuals.map(r=>r.distance_mm))/Math.sqrt(3),max_residual_mm:Math.max(...residuals.map(r=>r.distance_mm)),
    moving_edge_lengths_mm:lengths(p),fixed_edge_lengths_mm:lengths(q),numerical_tolerance_mm:tolerance,
    frame:'placed-world-xyz-mm',physical_authority:false,
    qualification:'One-time least-squares rotation and translation of the moving reference only; no scaling or reflection. Ordered pairs minimize summed squared distance. Unequal triangles cannot match all three vertices, so inspect every residual. Residuals measure only these chosen represented vertices, not whole-mesh agreement or source accuracy. Original sources, scales, center/ground preferences and other placements remain. IEEE double precision applies. No persistent constraint, collision, engineering or physical-suitability assessment.',
  };
  return next;
}
