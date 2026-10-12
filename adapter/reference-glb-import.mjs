import { AdapterRejection } from './protocol.mjs';

const reject = message => { throw new AdapterRejection('invalid-reference-glb-import', message); };
const object = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`${label} must be an object`); return value; };
const integer = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) reject(`${label} is outside its supported range`); return value; };
const vector = (value, size, label) => { if (!Array.isArray(value) || value.length !== size || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) reject(`${label} requires ${size} finite numbers`); return value; };
const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const multiply = (a,b) => Array.from({ length:16 }, (_,i) => [0,1,2,3].reduce((sum,k) => sum+a[(i%4)+k*4]*b[k+Math.floor(i/4)*4],0));
const determinant = m => m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);
export const GLB_COORDINATE_MAPPING = '[x,y,z] metres/Y-up -> [x,-z,y]*1000 millimetres/Z-up after node world transforms';

function localMatrix(node, label) {
  if (node.matrix !== undefined) {
    if (['translation','rotation','scale'].some(key => node[key] !== undefined)) reject(`${label}: matrix and TRS cannot be combined`);
    const m = vector(node.matrix,16,`${label} matrix`);
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) reject(`${label}: matrix must be affine`);
    const columns = [0,4,8].map(i => m.slice(i,i+3)), lengths = columns.map(v => Math.hypot(...v));
    if (lengths.some(n => n === 0)) reject(`${label}: singular matrix`);
    for (let a=0;a<3;a++) for (let b=a+1;b<3;b++) if (Math.abs(columns[a].reduce((s,n,i)=>s+n*columns[b][i],0)) > lengths[a]*lengths[b]*1e-7) reject(`${label}: local matrix must be decomposable into TRS without shear`);
    return m;
  }
  const t = vector(node.translation ?? [0,0,0],3,`${label} translation`), s = vector(node.scale ?? [1,1,1],3,`${label} scale`);
  const [x,y,z,w] = vector(node.rotation ?? [0,0,0,1],4,`${label} rotation`);
  if (s.some(n => n === 0)) reject(`${label}: zero scale is unsupported`);
  if (Math.abs(Math.hypot(x,y,z,w)-1) > 1e-6) reject(`${label}: rotation must be a unit quaternion`);
  return [(1-2*(y*y+z*z))*s[0],2*(x*y+z*w)*s[0],2*(x*z-y*w)*s[0],0,
    2*(x*y-z*w)*s[1],(1-2*(x*x+z*z))*s[1],2*(y*z+x*w)*s[1],0,
    2*(x*z+y*w)*s[2],2*(y*z-x*w)*s[2],(1-2*(x*x+y*y))*s[2],0,...t,1];
}

// Static geometry only. No URI is fetched, code executed, or asset extras trusted.
// Geometry is decoded once, then instances use world transforms before the fixed
// unit/frame conversion. node_ids selects exact mesh nodes, not whole subtrees.
export function parseReferenceGlb(bytes, nodeIds) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 400000 || bytes.length < 28) reject('GLB requires 28 through 400000 bytes');
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) reject('GLB 2.0 header or exact byte length is invalid');
  let cursor=12; const chunks=[];
  while (cursor < bytes.length) {
    if (cursor+8 > bytes.length) reject('Truncated GLB chunk header');
    const length=bytes.readUInt32LE(cursor), type=bytes.readUInt32LE(cursor+4);
    if (length%4 || cursor+8+length > bytes.length) reject('GLB chunk length or alignment is invalid');
    chunks.push({ type, data:bytes.subarray(cursor+8,cursor+8+length) }); cursor+=8+length;
  }
  if (chunks.length !== 2 || chunks[0].type !== 0x4e4f534a || chunks[1].type !== 0x004e4942) reject('Use a GLB with exactly one JSON chunk followed by one embedded BIN chunk');
  let gltf;
  try { gltf=JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(chunks[0].data)); } catch { reject('GLB JSON must be valid UTF-8 JSON'); }
  object(gltf,'glTF'); object(gltf.asset,'asset');
  if (gltf.asset.version !== '2.0' || (gltf.asset.minVersion !== undefined && gltf.asset.minVersion !== '2.0')) reject('Only glTF 2.0 assets are supported');
  // Reject unsupported extension semantics even when not declared as required.
  const pending=[gltf]; let visited=0;
  while (pending.length) {
    const item=pending.pop(); if (!item || typeof item !== 'object') continue;
    if (++visited > 50000) reject('GLB JSON structure exceeds supported complexity');
    if (!Array.isArray(item) && item.extensions !== undefined && Object.keys(object(item.extensions,'extensions')).length) reject('GLB extensions are unsupported; export uncompressed core glTF 2.0');
    for (const [key,value] of Object.entries(item)) if (key !== 'extras') pending.push(value);
  }
  for (const key of ['extensionsUsed','extensionsRequired','animations','skins']) if (gltf[key] !== undefined && (!Array.isArray(gltf[key]) || gltf[key].length)) reject(`${key} are unsupported; export a static unskinned core GLB`);
  if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1) reject('GLB requires exactly one embedded buffer');
  const buffer=object(gltf.buffers[0],'buffer'), binary=chunks[1].data;
  if (buffer.uri !== undefined) reject('External and data-URI buffers are unsupported');
  const bufferLength=integer(buffer.byteLength,1,binary.length,'buffer byteLength');
  if (binary.length-bufferLength > 3 || binary.subarray(bufferLength).some(n=>n!==0)) reject('BIN may have at most three zero padding bytes');
  for (const key of ['bufferViews','accessors','meshes','nodes','scenes']) if (!Array.isArray(gltf[key]) || !gltf[key].length || gltf[key].length > (key==='nodes'?256:4096)) reject(`${key} requires a nonempty bounded array`);
  const losses = new Set(['Node hierarchy and transforms are baked into source geometry; layout placements remain independently editable', 'No welding, topology repair, engineering assessment or physical authority']);
  if (gltf.materials?.length || gltf.images?.length || gltf.textures?.length) losses.add('Materials, images and textures are omitted; external image URIs are never fetched');
  if (gltf.cameras?.length) losses.add('Cameras are omitted');
  if (gltf.scenes.length > 1) losses.add('Only the explicit default scene is imported; other scenes are omitted');
  const sceneIndex = gltf.scene === undefined ? (gltf.scenes.length===1?0:reject('Multiple scenes require an explicit default scene')) : integer(gltf.scene,0,gltf.scenes.length-1,'default scene');
  function index(value,array,label) { return integer(value,0,array.length-1,label); }
  const views=gltf.bufferViews.map((value,i)=>{
    const view=object(value,`bufferView ${i}`); if (view.buffer !== 0) reject(`bufferView ${i} must use embedded buffer 0`);
    const offset=integer(view.byteOffset ?? 0,0,bufferLength,'bufferView offset'), length=integer(view.byteLength,1,bufferLength,'bufferView length');
    if (offset+length > bufferLength) reject(`bufferView ${i} exceeds embedded buffer`);
    if (view.byteStride !== undefined) { integer(view.byteStride,4,252,'byteStride'); if (view.byteStride%4) reject('byteStride must be a multiple of four'); }
    return { ...view, byteOffset:offset, byteLength:length };
  });
  const cache=new Map();
  function accessor(id,position) {
    index(id,gltf.accessors,'accessor index'); const key=`${id}/${position}`; if (cache.has(key)) return cache.get(key);
    const a=object(gltf.accessors[id],`accessor ${id}`);
    if (a.sparse !== undefined || (a.normalized !== undefined && a.normalized !== false)) reject(`accessor ${id}: sparse or normalized data is unsupported`);
    const size={5121:1,5123:2,5125:4,5126:4}[a.componentType];
    if (position ? (a.type !== 'VEC3' || a.componentType !== 5126) : (a.type !== 'SCALAR' || ![5121,5123,5125].includes(a.componentType))) reject(`accessor ${id}: use FLOAT VEC3 positions and unsigned integer SCALAR indices`);
    const count=integer(a.count,1,position?40000:120000,`accessor ${id} count`), width=position?3:1;
    const view=views[index(a.bufferView,views,'accessor bufferView')], offset=integer(a.byteOffset ?? 0,0,view.byteLength,'accessor offset'), stride=view.byteStride ?? size*width;
    if (offset%size || (offset+view.byteOffset)%size || (position && (offset%4 || (offset+view.byteOffset)%4))) reject(`accessor ${id}: invalid component alignment`);
    if (stride < size*width || (!position && view.byteStride !== undefined)) reject(`accessor ${id}: unsupported byte stride`);
    if (offset+(count-1)*stride+size*width > view.byteLength) reject(`accessor ${id}: data exceeds bufferView`);
    const values=[];
    for (let i=0;i<count;i++) {
      const base=view.byteOffset+offset+i*stride;
      const value=position ? [0,1,2].map(axis=>binary.readFloatLE(base+axis*4)) : size===1?binary.readUInt8(base):size===2?binary.readUInt16LE(base):binary.readUInt32LE(base);
      if (position && value.some(n=>!Number.isFinite(n))) reject(`accessor ${id}: non-finite position`);
      values.push(value);
    }
    cache.set(key,values); return values;
  }
  const meshCache=new Map();
  function meshData(id) {
    index(id,gltf.meshes,'mesh index'); if (meshCache.has(id)) return meshCache.get(id);
    const mesh=object(gltf.meshes[id],`mesh ${id}`), vertices=[],triangles=[];
    if (mesh.weights !== undefined || !Array.isArray(mesh.primitives) || !mesh.primitives.length || mesh.primitives.length>256) reject(`mesh ${id}: use 1–256 static primitives without morph weights`);
    for (const [p,primitive] of mesh.primitives.entries()) {
      object(primitive,`mesh ${id} primitive ${p}`); const attrs=object(primitive.attributes,'primitive attributes');
      if ((primitive.mode ?? 4)!==4 || primitive.targets !== undefined) reject(`mesh ${id} primitive ${p}: only static TRIANGLES are supported`);
      if (Object.keys(attrs).some(key=>/^(JOINTS|WEIGHTS)_/.test(key))) reject('Skinned attributes are unsupported');
      const positions=accessor(attrs.POSITION,true);
      const indices=primitive.indices===undefined?positions.map((_,i)=>i):accessor(primitive.indices,false);
      if (indices.length%3 || indices.some(i=>i>=positions.length || i===0xffffffff || (primitive.indices!==undefined && i === ({5121:255,5123:65535}[gltf.accessors[primitive.indices].componentType])))) reject(`mesh ${id} primitive ${p}: invalid triangle indices`);
      if (vertices.length+positions.length>40000 || triangles.length+indices.length/3>40000) reject('Mesh exceeds 40000 vertices or triangles');
      for (const key of Object.keys(attrs)) if (key!=='POSITION') losses.add(`Vertex attribute ${key} is omitted`);
      const start=vertices.length; vertices.push(...positions);
      for (let i=0;i<indices.length;i+=3) triangles.push(indices.slice(i,i+3).map(n=>n+start));
    }
    const result={vertices,triangles}; meshCache.set(id,result);return result;
  }
  const nodes=gltf.nodes.map((node,i)=>{
    object(node,`node ${i}`);
    if (node.skin!==undefined || node.weights!==undefined) reject(`node ${i}: skinning and morph weights are unsupported`);
    if (node.mesh!==undefined) index(node.mesh,gltf.meshes,'node mesh');
    if (node.name!==undefined && (typeof node.name!=='string' || node.name.length>200)) reject(`node ${i}: name must be at most 200 characters`);
    if (node.children!==undefined && (!Array.isArray(node.children) || node.children.length>256)) reject(`node ${i}: invalid children`);
    return { ...node, local:localMatrix(node,`node ${i}`), children:node.children ?? [] };
  });
  const parent=new Map();
  nodes.forEach((node,i)=>node.children.forEach(child=>{
    index(child,nodes,'child node'); if (parent.has(child)) reject('Scene nodes must have exactly one parent; repeated children are unsupported'); parent.set(child,i);
  }));
  for (let i=0;i<nodes.length;i++) { let id=i, depth=0; const path=new Set(); while (id!==undefined) { if (path.has(id)) reject('Node hierarchy contains a cycle'); path.add(id); if (++depth>64) reject('Node hierarchy exceeds 64 levels');id=parent.get(id); } }
  for (const [i,scene] of gltf.scenes.entries()) {
    object(scene,`scene ${i}`); if (!Array.isArray(scene.nodes) || !scene.nodes.length || scene.nodes.length>256) reject(`scene ${i}: needs root nodes`);
    const seen=new Set(); for (const id of scene.nodes) { index(id,nodes,'scene node'); if (parent.has(id) || seen.has(id)) reject('Scene roots must be unique parentless nodes');seen.add(id); }
  }
  const reachable=[];
  function walk(id,world) { const node=nodes[id], matrix=multiply(world,node.local); if (matrix.some(n=>!Number.isFinite(n)) || !Number.isFinite(determinant(matrix)) || determinant(matrix)===0) reject(`node ${id}: world transform is singular or non-finite`);if (node.mesh!==undefined) reachable.push({id,node,matrix});for (const child of node.children) walk(child,matrix); }
  for (const id of gltf.scenes[sceneIndex].nodes) walk(id,identity());
  if (!reachable.length) reject('The default scene has no mesh nodes');
  if (nodeIds!==undefined && (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.length>256 || new Set(nodeIds).size!==nodeIds.length || nodeIds.some(id=>!Number.isInteger(id) || !reachable.some(n=>n.id===id)))) reject('node_ids must select unique mesh-node indices in the default scene');
  const vertices=[],triangles=[],parts=[];
  for (const {id,node,matrix} of reachable) {
    if (nodeIds!==undefined && !nodeIds.includes(id)) continue;
    const mesh=meshData(node.mesh), start=vertices.length, triangleStart=triangles.length, reflected=determinant(matrix)<0;
    if (start+mesh.vertices.length>40000 || triangleStart+mesh.triangles.length>40000) reject('Selected scene exceeds 40000 vertices or triangles');
    for (const p of mesh.vertices) {
      const [x,y,z]=[0,1,2].map(axis=>matrix[axis]*p[0]+matrix[axis+4]*p[1]+matrix[axis+8]*p[2]+matrix[axis+12]);
      const point=[x*1000,-z*1000,y*1000].map(n=>Object.is(n,-0)?0:n);
      if (point.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9)) reject(`node ${id}: coordinate exceeds ±1e9 mm`);
      vertices.push(point);
    }
    for (const face of mesh.triangles) {
      const indices=(reflected?[face[0],face[2],face[1]]:face).map(n=>n+start),[a,b,c]=indices.map(i=>vertices[i]);
      const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
      if (Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])===0) reject(`node ${id}: degenerate or precision-collapsed triangle`);
      triangles.push(indices);
    }
    if (reflected) losses.add('Triangle winding reversed for negative-determinant node world transforms, following glTF front-face semantics');
    parts.push({node_index:id,node_name:node.name ?? null,mesh_index:node.mesh,world_matrix:matrix,winding_reversed:reflected,vertex_range:{start,count:mesh.vertices.length},triangle_range:{start:triangleStart,count:mesh.triangles.length}});
  }
  return {vertices,triangles,encoding:'glb-2.0',losses:[...losses].sort(),glb_scene_index:sceneIndex,glb_nodes:parts,glb_node_ids:parts.map(p=>p.node_index),coordinate_mapping:GLB_COORDINATE_MAPPING};
}
