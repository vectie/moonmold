import { AdapterRejection } from './protocol.mjs';
import { composeReferenceLayout } from './reference-layout.mjs';

// glTF 2.0 uses metres and a right-handed Y-up frame. This proper rotation
// preserves face winding: MoonMold (x,y,z) mm -> glTF (x,z,-y) / 1000 metres.
const toGltf = ([x, y, z]) => [x / 1000, z / 1000, -y / 1000];
const reject = message => { throw new AdapterRejection('invalid-reference-glb', message); };
const align4 = n => Math.ceil(n / 4) * 4;

export function exportReferenceLayoutGlb(layout) {
  // Reuse the single placement implementation, including part extraction,
  // unit conversion, rotation and grounding. Never accept precomputed meshes.
  const composed = composeReferenceLayout(layout);
  const binary = [], bufferViews = [], accessors = [], meshes = [], nodes = [];
  let byteLength = 0, maxErrorMm = 0;
  function view(bytes, target) {
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    binary.push(bytes);
    const padding = align4(bytes.length) - bytes.length;
    if (padding) binary.push(Buffer.alloc(padding));
    byteLength += bytes.length + padding;
    return index;
  }
  for (const part of composed.parts) {
    const vertices = composed.vertices.slice(part.vertex_range.start, part.vertex_range.start + part.vertex_range.count);
    const triangles = composed.triangles.slice(part.triangle_range.start, part.triangle_range.start + part.triangle_range.count)
      .map(face => face.map(index => index - part.vertex_range.start));
    const points = vertices.map(point => toGltf(point).map(Math.fround));
    let partErrorMm = 0;
    for (let i = 0; i < vertices.length; i++) {
      const exact = toGltf(vertices[i]);
      partErrorMm = Math.max(partErrorMm, Math.hypot(...points[i].map((n, axis) => n - exact[axis])) * 1000);
    }
    maxErrorMm = Math.max(maxErrorMm, partErrorMm);
    // Float32 can collapse a small triangle at a large world translation.
    // A successful export must still contain the represented triangle faces.
    for (const [index, face] of triangles.entries()) {
      const [a, b, c] = face.map(i => points[i]);
      const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
      if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) === 0) {
        reject(`${part.id}: triangle ${index} collapses at glTF float32 precision; move the layout closer to its origin or export OBJ instead`);
      }
    }
    const positions = Buffer.alloc(points.length * 12), indices = Buffer.alloc(triangles.length * 6);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    points.forEach((point, i) => point.forEach((n, axis) => {
      positions.writeFloatLE(n, i * 12 + axis * 4);
      min[axis] = Math.min(min[axis], n); max[axis] = Math.max(max[axis], n);
    }));
    triangles.forEach((face, i) => face.forEach((n, corner) => indices.writeUInt16LE(n, i * 6 + corner * 2)));
    const positionAccessor = accessors.length;
    accessors.push({ bufferView: view(positions, 34962), componentType: 5126, count: points.length, type: 'VEC3', min, max });
    const indexAccessor = accessors.length;
    accessors.push({ bufferView: view(indices, 34963), componentType: 5123, count: triangles.length * 3, type: 'SCALAR' });
    const mesh = meshes.length;
    meshes.push({ name: part.id, primitives: [{ attributes: { POSITION: positionAccessor }, indices: indexAccessor, mode: 4, material: 0 }] });
    nodes.push({ name: part.id, mesh, extras: { moonmold: {
      instance_id: part.id, source_name: part.source_name, source_format: part.source_format,
      ...(part.source_encoding ? { source_encoding: part.source_encoding } : {}),
      source_sha256: part.source_sha256, source_units: part.source_units,
      source_bounds_mm: part.source_bounds, placed_bounds_mm: part.bounds,
      applied_transform: part.transform, source_losses: part.losses,
      ...(part.selection ? { selection: part.selection } : {}),
      ...(part.glb_nodes ? { source_glb: { scene_index: part.glb_scene_index,
        nodes: part.glb_nodes, coordinate_mapping: part.coordinate_mapping } } : {}),
      maximum_vertex_rounding_error_mm: partErrorMm,
    } } });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'MoonMold reference layout GLB exporter', extras: { moonmold: {
      contract_id: 'moonmold.reference-glb.v1', representation: 'reference-presentation-derived',
      layout_name: composed.name, layout_sha256: composed.layout_sha256, geometry_sha256: composed.geometry_sha256,
      input_units: 'mm', input_frame: 'placed layout XYZ; Z is the grounding axis',
      output_units: 'm', output_frame: 'right-handed Y-up',
      coordinate_mapping: '[x,y,z] mm -> [x,z,-y]/1000 m',
      maximum_vertex_rounding_error_mm: maxErrorMm, physical_authority: false,
      losses: ['Placed vertices are rounded to IEEE float32 metres; reported error is conversion error, not engineering accuracy',
        'Transforms are baked; original source bytes and editable placements are not embedded. Keep the saved layout JSON',
        'Original materials, textures, normals and OBJ object/group names are omitted; source losses remain on each node',
        'One neutral double-sided material replaces styling; absent normals use glTF flat shading',
        'Unreferenced vertices remain in accessors but are not rendered; no welding, booleans, topology repair or physical assessment'],
    } } },
    scene: 0, scenes: [{ name: composed.name, nodes: nodes.map((_, i) => i) }], nodes, meshes,
    materials: [{ name: 'Reference neutral (not source material)', doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [0.65, 0.72, 0.76, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors, bufferViews, buffers: [{ byteLength }],
  };
  const json = Buffer.from(JSON.stringify(gltf), 'utf8'), jsonLength = align4(json.length);
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + byteLength);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12); output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(0x20, 20, 20 + jsonLength); json.copy(output, 20);
  const binHeader = 20 + jsonLength;
  output.writeUInt32LE(byteLength, binHeader); output.writeUInt32LE(0x004e4942, binHeader + 4);
  Buffer.concat(binary, byteLength).copy(output, binHeader + 8);
  return output;
}
