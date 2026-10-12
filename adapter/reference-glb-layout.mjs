import { AdapterRejection } from './protocol.mjs';
import { importReferenceMesh } from './reference-mesh.mjs';
import { composeReferenceLayout, LAYOUT_CONTRACT } from './reference-layout.mjs';

// A scene-import operation creates a new layout; append/merge is an explicit UI
// composition. Each selected mesh node retains the complete original byte source.
export function importReferenceGlbLayout(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!['data_base64','name','node_ids'].includes(key))) throw new AdapterRejection('invalid-reference-glb-import','GLB scene import accepts data_base64, optional name and optional node_ids only');
  const name=input.name ?? 'glb-scene';
  const mesh=importReferenceMesh({input_format:'glb',units:'m',name,data_base64:input.data_base64,node_ids:input.node_ids});
  if (mesh.glb_nodes.length>16) throw new AdapterRejection('invalid-reference-glb-import','Scene has more than 16 mesh nodes; select up to 16 with node_ids or split it in the source editor');
  const layout={contract_id:LAYOUT_CONTRACT,name,instances:mesh.glb_nodes.map(node=>{
    const slug=(node.node_name ?? 'mesh').replace(/[^a-zA-Z0-9._-]/g,'_').replace(/^[^a-zA-Z0-9]+/,'').slice(0,64) || 'mesh';
    const id=`${slug}-node-${node.node_index}`;
    return {id,source:{input_format:'glb',units:'m',name:id,data_base64:input.data_base64,node_ids:[node.node_index]},transform:{}};
  })};
  return composeReferenceLayout(layout);
}
