# Section a placed reference layout

For reusable CAD linework with millimetre coordinates and per-instance layers,
see [DXF section export](REFERENCE_SECTION_DXF.md).

Inspect a saved `.layout.json` at an X, Y or Z plane in placed millimetre
coordinates. This Node-only workflow preserves every instance instead of
flattening and re-importing an OBJ/STL. No Blender or dependency install is needed.

```sh
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --section-axis z --section-position 5 --format json --output section.json
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --section-axis z --section-position 5 --format svg --output section.svg
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --section-axis z --section-position 5 --format csv --output section.csv
```

Both section options are required. Axis is lowercase `x`, `y` or `z`; position
is a finite decimal number (scientific notation allowed), within ±1 billion mm.
With section options, formats are `json` (default), `svg`, `csv` and `dxf`. Without
section options, existing composition formats are unchanged. Output files must
be new; omit `--output` for stdout. Saved layout input and composition limits
still apply. The operator layout page and `POST /api/reference-layout/section` also calculate
sections; see the DXF guide for the controls and request schema.

The JavaScript API is `sectionReferenceLayout(layout, {axis, position_mm})` from
`adapter/reference-layout-section.mjs`; result contract is
`moonmold.reference-layout-section.v1`. The complete layout is validated first.

## What travels with an observation

- Layout and combined geometry SHA-256 identify exactly the normalized sources
  and placements used. Each part retains source-byte, transform, transformed
  mesh and single-part-section SHA-256; the aggregate section SHA-256 hashes
  the complete result excluding itself and derived exports.
- `parts` includes every instance, including empty, point-contact and
  coplanar-only results. Per-part source format, units, losses, diagnostics,
  transform and independent tolerance remain available.
- Flattened `segments` and `point_contacts` carry `instance_id`, hashes,
  zero-based local `triangle_ids` and zero-based combined `layout_triangle_ids`.
  Identical segments in different instances remain separate. Length sum counts
  them separately; it is not the perimeter of a union.
- SVG is auto-fitted, not print scale. Each observation has an instance ID
  attribute and hover title; complete identities are in embedded metadata.
  Coincident drawings overlap visually but remain independent SVG elements.
- CSV has one metadata row for each instance, then segment and point-contact
  rows. `observation_json` retains full-precision numeric endpoints, local and
  combined triangle IDs; `transform_json` retains the placement. Quoted JSON
  cells follow CSV quote-doubling rules. Metadata persists for empty results.

## Limits

The [single-reference section rules](REFERENCE_SECTIONS.md) apply independently
to each instance. Point contacts remain point observations, never segments.
Coplanar triangles are counted and omitted; on-plane edges of noncoplanar
triangles can remain. Tolerance is axis-relative per instance; the top-level
and SVG tolerance is their maximum for summary only. A far-away part cannot
change how a nearby part is intersected. No approximate endpoint welding,
contour joining or cross-instance deduplication occurs.

These are unqualified digital reference observations. They do not assess
collision, clearance, closed contours, area, engineering fitness, solids,
watertightness, fabrication or manufacturing suitability. Hashes identify
data and do not certify it. No semantic operation schema or physical authority
is added.

```sh
node --test adapter/reference-layout-section.test.mjs
npm test
```

The focused CLI test retains each synthetic input and actual output in
`evidence/layout-section-test-*` for inspection.
