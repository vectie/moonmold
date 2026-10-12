# Place a reference by matching vertices

Use point placement to attach a chosen reference vertex to a vertex on another
instance, optionally leaving a signed world XYZ millimetre offset. This is useful
when bounding-box alignment cannot identify the desired mounting corner.

```sh
node bin/moonmold-reference-snap.mjs \
  --input fixtures/reference-calibration.layout.json \
  --moving panel --reference stand --a-vertex 0 --b-vertex 3 \
  --offset-mm 5,-10,2 --output snapped.layout.json
```

The selected cm-source panel is already scaled 1.5, rotated 90 degrees around Z,
and centered/grounded. A is [130,-25,5] mm; fixed stand B is [10,20,40] mm. The
result puts A at [15,10,42] mm. Translation changes from [100,20,5] to
[-15,55,42]; the stand and every original embedded source remain unchanged.
Reopen snapped.layout.json with the existing reference-layout operator to edit.

`--format layout` (default) saves editable original sources and placement recipes.
`--format json` saves the result plus `snap` provenance, before/after hashes,
selected source identities, original/achieved endpoints, offsets and residuals.
`--format obj|stl` bakes derived mm geometry with existing representation losses.
Choose new output paths: the command refuses to overwrite files. Without output,
it writes to stdout. Keep the original layout for undo and report for provenance.

Both vertex indices are zero-based local indices in the current imported and
part/node-selected order (not OBJ one-based indices). Use existing measurement
and composition reports to inspect them. `--expect-layout-sha256` and
`--expect-geometry-sha256` must be supplied together to bind choices to an earlier
inspection; omitting both binds them to the current input file. Changed source
bytes or placements invalidate supplied identities.

The reusable API is `snapReferenceLayout` in `adapter/reference-snap.mjs`:

```js
snapReferenceLayout({ layout, endpoint_a: { instance_id, vertex_index },
  endpoint_b: { instance_id, vertex_index }, offset_mm: [x,y,z],
  expected_layout_sha256, expected_geometry_sha256 });
```

A and B must belong to different instances. Offset requires exactly three finite
numbers within ±1e9; existing composition limits apply to final translations and
coordinates. Unknown fields, missing/invalid indices, stale identities and
unrepresentable placements fail without mutating the input.

Only A's translation changes. Sources, units, selections, scale, Euler rotation,
center/ground preference, and all other placements remain editable. A numerical
floor of 16 machine epsilons times the largest of 1, desired/current endpoint
coordinate and old translation magnitude suppresses each sub-precision delta.
The report records requested and applied deltas, floor and achieved residual;
this prevents repeat-click drift and is not a physical tolerance guarantee.

This CLI/API workflow adds no operator button or HTTP route. It does not rotate
to fit, weld, constrain future edits, infer surface contact, test collision or
certify clearance, engineering accuracy, manufacturing or physical suitability.
