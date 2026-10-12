# Calibrate a reference to a known length

A scan or imported reference sometimes has a known dimension but an inconvenient
placement scale. Measure two retained vertices, specify the desired length in
millimetres, and uniformly scale that one instance while holding the first vertex
at its existing world position. Other instances stay in place. This is a one-time
editable placement, with original bytes, declared source units and selections
preserved. It does not verify that the supplied dimension is physically correct.

## Operator

Start `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193` and open
`http://127.0.0.1:4193/reference-layout`.

1. Open `fixtures/reference-calibration.layout.json`. Save the original layout
   separately if you want to return to this placement later.
2. In **Measure two placed vertices**, choose instance `panel` for both endpoints,
   A local vertex `0` and B local vertex `1`, then **Measure A to B**. The current
   length is 90 mm. Indices are zero-based within the current imported/selected
   source; they are not source-file line numbers. The preview highlights A and B.
3. Under **Calibrate a reference to a known length**, enter `120` mm and click
   **Scale measured instance, keep A fixed**. The entire panel gets scale 2,
   retaining A at `[130,-25,5]` mm; the stand is unchanged.
4. Inspect achieved length, length residual, scale and anchor residual. Save
   **editable layout** to continue editing and **Inspection report** to retain
   the exact calibration request and before/after lineage. Reopen the saved layout
   and remeasure to inspect the new 120 mm length.

Calibration is available only after a fresh nonzero measurement on a single
instance. Pending placement fields, endpoint changes, a new layout, removal or
successful calibration clear its availability. After a successful edit, older
measurement, drawing, GLB and section downloads are invalidated. Failed requests
leave the last successful layout and its geometry downloads available. Repeated
clicks while a request is in flight do not submit another edit. This page uses the
existing Node-only operator; no Blender, compiled Rabbita UI or npm install is
required.

## CLI

```sh
node bin/moonmold-reference-calibrate.mjs \
  --input fixtures/reference-calibration.layout.json --instance panel \
  --a-vertex 0 --b-vertex 1 --length-mm 120 \
  --format layout --output calibrated.layout.json
node bin/moonmold-reference-calibrate.mjs \
  --input fixtures/reference-calibration.layout.json --instance panel \
  --a-vertex 0 --b-vertex 1 --length-mm 120 \
  --format json --output calibration.report.json
node bin/moonmold-reference-layout.mjs \
  --input calibrated.layout.json --format json --output reopened.report.json
```

`--format` accepts `layout` (default), `json` (inspection plus calibration), `obj`
or `stl`. Omit `--output` for stdout. Files are created exclusively; existing
files are never overwritten. Pass both `--expect-layout-sha256` and
`--expect-geometry-sha256` to bind a previously selected pair. Omitting both
explicitly calibrates the current supplied file; it does not check an earlier
inspection. Input accepts at most 3000000 UTF-8 bytes. No path is embedded in the
portable output and no network file is fetched.

## API and receipt

`POST /api/reference-layout/calibrate` takes exactly:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "example", "instances": [] },
  "endpoint_a": { "instance_id": "panel", "vertex_index": 0 },
  "endpoint_b": { "instance_id": "panel", "vertex_index": 1 },
  "target_distance_mm": 120,
  "expected_layout_sha256": "<64 lowercase hex digits from composition>",
  "expected_geometry_sha256": "<64 lowercase hex digits from composition>"
}
```

Replace the placeholder layout with a valid nonempty saved layout. Both hashes
are mandatory in the API. Recomposition and the existing measurement validator
check exact layout/geometry identity and vertex availability before editing.
Different instances, coincident represented points and nonpositive/nonfinite
lengths reject with HTTP 400. Length is bounded by 1000000000 mm, and the resulting
scale must remain within 0.000001 through 1000000. Existing coordinate, geometry,
source-size, compact-layout and triangle-collapse limits still apply. All edits
are computed on a clone; failure returns no partially modified layout.

The response is the usual `moonmold.reference-layout-result.v1` plus
`calibration` (`moonmold.reference-length-calibration.v1`). The latter includes:

- Parent and result layout/geometry hashes, instance and original source hash
- Original measured endpoints with source provenance and placed coordinates
- Supplied, previous and achieved length, scale factor and length residual
- Before/after normalized transforms, fixed anchor coordinates and residual
- Endpoint B after calibration, one-time semantics and explicit limitations

The saved layout schema is unchanged. Calibration provenance lives in the report,
not a hidden constraint in the editable layout. The workbench has bounded
[session Undo/Redo](REFERENCE_LAYOUT_HISTORY.md); there is no durable history.
Retain the original layout alongside the new one.

## Placement and interpretation

The factor is `target / current placed distance`. The source is reimported and
its existing scale is multiplied by the factor. Rotation and center/ground
preference remain. Translation is recalculated from the new local A (including
center/ground offset) so it retains its old world position. Thus every vertex
follows `A + factor * (old_vertex - A)`, subject to IEEE double-precision error.
Center/ground remains a pre-translation preference, so the final part is not
necessarily grounded at world Z=0. An exactly equal-length request retains the
same normalized placement and hashes.

Named OBJ selections, binary payloads and selected GLB node IDs remain intact.
Source units are not guessed or rewritten. Repeated STL coordinates and retained
unreferenced vertices can be selected, but zero-length pairs cannot calibrate.
OBJ/STL derivatives bake new millimetre coordinates and carry their existing
losses. This operation adds no solid modelling, nonuniform deformation, collision,
engineering accuracy, manufacturing readiness or physical authority.
