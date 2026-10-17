# Place reference models along a polyline

MoonMold's reference workbench turns imported spatial references into editable
layouts. This operation places copies at equal arc-length intervals along an
open, world-space 3D polyline. It keeps each source payload, selected part,
scale, rotation and centering/grounding setting. It does not bend the mesh or
align it to path tangents.

## Operator journey

1. Start the existing operator server and open `/reference-layout`.
2. Load `fixtures/reference-array-seed.layout.json` and select `panel`.
3. In **Repeat along a polyline**, enter
   `[[0,0,0],[30,0,0],[30,0,70]]` and a total count of `5`.
4. Choose **Place along path**. The selected instance moves to the first point;
   four independent copies are appended. Placement origins are at
   `(0,0,0)`, `(25,0,0)`, `(30,0,20)`, `(30,0,45)`, `(30,0,70)`.
5. Inspect the common preview, edit any individual copy, and save the editable
   layout. Reloading keeps the placements. Existing undo/redo also applies.

Coordinates specify the instance translation origin after existing scale,
rotation and optional centering/grounding, not a bounding-box corner. Distance
is measured along the path, so the straight-line distance across a corner can
be less than the interval. Both endpoints are included. A closed loop may be
entered by repeating the first point at the end; both endpoint placements
then overlap intentionally.

## CLI

From the repository root:

```sh
node bin/moonmold-reference-path-array.mjs \
  --input fixtures/reference-array-seed.layout.json --instance panel \
  --count 5 --points-mm '0,0,0;30,0,0;30,0,70' \
  --output path-placements.layout.json
```

The default output is the normal editable layout. `--format json` includes the
placement samples and parent layout digest; `obj` and `stl` provide the existing
derived geometry outputs. Output files use exclusive creation and will not
overwrite an existing file.

The operator endpoint is `POST /api/reference-layout/path-array` with JSON
`{layout, instance_id, count, points_mm}`. The same bounded implementation serves
CLI and UI. Existing source and combined geometry limits still apply, along
with 2–64 points and a maximum final layout size of 16 instances. Consecutive
points must be distinct. Unselected instances stay unchanged. Invalid edits
leave the currently displayed layout available.

## Qualification

This is digital reference placement. It does not check collisions, establish
watertightness, qualify Blender output or authorize engineering/manufacturing.
Focused Node tests exercise real operator HTTP and the served page's handlers
using DOM/canvas doubles. A graphical browser and complete release gates were
not run; previous blocked and unrun gates remain blocking.
