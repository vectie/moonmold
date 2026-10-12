# Measure a reference surface-area schedule

Inspect how much triangulated surface each placed reference represents, and
export a per-instance CSV schedule with a source-bound JSON report. This works
with existing saved layouts, named OBJ selections, static GLB node selections,
and the ordinary editable reference workflow. No new model format or dependency
is required.

The measurement is **unsigned triangle-sum area**, not exposed exterior area.
Every retained triangle counts once regardless of winding. Overlapping,
coincident, duplicate and internal faces count independently, including separate
instances. An open sheet is counted once, with no inferred second side,
thickness, waste allowance or material quantity. No volume, mass, engineering
fitness, fabrication or other physical authority is established.

## Choose, inspect and save in the operator

Use Node 20+ from this repository root:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`:

1. Open `fixtures/reference-surface-area.layout.json`, or add/reopen your own
   references with explicit source units and apply their placements.
2. Under **Measure triangle surface area**, select the instances to include.
   All instances start selected when a layout is applied. Ctrl/Command selects
   several. Instance selection does not edit the layout.
3. Click **Calculate surface-area schedule**. Read each instance's area in mm²
   and m², its triangle count and its area-weighted surface centroid in world
   millimetres. The total covers only the chosen references.
4. Download **area report JSON** and **area schedule CSV**. Save the ordinary
   **editable layout** beside them so you can reopen the original sources and
   placements. The schedule is an observation, not a replacement model.
5. Change source, scale or placement, apply the edit, then measure again. Applied
   changes or changed area selection clear the old area links. Pending placement
   fields disable calculation and clear those links; apply or discard them first.

The example uses three synthetic open references:

- `base`: a 2 × 1 cm panel, area **200 mm²**, centroid `[10, 5, 0]` mm.
  Its unreferenced vertex at `[99,99,99]` cm affects bounds but contributes no area.
- `upright`: a 30 × 20 mm panel scaled by 1.5, turned 90° around X and moved to
  `[100,20,5]` mm, area **1350 mm²**, centroid approximately `[122.5,20,20]` mm.
- `selected-bracket`: a selected 3 × 2 cm right triangle, area **300 mm²**,
  centroid approximately `[-30,6.6666666667,0]` mm. The unselected offcut is absent.

The total is **1850 mm²**, or **0.00185 m²**, over five triangles. Choosing only
`base` and `selected-bracket` gives **500 mm²**. IEEE arithmetic can leave small
residuals in centroid/rotation coordinates. Changing `base` scale to 2 produces
800 mm² for that part and 2450 mm² overall. Sources remain unchanged and editable.

Failed calculation or mismatched responses retain the last valid report for the
same current selection. Repeated actions are locked while the request runs;
responses superseded by a selection or layout change are discarded. Removing
the final reference clears the report and choices. This page does not persist
layouts or reports on the server; download before closing it.

## CLI for existing layout files

```sh
# Full schedule: source-bound JSON is the default.
node bin/moonmold-reference-area.mjs --input fixtures/reference-surface-area.layout.json --output panels.area.json

# Selected references: a CSV row per instance, in saved layout order.
node bin/moonmold-reference-area.mjs --input fixtures/reference-surface-area.layout.json --instances base,selected-bracket --format csv --output chosen.area.csv

# Save/reopen the original editable model using the existing product command.
node bin/moonmold-reference-layout.mjs --input fixtures/reference-surface-area.layout.json --format layout --output panels.layout.json
node bin/moonmold-reference-area.mjs --input panels.layout.json --format csv
```

`--instances` is an optional comma-separated list of exact existing IDs; omitted
means every instance. Nonempty unique choices are required. JSON/CSV output is
canonicalized to layout order, not selection order. `--format` is `json` or `csv`;
omit `--output` for stdout. Outputs must be new files; existing files and symlinks
are not replaced. Inputs must be regular local UTF-8 layout JSON files within
3000000 bytes. Original files remain unchanged. Invalid options, input, units,
geometry or selection fail with nonzero status and a JSON stderr error before
any output is written. No paths inside the input are followed or fetched.

The npm alias is `npm run reference-area -- --input <layout> ...`; it uses the
same dependency-free Node command and does not install packages.

## API, identities and measurement semantics

`POST /api/reference-layout/surface-area` accepts only:

```json
{
  "layout": "replace this placeholder with the complete saved layout object",
  "instance_ids": ["base", "selected-bracket"]
}
```

The `layout` must be an actual object, not the explanatory string above. Both
fields are required. `instance_ids` needs 1–16 unique IDs present in that layout.
The HTTP body limit is 3100000 bytes. The shared composer also enforces 16 total
instances, 400000 source bytes per instance, 2000000 compact layout JSON bytes,
and 40000 combined vertices and triangles each. Invalid requests return HTTP 400.
This endpoint observes the request and does not mutate the semantic scene,
recovery state or server files.

The module entry point is `measureReferenceSurfaceArea({ layout, instance_ids })`
in `adapter/reference-surface-area.mjs`. It returns
`moonmold.reference-surface-area.v1`, including:

- Full-layout and combined-geometry SHA-256, layout name and frame
- Chosen IDs and counts, individual parts and the chosen-only total
- Per-part original source SHA-256, format/units, selected OBJ part or GLB node
  IDs where applicable, normalized placement and combined triangle range
- `triangle_sum_area_mm2`, `triangle_sum_area_m2`, `surface_centroid_mm` and
  `triangle_count`; source import losses remain visible
- Explicit `physical_authority: false`, qualification and limitations
- `exports.json`, the report without its exports wrapper, and `exports.csv`

Area is half the magnitude of the cross product of each placed triangle's two
edge vectors. The surface centroid weights each triangle's vertex-average
centroid by that area. Compensated sums reduce accumulation loss; they do not
correct input accuracy or coordinate precision. Uniform scale squares area;
rotation and translation preserve it mathematically. Calculations use actual
placed coordinates, so tiny geometry at large translations can lose precision.
Degenerate input and collapsed placed triangles reject through the composer;
nonpositive or nonfinite measured area also rejects. There is no guessed area,
repair, tolerance or numerical accuracy guarantee.

CSV has one row per chosen instance, with layout/geometry/source identities,
source format/units, triangle count, mm²/m² area, centroid XYZ and the false
physical-authority flag. It has no total row to double-count accidentally: sum
the area column for the chosen total, allowing ordinary floating-point rounding.
Cells contain validated identifiers, hashes, numbers and fixed literals; source
names are retained only in JSON. The read-only CSV cannot be applied as an
editable placement table.

Digests identify data and do not certify accuracy. Binding covers the **entire**
layout, including unchosen references. Even a source-comment change can change
layout identity without changing area/geometry. The report does not auto-update.
Original sources and their editable placements travel in saved layout JSON,
not in this report. For rendered views use the existing SVG drawing workflow;
for actual model edits continue with the reference-layout operator.

## Product rationale and verified scope

This extends the inspectable digital artifact loop in MM-W01 and the actual
`prd_work/output/MoonMold_PRD.docx` requirements MOONMOLD-B02 (representation
truth/identity), N01 (unit/frame integrity) and N05 (legible limits). Existing
bounds, point distances and section linework did not report triangle-sum area.
This is a bounded reference observation/output workflow, not completion of broad
parametric CAD, live Blender, engineering review or client acceptance criteria.

```sh
node --test adapter/reference-surface-area*.test.mjs
node --test adapter/reference-*.test.mjs
```

The focused suite covers literal areas and centroids, selected sources, binary
STL/PLY, imported GLB nodes, scaling/rotation, overlap semantics, real CLI files,
save/reopen, independent CSV parsing, loopback HTTP and the production page's
handlers with DOM/canvas doubles. It also covers edited/removed layouts,
selection changes, repeated actions, failed and stale responses. Those handler
tests are not real-browser visual qualification. No browser, native MoonBit,
Blender, external provider or hardware execution was run for this workflow.
