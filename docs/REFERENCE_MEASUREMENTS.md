# Measure two placed reference vertices

Use the existing reference-layout page to inspect the world XYZ coordinates of
two retained vertices, signed B minus A components, and Euclidean distance in mm.
This is a descriptive point observation, not minimum separation between meshes,
collision, clearance, engineering accuracy or physical-suitability evidence.

## Operator workflow

Run `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193`, then open
`http://127.0.0.1:4193/reference-layout`. Load
`fixtures/reference-measurement.layout.json`. Under **Measure two placed vertices**,
choose `triangle` for both endpoints, A local vertex `0`, B local vertex `1`, and
click **Measure A to B**. The report reads X=3, Y=4, Z=0 and distance 5 mm. The
wireframe draws a cyan A cross, pink B cross, and pink connecting line; labels
remain separate when the projected points coincide. Changing the view preserves
the measurement. Hidden edges and endpoint markers are visible through geometry.

Choose B=`translated`, vertex `0`: components become (3,4,12), distance 13 mm.
Reverse the endpoints to reverse the signed components, preserving distance.
The same instance and the same vertex are allowed, including distance zero.

The instance menu shows the valid zero-based local vertex range. Indices address
the imported vertex order **after optional OBJ part selection**, before concatenation
with other instances. They are not face indices, screen coordinates, weld IDs or
the original OBJ's one-based indices. An OBJ part-selected report includes the
corresponding zero-based original `source_vertex_index`. Retained unreferenced
vertices can be measured; STL imports may repeat a vertex for each triangle.

**Download vertex measurement report** writes a separate JSON observation. It
does not change the saved layout schema, source bytes or placements. Save the
editable layout separately to keep the original geometry and transforms.

Changing either endpoint clears its prior report, overlay and download. Typing a
placement change immediately clears measurement and disables measuring until
the edit is applied or discarded by selecting a placement. Every successful
composition, reopen, array, alignment, duplication or removal clears both endpoint
choices. Re-select and measure the new revision; prior choices are never silently
rebound to replacement source or newly compacted part vertex order. Failed
measurement produces no downloadable report. Failed layout edits retain the
last successfully composed geometry, as in the existing editor.

## CLI

Requires Node 20+ and no dependencies. From the source root:

```sh
node bin/moonmold-reference-measure.mjs --input fixtures/reference-measurement.layout.json --a-instance triangle --a-vertex 0 --b-instance triangle --b-vertex 1 --output measurement.json
node bin/moonmold-reference-measure.mjs --input fixtures/reference-measurement.layout.json --a-instance triangle --a-vertex 0 --b-instance translated --b-vertex 0
```

Omitting `--output` prints JSON. The output file must not already exist. Indices
are decimal nonnegative integers; bad flags, duplicate flags, unknown instances,
out-of-range indices, invalid UTF-8 and files over 3000000 bytes reject. No mesh
export or modified layout is produced by this command.

For choices made against an earlier inspection, pass both
`--expect-layout-sha256 HASH --expect-geometry-sha256 HASH` copied from that
inspection. A mismatch fails. Without these options, the command explicitly
requests a fresh measurement on the file it reads and binds the report to that
composition. Source, transform, units, layout order and name all participate in
layout identity. Even a source-comment-only change invalidates the earlier
layout SHA although the geometry SHA may stay the same.

## Fixed API and report

`POST /api/reference-layout/measure` accepts only:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "example", "instances": [] },
  "endpoint_a": { "instance_id": "part-a", "vertex_index": 0 },
  "endpoint_b": { "instance_id": "part-b", "vertex_index": 2 },
  "expected_layout_sha256": "64 lowercase hex characters from compose",
  "expected_geometry_sha256": "64 lowercase hex characters from compose"
}
```

The illustrative layout must be replaced with a valid nonempty layout. Both
expected hashes are required. Validation recomposes the layout through
`composeReferenceLayout`; no independent transformation math is introduced.
Endpoint coordinates are read at `part.vertex_range.start + vertex_index` in
the composer's placed vertex array. Unknown fields and stale hashes fail with
HTTP 400 and code `invalid-reference-measurement`; invalid layouts retain their
existing layout validation error. The HTTP JSON body is limited to 3000000 bytes.

The standalone `moonmold.reference-vertex-measurement.v1` report contains:

- Canonical normalized `layout_sha256` and placed `geometry_sha256`
- Endpoint instance/local/combined indices, placed coordinates, source byte SHA,
  source name, format, encoding, source units, normalized transform and losses
- Optional selected OBJ part identity and original source vertex index
- `delta_b_minus_a_mm: {x,y,z}`, `distance_mm`, units, frame and transform order
- Explicit qualification, precision/index limits and `physical_authority: false`

Layout SHA is canonical normalized JSON including embedded originals. Geometry
SHA is canonical `{units:"mm",vertices,triangles}`. Neither hash is certification.
All existing composer budgets apply. The report records numeric observations
from IEEE double precision coordinates after unit conversion, uniform scale,
X/Y/Z rotations, optional XY centering/Z grounding, and mm translation. A tiny
difference already lost to source or coordinate precision cannot be recovered
by measuring it. Endpoint distance says nothing about the rest of either mesh.

## Tests

```sh
node --test adapter/reference-measurement.test.mjs
node --test adapter/reference-*.test.mjs
```

Includes literal geometry, same/cross-instance and coincident points, reversed
signed values, each rotation axis, mixed units, scale/grounding, part selection,
binary STL, PLY, orphan vertices, immutable sources, reopen, stale identities,
strict invalid requests, real CLI and loopback HTTP, and executed served UI
handlers with DOM/canvas doubles. These tests qualify computation and handler
behavior, not graphical browser rendering, native MoonBit or live Blender.
