# Editable reference arrays

Repeat an imported reference into a row, grid or stack without manually copying
its placement. Each generated instance remains an ordinary editable member of
`moonmold.reference-layout.v1`. Originals, explicit units, named OBJ part
selections and individual transforms survive save/reopen. This is a one-time
expansion, not a live parametric dependency: changing one copy never changes
another, and running the action again adds more copies.

## Operator workflow

Run `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193`, then open
`http://127.0.0.1:4193/reference-layout`.

1. Open `fixtures/reference-array-seed.layout.json`, or add a local OBJ/STL/PLY.
2. Select the seed instance and apply any scale, rotation, grounding or movement.
3. In **Repeat selected placement**, enter counts X=2, Y=1, Z=3 and pitches
   X=80, Y=0, Z=50 mm, then click **Create editable array**.
4. Inspect six synthetic shelf panels: 24 vertices, 12 triangles and bounds
   approximately `[80,-10,5]`–`[200,50,105]` mm. The seed is a 6 × 4 cm open
   quad, selected from a two-object OBJ, rotated 90° about Z and centered.
5. The last generated copy becomes selected. Move it independently if needed.
   **Save editable layout** downloads the complete portable sources and placements;
   **Combined OBJ/STL** are derived geometry. Reopen the saved layout to edit later.
   **Inspection report** also retains the array operation's cell-to-instance map.

Counts include the original at `[0,0,0]`. Pitch is the displacement between
matching origins along the fixed world X/Y/Z axes, applied after the seed's
existing unit conversion, scale, rotations, centering/grounding and translation.
It is neither an edge-to-edge gap nor local-axis spacing. Negative pitch reverses
that axis. An axis with count >1 needs nonzero pitch; an inactive axis's pitch has
no effect. At least two cells and at most 16 total layout instances are allowed.

The action uses the last applied selected placement, not unsaved edit fields.
Original instances retain their order. New copies append in X-fastest, then Y,
then Z order, using the first free `array-N` IDs. IDs do not encode cell position;
the report's `array.cells` records that mapping. IDs already in use are skipped.
All copies are individually selectable, editable, removable and exportable.
Invalid requests preserve the previous successful layout/downloads. Downloads
must be saved before closing; this operator surface does not persist layouts.

## CLI

Node 20+ only. No MoonBit compilation, npm install or Blender needed.

```sh
node bin/moonmold-reference-array.mjs --input fixtures/reference-array-seed.layout.json --instance panel --counts 2,1,3 --pitch-mm 80,0,50 --output panels.layout.json
node bin/moonmold-reference-layout.mjs --input panels.layout.json --format obj --output panels.obj
node bin/moonmold-reference-layout.mjs --input panels.layout.json --section-axis x --section-position 100 --format svg --output panel-sections.svg
node bin/moonmold-reference-array.mjs --input fixtures/reference-array-seed.layout.json --instance panel --counts 2,1,3 --pitch-mm 80,0,50 --format json --output array-report.json
```

`--format` is `layout` (default), `json` (inspection plus operation report), `obj`
or `stl`. Omit `--output` for stdout. Existing output files are never overwritten.
Counts and pitches use three comma-separated decimal numbers without whitespace.
Counts must be integers. All four input/instance/counts/pitch arguments are required.

## API and lineage

`POST /api/reference-layout/array` accepts exactly:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "example", "instances": [] },
  "instance_id": "panel",
  "counts": [2, 1, 3],
  "pitch_mm": [80, 0, 50]
}
```

The abbreviated `layout` above must be replaced by a valid nonempty editable
layout. No paths, URLs, executable expressions or hidden external sources exist.
The response is the usual `moonmold.reference-layout-result.v1` with an `array`
operation report: parent normalized layout SHA-256, template ID, counts, pitch,
added count and `{instance_id,cell,offset_mm}` entries including the original.
`result.layout` / `exports.layout` are ordinary standalone editable layouts;
`array` is deliberately report metadata rather than a new persisted layout schema.
Keep the report if the original generation recipe and parent hash matter.
Source bytes and source hashes are unchanged. Layout/geometry hashes are recomputed.

Existing layout limits still apply: 400000 bytes per source; 2000000 compact JSON
bytes; 3000000 file/request bytes; 40000 combined vertices and triangles. Array
expansion duplicates source payloads in the portable layout, so large sources can
hit the JSON limit before 16 instances. Pitches are finite and bounded by ±1e9 mm;
all final vertices must satisfy the existing coordinate and precision checks.
Errors are HTTP 400, without partially accepted layout or semantic-scene mutation.

## Qualification and limits

The synthetic panels are open faces, not shelves certified for construction.
Spacing may overlap geometry. No collision, clearance, topology repair, boolean,
watertightness, engineering, physical readiness or live Blender claim is made.
Floating-point rotations may leave tiny coordinate residuals. Extremely small
pitches can become indistinguishable at large coordinates; no dimensional tolerance
is certified. Derived OBJ/STL bake placement into mm; keep layout for editable
source units, exact bytes and selected-face provenance. Original import losses
(materials/textures/normals etc.) remain disclosed per instance.

Focused validation: `node --test adapter/reference-array.test.mjs`.
Full reference regression: `node --test adapter/reference-*.test.mjs`.
Tests cover real CLI files, HTTP, and actual served UI handlers with DOM/canvas
doubles, not browser rendering or a live modeling backend.
