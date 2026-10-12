# Export a three-view reference drawing

Turn the applied reference layout into a self-contained SVG sheet with top,
front and right wireframes, overall X/Y/Z dimensions in mm, per-instance colors
and the exact layout/geometry/source identities. A recipient can open the SVG in
an image viewer without a 3D tool. Keep the editable layout JSON alongside it to
reopen the original sources and placements.

## Operator workflow

Run `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193`, open
`http://127.0.0.1:4193/reference-layout`, and load
`fixtures/reference-drawing.layout.json`. The example has a 120 × 80 × 12 mm
base, a rotated block authored in cm, and a small stop. Overall bounds are
120 × 80 × 27 mm.

1. Inspect or edit the placements, then click **Apply placement**.
2. Click **Prepare three-view drawing**. Download the SVG drawing and optional
   JSON drawing report. The report is also embedded inside the SVG as metadata.
3. Select `raised-block`. Align its Y minimum to `base` Y maximum with a 5 mm
   offset. Prepare another drawing: Y now spans 145 mm. The original source
   hashes remain the same, while layout and geometry identities change.
4. Save editable layout JSON as well. Reopen it and prepare the drawing again;
   unchanged inputs yield identical SVG bytes.

New placement edits clear drawing links immediately and disable preparation
until applied or discarded by selecting a placement. New composed layouts and
removing the last instance also clear drawing links. Repeated clicks while busy
are ignored. Failed export keeps the last valid drawing for that same applied
layout; a mismatched response is rejected. No server persistence or provider
execution is involved. Save files before closing the page.

## CLI and API

Only Node 20+ and its built-in modules are needed. From the source root:

```sh
node bin/moonmold-reference-drawing.mjs --input fixtures/reference-drawing.layout.json --output stand.drawing.svg
node bin/moonmold-reference-drawing.mjs --input fixtures/reference-drawing.layout.json --format json --output stand.drawing.json
```

`svg` is the default format. Omit `--output` for stdout. Output paths must not
exist; existing files are not overwritten. Inputs must be strict UTF-8 JSON
within the existing 3000000-byte saved-layout limit. Unknown or duplicate flags
and unsupported output formats reject.

`POST /api/reference-layout/drawing` accepts an ordinary
`moonmold.reference-layout.v1` manifest, not precomputed meshes or filesystem
paths. It returns `moonmold.reference-layout-drawing.v1` with an `exports.svg`
string. Invalid layouts return HTTP 400 with existing composer diagnostics.
The CLI's JSON format omits the SVG string; the SVG's `<metadata>` contains this
same report. No new semantic operation, build receipt or approval is created.

## Projection and dimensions

- Top looks from +Z toward −Z: +X right, +Y up.
- Front looks from −Y toward +Y: +X right, +Z up.
- Right looks from +X toward −X: +Y right, +Z up.
- All three use one common auto-fitted scale and the combined world-bounds center.
  This is a diagram, not a calibrated print template or a technical projection
  standard. Do not infer physical dimensions from print size.
- Dimension bars and labels give overall world-axis spans across every retained
  vertex. They are not designer-authored dimensions, tolerances or minimum mesh
  separation. Planar layouts correctly show a zero span on their flat axis.
- Every triangle edge is visible, including hidden edges and triangulation
  diagonals. Only duplicate vertex-index edge pairs within one instance are
  collapsed. Equal-position vertices, separate instances and projected overlaps
  remain distinct. Unreferenced retained vertices appear as dots and contribute
  to bounds. No hidden-line removal, silhouette extraction or surface inference
  occurs.

The composer supplies placed vertices after source-unit conversion, uniform
scale, X/Y/Z rotations, optional XY centering/Z grounding and mm translation.
It handles existing OBJ part selections, ASCII/binary STL and PLY, and imported
static GLB nodes. No second placement implementation is introduced. Existing
limits apply: 16 instances, 400000 source bytes each, 40000 combined vertices
and triangles, and ±1e9 mm coordinates.

## Identity and representation losses

The report records exact normalized layout SHA-256 and placed geometry SHA-256,
combined and per-instance bounds, original source hashes/formats/units, normalized
transforms, source-loss notes, edge/dot counts, GLB/OBJ selection provenance,
view mappings and explicit `physical_authority: false`.

SVG display coordinates are rounded to six decimal places in fitted sheet units;
numeric dimension labels use nine significant digits. Exact double-precision
bounds and view mappings remain in metadata. Common scale is at most limited by
the existing coordinate precision; very small projected details can disappear.

Projection removes depth, and overlapping lines say nothing about contact or
clearance. Instance colors are identification only; source materials, shading
and textures are absent. The SVG lacks original bytes required to reopen an
editable layout. It is an unqualified reference drawing, with no live Blender,
engineering, solid, manufacturing or physical-readiness claim.

## Focused verification

`node --test adapter/reference-drawing.test.mjs` checks rendered path coordinates,
actual CLI files and loopback HTTP, plus the served workbench's JavaScript with
DOM/canvas doubles. It covers units/transforms, GLB/PLY/STL/selected OBJ sources,
planar/unused geometry, 16 instances, save/reopen, source-preserving edits,
invalid input, repeated clicks, stale/mismatched results and download lifecycle.
These checks do not qualify interactive browser rendering or live Blender.

For a saved collection of named vertex-to-vertex observations and an annotated
sheet, use [named dimension sheets](REFERENCE_DIMENSIONS.md).
