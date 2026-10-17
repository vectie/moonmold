# Find the nearest gap between placed reference surfaces

Open the existing `/reference-layout` workbench and load
`fixtures/reference-separation.layout.json`. Under **Find the nearest gap between
two reference surfaces**, choose A=`base`, B=`raised`, and calculate. The answer
is **5 mm**, from A=(10,10,0) to B=(10,10,5). A is inside the base triangle, so
measuring only imported vertices would miss this gap. The cyan/pink markers,
connecting line and highlighted triangles identify one closest witness pair.
Choose B=`crossing` to find a zero-distance surface intersection at (12,12,0),
even though the source triangles share no vertex.

Select the base placement, change its Z translation to 2 mm, and apply. Choose
the two surfaces again: the gap becomes 3 mm. Download the separate JSON report
and **Save editable layout**. Reopening the saved layout preserves every original
source byte, declared unit and placement. Recalculate a new report after edits.
The observation does not change the layout schema or create a review/receipt.

Changing either surface, editing placement fields, composing/reopening a layout,
Undo/Redo, or removing a reference clears the old report and overlay. Pending
replies cannot publish after those inputs change; repeated clicks while busy do
not dispatch another calculation. A failed response for unchanged inputs retains
the last successful report. Changing the camera preserves the measurement.
Preview-only placement overlays hide the witnesses until returning to the applied
layout. Markers and edges remain visible through geometry; this is wireframe
inspection, without occlusion or physical contact visualization.

## CLI and local API

Node 20+ and built-in modules are sufficient. From the patched checkout:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
node bin/moonmold-reference-separation.mjs --input fixtures/reference-separation.layout.json --a-instance base --b-instance raised --output gap.json
```

Open `http://127.0.0.1:4193/reference-layout`. The CLI prints JSON if `--output`
is absent; existing output files are refused. Optional
`--expect-layout-sha256 HASH --expect-geometry-sha256 HASH` binds earlier choices
to the exact inspected composition. Supply both or neither. Without them, the
CLI explicitly measures the file it just read. Input is strict UTF-8 layout JSON,
at most 3000000 bytes. Unknown or duplicate flags fail.

`POST /api/reference-layout/separation` accepts only `layout`, `instance_a`,
`instance_b`, `expected_layout_sha256`, and `expected_geometry_sha256`. The hashes
are mandatory in the API. Both IDs must name different current instances.
The endpoint recomposes through the existing OBJ/STL/PLY/GLB importer and
placement implementation and rejects stale identity. No URL, filesystem path,
arbitrary script, backend invocation or physical command is accepted by the API.

The `moonmold.reference-surface-separation.v1` report contains the layout/geometry
hashes, numeric distance and signed B-minus-A vector, two witnesses, source-byte
hashes, transforms, import losses, local and combined triangle indices, local
vertex indices, triangle counts, pair budget and explicit limitations. Original
OBJ part or GLB node selection provenance is retained where available. The JSON
is an observation; keep the editable layout separately to reproduce it.

## What the gap means

This is the minimum Euclidean distance between the represented triangle surfaces
of the two selected instances, after conversion to millimetres and placement.
The algorithm enumerates triangle pairs, checks edge/face intersections, and
compares vertex/face and edge/edge candidates. It handles face-interior witnesses,
coplanar contacts, skew edges and open surfaces. A zero candidate allows early
termination. Ties retain the first encountered candidate; there may be many
equally valid closest pairs. No persistent constraint or automatic movement is
created.

The product rejects more than **250000 triangle pairs** before enumerating them.
For example, 500 × 500 is within budget; 501 × 501 is unavailable. The existing
layout/import budgets still apply. Select smaller named parts or simplify the
source separately. No approximate sampling or bounding-box answer substitutes
for a refused calculation.

Unreferenced vertices do not participate. Existing importer rejection of invalid
or degenerate source faces and transform rejection of triangles collapsed by
placement precision remain unchanged. No distance report is produced for those
rejected layouts. Source triangulation, unit
declarations, floating-point precision and import losses remain significant.
The implementation uses binary64 arithmetic with no intentional snapping of
positive gaps to zero. Near-degenerate, nearly coplanar or very differently scaled
geometry can be numerically unstable; this is not an exact-arithmetic solver or
an engineering tolerance/accuracy guarantee.

A closed shell fully inside another shell can have a positive surface gap even
though their solid interiors overlap. No inside/outside, penetration-depth or
solid-collision verdict is produced. Zero means represented surface contact or
intersection, not a valid fit. No topology, material thickness, manufacturing
allowance, physical clearance, safety or fabrication authority is inferred.
`physical_authority` remains false. This local geometry computation uses no
Blender and does not qualify a live backend, graphical browser or release.

## Verification

```sh
node --test adapter/reference-separation.test.mjs adapter/reference-separation-ui.test.mjs
node --test --test-concurrency=1 adapter/reference-*.test.mjs
```

Tests cover literal interior/crossing geometry, coplanar/touching and skew cases,
degenerate rejection, nested shells, mixed units, transforms, a tiny positive gap,
orphan vertices, STL/PLY/GLB, deterministic identity, budget refusal, real CLI and
loopback HTTP, plus production workbench handlers with DOM/canvas doubles. These
are computation/handler tests, not real-browser rendering or physical proof.

Supports PRD MM-W01/MOONMOLD-B02 derived representation truth and MM-W04 exact
revision inspection. It does not complete named review, client acceptance or
other broader PRD workflows.
