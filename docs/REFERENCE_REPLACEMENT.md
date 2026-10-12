# Revise a layout source without rebuilding placements

Replace the embedded mesh in explicitly chosen instances with a revised local
file. Each instance keeps its ID, ordering and applied scale/rotation/translation
recipe. Unselected instances keep their exact original source, selection and
placement, even when they share the old bytes. Save/reopen uses the same portable
`moonmold.reference-layout.v1` contract. No backend or provider is called.

## Layout workbench

Start `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193` and open
`http://127.0.0.1:4193/reference-layout`.

1. Open your saved layout and apply any pending placement edits.
2. In **Replace embedded source with a revised file**, choose the instance IDs.
   The current instance is selected initially; Ctrl/Command selects several.
   Selecting a different placement resets this target list to that placement.
3. Choose the revised OBJ/STL/PLY and its original units. The whole new file
   replaces any previous named-part/GLB-node selection. The CLI/API also support
   explicit selections in a new OBJ/GLB.
4. Click **Replace chosen sources**. Inspect the updated bounds and preview,
   then save the editable layout and inspection report. The latter includes
   before/after identities and bounds for each changed instance.
5. Prepare a fresh drawing or GLB if needed. Prior drawing/GLB links and vertex
   measurement endpoints are cleared after replacement. Failed replacement
   leaves the last successful layout, preview and downloads available.

Only one request runs at a time. Replacement is disabled until pending placement
edits are applied. Layouts are in-memory; save before closing. Keep the previous
layout separately to return to its original sources after closing. The workbench
supports bounded [session Undo/Redo](REFERENCE_LAYOUT_HISTORY.md), including
original-source restoration. It does not persist history to the
server or modify an original file.

## CLI example

The synthetic fixture has three copies of an old 6 × 4 cm panel. Replace `left`
and `right` with the revised 8 × 3 cm panel, leaving `untouched` as it was:

```sh
node bin/moonmold-reference-replace.mjs --input fixtures/reference-replacement.layout.json --instances left,right --mesh fixtures/reference-revised-panel.obj --units cm --output revised.layout.json
node bin/moonmold-reference-replace.mjs --input fixtures/reference-replacement.layout.json --instances left,right --mesh fixtures/reference-revised-panel.obj --units cm --format json --output replacement-report.json
node bin/moonmold-reference-layout.mjs --input revised.layout.json --format obj --output revised.obj
node bin/moonmold-reference-drawing.mjs --input revised.layout.json --output revised.svg
```

`left` keeps scale 2, 90° Z rotation and center/ground, spanning
[70, -60, 5] to [130, 100, 5] mm. `right` keeps scale 0.5 and 180° Z rotation,
spanning approximately [-90, -5, 2] to [-50, 10, 2] mm. The third panel stays
at [0, 100, 0] to [60, 140, 0] mm. Whole-layout dimensions are 220 × 200 × 5 mm.
The two selected originals carried `part_ids: ["object-1"]`; these are deliberately
removed because this new file's entire geometry was requested.

`--format` accepts `layout` (default), `json` (composition plus replacement
report), `obj` or `stl`. Omit `--output` for stdout. Files must be new: an existing
output, including the input file, is never overwritten.

The CLI accepts OBJ, ASCII/binary STL, ASCII/binary PLY and bounded static GLB.
Extension selects the format; `--input-format` overrides it. Units must be
explicit. GLB requires `--units m`, using its existing metres/Y-up to mm/Z-up
mapping. `--parts object-1,group-2` selects occurrences in the new OBJ;
`--nodes 0,2` selects mesh-node indices in the new GLB. Without these flags, all
supported geometry from the new file is used. Old selection indices are never
inherited. Selections apply identically to all requested targets. Make separate
replacement calls when targets need different new selections.

Instead of `--mesh`, `--source saved.source.json` reads a portable source object
with embedded bytes/text, format, units and optional selection. Source overrides
cannot be combined with `--source`. No input path or URL inside JSON is loaded.

## API and identities

`POST /api/reference-layout/replace-source` accepts exactly:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "example", "instances": [] },
  "instance_ids": ["left", "right"],
  "source": { "input_format": "obj", "units": "cm", "name": "revised.obj", "text": "v 0 0 0\nv 8 0 0\nv 0 3 0\nf 1 2 3\n" }
}
```

Replace the abbreviated empty layout with a valid nonempty saved layout.
Every target must exist, and target IDs must be unique. The API returns the
normal composed layout and exports plus `replacement`, contract
`moonmold.reference-source-replacement.v1`. It records parent and resulting
layout/geometry SHA-256, changed IDs in layout order, preserved transforms and
before/after source identity, selection, placed bounds, counts and losses.
Source digests hash exact original bytes; layout and geometry digests use the
existing canonical contracts. Comment-only edits can change source/layout
identity without changing geometry; changing declared units can change geometry
while the source byte digest remains the same. Hashes are identity, not approval.

The existing importer and composer enforce all input/selection/coordinate and
resulting composition limits. Maximum source size is 400000 bytes, compact
layout JSON 2000000 bytes, saved layout/HTTP body 3000000 bytes, 16 instances and
40000 combined vertices/triangles. CLI source JSON is capped at 2000000 bytes.
Invalid input returns HTTP 400 with no partial result. API calls are stateless.

## Placement and representation limits

Preserving a placement recipe is different from preserving occupied bounds.
Changed source origins move geometry before the retained transform. When
center/ground is enabled, its bounding-box adjustment is recomputed from the
new geometry. Replacement never fits a new model into the old dimensions or
reapplies prior one-time alignment. Inspect and realign intentionally if needed.

Source revisions do not preserve previous selection IDs, vertex indices,
measurements, implicit relationships, or prior reports as current evidence.
The inspection report includes source losses. Editable JSON retains the new
original source, explicit units and recipe; OBJ/STL/GLB and SVG remain derived
outputs with their existing losses. Keep the editable source. This is reference
editing, with no CAD constraints, topology repair, collision, engineering,
manufacturing, acceptance, Blender qualification or physical authority.

Focused checks:
`node --test adapter/reference-replacement.test.mjs adapter/reference-drawing.test.mjs`.
These exercise real CLI files and loopback HTTP, exact byte/geometry checks,
and production page JavaScript in a DOM/canvas test double. Actual browser
rendering and the separate MoonBit/native/Rabbita paths are not qualified.
