# Make an open cutaway from placed reference surfaces

Extract the triangle surfaces on one side of an explicit X/Y/Z world plane.
This creates a reusable 3D derivative, unlike the existing section workflow's
2D line observations. It is useful for exposing an interior, reducing a reference
to the region needed for another layout, or preparing a cutaway for a viewer.
It needs Node 20+ and built-in modules only. No provider or modeling backend runs.

## Operator workflow

Run `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193` and open
`http://127.0.0.1:4193/reference-layout`.

1. Open `fixtures/reference-cut.layout.json`. The synthetic housing is a 40 × 30 ×
   20 mm box placed at [10,20,5] mm; `marker` is a fixed reference and `discard`
   is a small inch-source tab.
2. Under **Cut reference surfaces at a world plane**, choose `housing` and
   `discard`, axis **X**, position **30** mm, and **At or above position**.
3. Click **Cut chosen surfaces**. The housing now spans [30,20,5] to [50,50,25] mm,
   with 14 triangles. The empty tab is removed. The unselected marker stays exact.
   The cut housing has an open end; no new cap face is generated.
4. **Save editable layout** stores the cut geometry as ordinary embedded mm OBJ
   sources with identity placements. Each retained instance is independently
   editable and can produce OBJ/STL, GLB or a three-view SVG drawing.
5. **Save cut recipe with originals** preserves the original embedded bytes,
   selections, units, placements, chosen IDs and world plane. Save it before a
   later layout edit clears that recipe link. The inspection report additionally
   contains before/after digests and triangle lineage.
6. Use **Restore originals to revise cut** to return to the pre-cut layout, change
   the plane/side and cut again. After closing the page, open the saved `.cut.json`
   in **Reopen a layout or cut recipe**, then restore originals to revise the cut.

The recipe reopens the original input and deterministically repeats the cut.
It is not the current layout after subsequent placement edits. An ordinary saved
layout contains the derivative, not the original sources. Keep both when needed.
A second cut on the derivative cuts that derivative; restoring/reopening a recipe
is how to recut from its original. This is one-level provenance, not an undo stack.

Pending placement edits disable cut and restore. Repeated clicks cannot submit
concurrent changes. Failed requests leave the last successful preview/downloads
intact. Success clears earlier measurements, GLB and drawing links. A cut leaving
no triangles anywhere rejects; it never silently replaces the layout with empty
geometry. All operation state is in memory until downloaded.

## CLI and portable recipe

Run from the source directory; each output filename must be new:

```sh
node bin/moonmold-reference-cut.mjs --input fixtures/reference-cut.layout.json --instances housing,discard --axis x --position-mm 30 --keep positive --output cut.layout.json
node bin/moonmold-reference-cut.mjs --input fixtures/reference-cut.layout.json --instances housing,discard --axis x --position-mm 30 --keep positive --format recipe --output housing.cut.json
node bin/moonmold-reference-cut.mjs --recipe housing.cut.json --format json --output cut-report.json
node bin/moonmold-reference-cut.mjs --recipe housing.cut.json --format obj --output cut.obj
node bin/moonmold-reference-layout.mjs --input cut.layout.json --format stl --output cut.stl
node bin/moonmold-reference-drawing.mjs --input cut.layout.json --output cut.svg
```

`--format` accepts `layout` (default), `recipe`, `json`, `obj` and `stl`.
Omit `--output` for stdout. `--keep positive` means coordinate >= plane position;
`negative` means <=. Units for the plane are always world millimetres after all
source unit conversion, optional selection, scale, rotation, grounding and movement.
`--recipe` cannot be combined with input/cut overrides. Edit a copy of its explicit
`plane` object or restore its original layout in the operator to revise the cut.

The saved recipe is `moonmold.reference-layout-cut.v1`, with exactly `contract_id`,
`layout` (a complete normalized original layout), `instance_ids` (unique IDs in
layout order), and `plane: {axis, position_mm, keep}`. There are no paths, URLs,
expressions or executable fields. Byte hashes are over original bytes; JSON
layout/geometry/recipe hashes use the existing canonical serializer.

## API and geometry semantics

`POST /api/reference-layout/cut` accepts a saved recipe or
`{layout, instance_ids, plane}` with those same fields. It returns the normal
composed derivative plus `cut`, a `moonmold.reference-layout-cut-report.v1`, and
`exports.recipe`, the reusable recipe JSON. Errors return HTTP 400.

Selected instances are intersected with the half-space as triangle surfaces:

- The plane is inclusive. Entirely coplanar triangles are retained. Edge/point
  contact without area is omitted. Triangles crossing the plane become one or two
  triangles, preserving winding. No cap, solid boolean, welding or repair is done.
- Shared source-index edges reuse the exact same intersection vertex. Coincident
  but independently indexed input vertices are not welded. Source STL/PLY import
  semantics still apply before the cut.
- Selected output sources bake world placements into mm OBJ and omit unreferenced
  vertices, old object/group labels and previous selection indices. Source
  materials, normals and textures were already outside reference geometry.
- Unselected normalized instances remain exact. An empty selected instance is
  removed. Retained instance IDs/order are preserved; derived placements become
  identity. Source name becomes the instance ID.
- Each selected report gives original byte hash, format, units, transform, losses,
  original composed vertex/triangle ranges, classification counts and
  `output_triangle_parent_local_indices`. Its entry N identifies which triangle
  of the pre-cut placed instance produced output triangle N. This is not a durable
  source-face/vertex ID. Use the original layout plus its selections to trace back.
- Derived OBJ headers identify original source and parent layout SHA, recipe SHA,
  plane and open-cut status. Keep the recipe and report for full originals/losses;
  later exports from an ordinary derivative layout identify that new OBJ source.

There is no tolerance snapping: side classification and intersections use IEEE
double precision. The cut axis of every intersection is set to the requested
plane exactly. Nearly coplanar geometry can differ across tiny plane changes.
Exactly zero-area triangles produced at coordinate precision are omitted and
counted as `precision_discarded_triangles`; this is not a certified error bound.
Any geometry the existing importer cannot reopen fails the whole operation.

Existing layout limits apply: 16 instances, 400000 bytes per source, 2000000
compact layout bytes and 40000 combined vertices/triangles. Retriangulation can
increase triangle count or derived OBJ size and reject within these limits.
Cut request/recipe files and HTTP bodies are capped at 3100000 bytes; normalized
saved layouts retain their 3000000-byte cap. Plane position is finite within ±1e9
mm. CLI input is strict UTF-8 and output creation never overwrites existing files.

## Qualification

This workflow is reference surface extraction, not engineering CAD, a watertight
solid operation, manufacturing certification, Blender qualification or physical
execution. Original source plus cut recipe gives reproducible digital lineage,
not fitness for any physical use. A closed input commonly becomes open.

Focused validation:
`node --test adapter/reference-cut.test.mjs adapter/reference-arrangement.test.mjs adapter/reference-drawing.test.mjs`.
Tests use real CLI files and loopback HTTP, plus the production served-page
handlers in DOM/canvas doubles. Graphical browser rendering is not tested.
