// ASCII AutoCAD 2000 DXF: independent LINE/POINT observations in projected mm.
// Input is an already computed MoonMold section, never arbitrary client geometry.
// Autodesk DXF references and the intentionally bounded contract are in docs.
export function sectionDxf(section) {
  const parts = section.parts ?? [{ ...section, instance_id: 'reference' }];
  // Numeric prefixes also distinguish case-only IDs and truncated labels in CAD.
  const layers = parts.map((part, index) => ({
    name: `MM_${String(index + 1).padStart(2, '0')}_${part.instance_id.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 31),
    instance_id: part.instance_id, source_sha256: part.source_sha256,
    transform_sha256: part.transform_sha256, section_sha256: part.section_sha256,
    status: part.status, segment_count: part.segment_count,
    point_contact_count: part.point_contact_count, coplanar_triangles: part.diagnostics.coplanar_triangles,
  }));
  const metadata = {
    contract_id: 'moonmold.reference-section-dxf.v1', version: 'AC1015', units: 'mm',
    section_sha256: section.section_sha256,
    ...(section.layout_sha256 ? { layout_sha256: section.layout_sha256, geometry_sha256: section.geometry_sha256 }
      : { source_sha256: section.source_sha256, transformed_mesh_sha256: section.transformed_mesh_sha256 }),
    plane: section.plane, layers,
    projection: 'DXF X = first projected axis, Y = second projected axis, Z = 0; world origin retained; no auto-fit, shift, reflection or rounding',
    losses: ['Normal-axis coordinate is replaced by zero; original plane remains in metadata and section JSON',
      'Independent LINE segments and POINT contacts; no closed contours, joining or coplanar faces',
      'Comments may be discarded by CAD tools; keep the section JSON for full triangle lineage and tolerance'],
    qualification: section.qualification, physical_authority: false,
  };
  const lines = [];
  const pair = (code, value) => { lines.push(String(code), String(value)); };
  const values = (...entries) => { for (let i = 0; i < entries.length; i += 2) pair(entries[i], entries[i + 1]); };
  let nextHandle = 0x10;
  const handle = () => (nextHandle++).toString(16).toUpperCase();
  const ltypeTable = handle(), continuous = handle(), byblock = handle(), bylayer = handle();
  const layerTable = handle(), layerHandles = ['0', ...layers.map(layer => layer.name)].map(() => handle());
  const blockTable = handle(), model = handle(), paper = handle();
  const blockHandles = [[handle(), handle()], [handle(), handle()]];
  const entityCount = section.segment_count + section.point_contact_count;
  values(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$DWGCODEPAGE', 3, 'ANSI_1252',
    9, '$HANDSEED', 5, (nextHandle + entityCount).toString(16).toUpperCase(),
    9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 9, '$LUNITS', 70, 2,
    9, '$LUPREC', 70, 8, 9, '$PDMODE', 70, 3, 9, '$PDSIZE', 40, -2);
  for (const [key, point] of [['$EXTMIN', section.bounds_uv_mm?.min ?? [0, 0]], ['$EXTMAX', section.bounds_uv_mm?.max ?? [0, 0]]]) {
    values(9, key, 10, point[0], 20, point[1], 30, 0);
  }
  pair(999, 'MoonMold digital reference section. One drawing unit = 1 mm. Not fabrication authority.');
  // Group strings are bounded below Autodesk's 256-character limit. ASCII
  // JSON escaping prevents names/control characters from becoming DXF records.
  const encoded = JSON.stringify(metadata).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  for (let i = 0; i < encoded.length; i += 230) pair(999, 'MM_META ' + encoded.slice(i, i + 230));
  values(0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES');
  const table = (name, id, count) => values(0, 'TABLE', 2, name, 5, id, 330, 0, 100, 'AcDbSymbolTable', 70, count);
  table('LTYPE', ltypeTable, 3);
  for (const [id, name] of [[continuous, 'CONTINUOUS'], [byblock, 'BYBLOCK'], [bylayer, 'BYLAYER']]) {
    values(0, 'LTYPE', 5, id, 330, ltypeTable, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord',
      2, name, 70, 0, 3, '', 72, 65, 73, 0, 40, 0);
  }
  values(0, 'ENDTAB');
  table('LAYER', layerTable, layers.length + 1);
  for (const [index, name] of ['0', ...layers.map(layer => layer.name)].entries()) {
    values(0, 'LAYER', 5, layerHandles[index], 330, layerTable, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLayerTableRecord',
      2, name, 70, 0, 62, index ? ((index - 1) % 6) + 1 : 7, 6, 'CONTINUOUS');
  }
  values(0, 'ENDTAB');
  table('BLOCK_RECORD', blockTable, 2);
  for (const [id, name] of [[model, '*Model_Space'], [paper, '*Paper_Space']]) {
    values(0, 'BLOCK_RECORD', 5, id, 330, blockTable, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, name);
  }
  values(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'BLOCKS');
  for (const [index, [owner, name]] of [[model, '*Model_Space'], [paper, '*Paper_Space']].entries()) {
    values(0, 'BLOCK', 5, blockHandles[index][0], 330, owner, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockBegin',
      2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, '',
      0, 'ENDBLK', 5, blockHandles[index][1], 330, owner, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockEnd');
  }
  values(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (const [index, part] of parts.entries()) {
    const begin = (type, subclass) => values(0, type, 5, handle(), 330, model, 100, 'AcDbEntity', 8, layers[index].name, 100, subclass);
    for (const segment of part.segments) {
      begin('LINE', 'AcDbLine');
      values(10, segment.start_uv_mm[0], 20, segment.start_uv_mm[1], 30, 0,
        11, segment.end_uv_mm[0], 21, segment.end_uv_mm[1], 31, 0);
    }
    for (const contact of part.point_contacts) {
      begin('POINT', 'AcDbPoint'); values(10, contact.uv_mm[0], 20, contact.uv_mm[1], 30, 0);
    }
  }
  values(0, 'ENDSEC', 0, 'EOF');
  return lines.join('\r\n') + '\r\n';
}
