# Create reference geometry from an editable XY profile

Open `/reference-profile` on the local MoonMold operator server. This new creation
workflow starts with an ordered 2D outline rather than an imported 3D mesh. A
bounded ear-clipping triangulator creates bottom/top caps and side triangles.
Concave and convex simple outlines work in either winding direction.

This guide describes the compatible v1 single-ring recipe. For one editable
interior opening, use the v2 [profile cutout workflow](REFERENCE_PROFILE_CUTOUTS.md)
on the same page and CLI. v1 remains strict and does not accept a cutout field.

## Try it

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

1. Open `http://127.0.0.1:4193/reference-profile`. The built-in stepped outline
   matches `fixtures/reference-extrusion.profile.json`.
2. Click **Build reference mesh**. The shape spans 40 × 30 × 8 mm, with 12
   vertices and 20 triangles. The outline's area is 700 mm²; its concave corner
   is preserved, not filled with a convex fan.
3. Edit the height to 12 and build again. Bounds become 40 × 30 × 12 mm. Edit
   an XY point to change the outline. Changing source units reinterprets both
   points and height; it does not convert field numbers.
4. Download **Save editable profile**, **Save derived layout**, OBJ, STL and the
   lineage report. The profile is the editable authoring source. Reopening it
   rebuilds deterministically; changing it creates a new recipe/geometry digest.
5. Open the derived layout in `/reference-layout` to place it, merge other
   references, make measurements, or export existing GLB/three-view SVG formats.
   Layout placement edits do not rewrite the saved profile.

The canvas is an auto-fit orthographic wireframe including hidden edges. Top and
isometric views change only the view. Preview/downloads show the last successful
build; unbuilt fields are explicitly labeled. Failed validation leaves those
artifacts intact. **Restore last built fields** discards unapplied field edits.
Opening an invalid file keeps the existing fields and artifacts. Builds are
single-flight, and replies cannot overwrite a newer draft. Nothing is persisted
until downloaded. This page has no automatic history or client-acceptance record.

## Portable recipe and CLI

```json
{
  "contract_id": "moonmold.reference-profile-extrusion.v1",
  "name": "stepped-profile",
  "units": "mm",
  "coordinate_frame": "xy-z-up",
  "vertices": [[0,0],[40,0],[40,10],[15,10],[15,30],[0,30]],
  "height": 8
}
```

All six fields are required; unknown fields reject. No executable statements,
paths, URLs, expressions or external resources are supported. `name` is a
1–80-character alphanumeric/dot/dash/underscore identifier starting alphanumeric.
`units` is exactly `mm`, `cm`, `m` or `in`; the same units apply to XY and height.
The frame is exactly `xy-z-up`: base Z=0, extrusion in +Z. Output is always mm.
Clockwise input is preserved in the recipe; generated cap/side winding is outward.

```sh
node bin/moonmold-reference-extrude.mjs --input fixtures/reference-extrusion.profile.json --format layout --output new.layout.json
node bin/moonmold-reference-extrude.mjs --input fixtures/reference-extrusion.profile.json --format obj --output new.obj
node bin/moonmold-reference-extrude.mjs --input fixtures/reference-extrusion.profile.json --format stl --output new.stl
node bin/moonmold-reference-extrude.mjs --input fixtures/reference-extrusion.profile.json --format json --output new-report.json
```

`--format` is `layout` (default), `recipe`, `json`, `obj` or `stl`. `json` returns
the full composed result plus `extrusion` report and export strings. Omit
`--output` for stdout. CLI files and HTTP bodies are at most 32000 bytes; input is
strict UTF-8. Each output filename must be new: an existing file is never replaced.

`POST /api/reference-profile/extrude` accepts the recipe directly. The exported
`extrudeReferenceProfile(recipe)` function is the same implementation. HTTP
invalid input returns 400. The result is the existing composed layout shape,
with an `extrusion` report and `exports.recipe`. Its one instance embeds mm OBJ
with identity placement; this requires no Blender or external dependency.

## Geometry limits and lineage

- The v1 recipe has one ring of 3–128 finite XY points, each within ±1000000 mm after conversion.
  The first point is not repeated; closing is implicit. Height after conversion
  must be 0.000001–1000000 mm, inclusive.
- Reject repeated points, nonadjacent touching/crossing edges, collinear corners
  and nearly ambiguous orientation tests. v1 does not support holes; v2 supports
  one strictly interior polygon cutout as documented separately. Multiple holes,
  curves, bevels, constraints and booleans are not supported. Simplify invalid outlines explicitly;
  no automatic repair, snapping, welding or vertex removal occurs.
- Binary64 orientation uses a rejection band of span² × 1e-12 (span is the larger
  XY extent in mm). This is a computational ambiguity guard, not a dimensional
  tolerance or robust exact-predicate guarantee. Near-degenerate outlines may
  reject during triangulation. The existing OBJ importer revalidates every
  emitted triangle before a result is returned.
- Ear clipping yields N−2 cap triangles per cap and 2N side triangles. Original
  point order is retained in the vertex arrays: bottom indices 0…N−1, top indices
  N…2N−1. Side/cap mappings in `triangle_lineage` refer to zero-based authored
  point indices. The two triangles of a side refer to its normalized CCW edge.
- `recipe_sha256` is over the canonical recognized recipe JSON, not the input
  file's whitespace/byte spelling. Geometry and layout hashes use existing
  composition contracts. The report retains the normalized recipe, source units,
  frame, input winding, height, area, losses and per-triangle profile mapping.
  OBJ source comments include the recipe hash. Keep the report and profile to
  traverse this relationship: ordinary mesh/layout exports alone lose profile
  semantics. A moved/scaled layout is a separate derivative and its old extrusion
  report does not describe the later placement.

The editable profile is a bounded reference authoring source. It neither replaces
an engineering scene nor supplies engineering CAD, physical suitability,
manufacturing authority or live Blender evidence. Generated surfaces are capped
and consistently indexed for supported inputs; this is not certified watertightness
or a tolerance guarantee. Existing volume observation remains an algebraic estimate.

## Validation

Run `node --test adapter/reference-extrusion*.test.mjs`. Geometry tests independently
check cap areas, positive signed volumes, outward normals and opposite directed
edge pairs, including concavity, reversed winding, units and reopened emitted
OBJ/STL/layout. Real CLI file creation and loopback HTTP are exercised. Production
page handlers run in DOM/canvas doubles for edits, file opening, failures,
single-flight submission and stale reply suppression. These are not graphical
browser or screenshot checks. Broader inherited live Blender/image failures remain
separate and do not become qualified through this reference workflow.
