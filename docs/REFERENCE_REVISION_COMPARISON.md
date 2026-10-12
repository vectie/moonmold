# Inspect a saved layout revision against the current layout

Load a previous saved layout as a read-only baseline and see what changed in the
current applied layout. The three-view SVG overlays before (orange dashed) and
after (blue solid) in the same world coordinates. A readable change ledger and
JSON report separate source revisions, placements, additions/removals and export
order. Neither layout is modified. This is revision inspection, not Undo/Redo,
source replacement, design acceptance or a persistent geometric constraint.

## Operator workflow

Only Node 20+ and built-in modules are needed:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`.

1. Open `fixtures/reference-revision.layout.json` as the current layout.
2. Under **Compare a saved revision with this applied layout**, choose
   `fixtures/reference-drawing.layout.json` as the previous layout.
3. Check the frame declaration only after establishing that both files use the
   same intended world origin and axes. Source units are explicit and converted
   by the existing composer; the tool does not register or align different frames.
4. Click **Compare saved revision**. Inspect the inline SVG and change ledger.
   The example shows a comment-only source revision on `base`, a 45 mm Y movement
   of `raised-block`, and a removed/added pair for the renamed stop. The combined
   Y span increases by 45 mm. Comment changes preserve the indexed geometry hash.
5. Download the overlay and exact JSON report. Keep both editable layout files
   as well, because the comparison deliberately omits their embedded source bytes.

This inspection does not replace the current layout, alter history or carry
forward a named review. Apply or discard pending placement fields first.
Placement edits, history restoration, a new applied layout, removal of the last
instance, choosing another baseline, or changing the frame declaration clear the
comparison links and preview. Repeated clicks while busy do not issue another
request. Failed/mismatched requests retain the last successful comparison for
unchanged inputs; a stale pending response cannot publish after inputs change.
The browser does not persist comparison state; save files before closing.

## CLI and API

From the checkout root, choose new output paths:

```sh
node bin/moonmold-reference-compare.mjs --before fixtures/reference-drawing.layout.json --after fixtures/reference-revision.layout.json --same-world-frame yes --output revision.svg
node bin/moonmold-reference-compare.mjs --before fixtures/reference-drawing.layout.json --after fixtures/reference-revision.layout.json --same-world-frame yes --format json --output revision.json
```

Default format is SVG; omit `--output` for stdout. Existing destinations are
refused. Inputs are strict UTF-8 editable layout JSON, each at most 3000000 bytes.
Unknown/duplicate flags and invalid inputs fail before output creation.
`--same-world-frame yes` is an explicit caller declaration, not a measured fact.
No files are fetched and no editable source is written by this command.

`POST /api/reference-layout/compare-revisions` accepts exactly:

```json
{ "before": "editable layout object", "after": "editable layout object", "same_world_frame": true }
```

Replace the two illustrative strings with actual `moonmold.reference-layout.v1`
objects, not computed meshes, paths, URLs, reports or cut recipes. The body is
limited to 6100000 bytes. Both layouts are independently recomposed through the
existing importer/transform code, with existing per-source, 16-instance and
40000-vertex/triangle limits applied to each. Wrong/missing frame declarations
or layouts return HTTP 400. No operation receipt, provider run, persisted review,
client acceptance or fabrication authority is created.

## What the change report means

The report contract is `moonmold.reference-revision-comparison.v1`.

- Instances match by exact case-sensitive ID only. A rename appears as removal
  plus addition even when its bytes and geometry are identical. No correspondence
  is guessed from source names, similar shapes or coincident vertices.
- Matched instances retain complete before/after source SHA, declared source
  format/units/name, OBJ part or GLB node selections, transforms, bounds, counts,
  source loss notes and per-instance indexed placed-geometry SHA.
- `changed_fields` identifies source bytes, individual source declarations,
  placement recipe, indexed placed geometry and numeric export-index changes.
  Adding or removing an earlier entry can change later export indices.
- `bounds_delta_mm` is after-minus-before for world-axis minimum, maximum and
  span. These are bound changes, not a tracked vertex displacement. Added and
  removed IDs have null deltas. Source/placement details remain separate.
- Layout name and instance list/order changes are reported explicitly. Renaming
  only the layout leaves every instance unchanged. A comment-only edit changes
  source/layout identity but can preserve geometry identity.
- Geometry identity uses exact canonical JSON of placed millimetre vertices and
  local triangle indices, after the existing binary64 calculation. There is no
  tolerance or geometric-equivalence solver. Equivalent indexed reorderings,
  winding or floating-point residues may report geometry changes. Unused retained
  vertices count; source-unit spelling can change without changing placed values.

The JSON contains the exact before/after normalized layout and combined geometry
hashes. `comparison_sha256` hashes canonical sorted-key JSON of all report fields
except itself and `exports`. It is an integrity reference, not a signature,
authentication or evidence that source declarations are true. The CLI JSON equals
the SVG metadata. Reproduce the report from both saved layouts; the report is not
itself an editable layout and has no dedicated reopen/import command.

## Overlay and qualification limits

All three views share one auto-fitted scale over both revisions' union bounds.
Top maps X/Y, front X/Z and right Y/Z; the second axis points up. Each revision
uses identical origin/scale within a view. Triangle-index edges are deduplicated
within an instance only; hidden edges, triangulation diagonals and unreferenced
vertex dots remain visible. No source materials, shading, hidden-line removal,
mesh distance, contact or clearance calculation is performed. Identical blue
edges can cover orange dashes. Read the ledger when overlays coincide.

SVG coordinates round to six decimal places and labels to nine significant
digits; exact numbers and source loss notes remain in metadata. Very small details
may not be visible at the fitted scale. This is not a print-scale template.
The tool cannot establish that independently authored files use the same intended
world frame; the caller must check. It does not transfer old reviews or certify
changed designs, engineering fitness, manufacturing or physical readiness.
`physical_authority` remains false, with no Blender execution.

Supports PRD MM-W04/B08 revision inspection and MM-W05/R01's changed-dimension
review need, without claiming those broader acceptance workflows complete.

## Focused verification

```sh
node --test adapter/reference-revision.test.mjs adapter/reference-drawing.test.mjs adapter/reference-history.test.mjs
```

Tests run real CLI/loopback HTTP and production workbench handlers with DOM/canvas
doubles. Literal coordinate assertions, source/units/selection changes, ordering,
comment-only changes, additions/removals, digest recomputation, interruption and
history/edit invalidation are covered. These checks do not qualify a graphical
browser, MoonBit/native application, live Blender, physical model or full product.
