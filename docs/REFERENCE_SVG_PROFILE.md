# Import an SVG outline into an editable 3D reference

MoonMold reads one bounded polygon, explicitly closed polyline, unrounded
rectangle, circle, ellipse, or single absolute M/L/Q/C/Z closed path from an SVG.
Optionally select a second, distinct straight-edged outline as an interior
opening. Both selections must then be polygons, explicitly closed polylines
or unrounded rectangles; curved outlines and paths remain single-outline imports.
Paths, circles and ellipses require an explicit error
limit and become editable straight segments, preserving the original curves.
It uses the existing Node profile extrusion engine to produce an editable
recipe, capped mesh, layout, OBJ and STL. Import does not render the drawing,
run its content, access external resources or invoke Blender.

## Operator journey

Start the existing operator server and open `/reference-profile`:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

1. Under **Start from an SVG outline**, load `fixtures/reference-outlines.svg`
   and choose **Inspect SVG outlines**. The inventory includes the stepped
   polygon, a closed triangle polyline, a disabled open guide, and a quadratic
   path that requires an explicit maximum error before import.
2. Select element **4**, `stepped`. Enter scale **1** (selected units per SVG
   user-space coordinate), explicitly choose **SVG Y down → model Y up**, and
   set the editor name, units **mm**, and height **8**. Import the selected SVG.
3. Inspect the 40 × 30 × 8 mm mesh: 12 vertices, 20 triangles, profile area
   700 mm². Coordinates run from (0, −30, 0) to (40, 0, 8); the origin is kept.
   Save the **SVG source and import record**, **original SVG**, **editable
   profile**, and any derived siblings needed for the handoff.
4. Double each outer X coordinate, change height to **12**, and build again.
   Bounds become 80 × 30 × 12 mm, area 1400 mm² and shell volume 16800 mm³.
   The new recipe and geometry have new hashes. The earlier SVG import record
   is deliberately not attached to edited or reopened recipes.
5. Save the new profile, reopen it using **Reopen an editable profile**, and
   inspect the rebuilt mesh. Open its saved layout in `/reference-layout` to
   place it among other references or measure its digital geometry.

To import the other closed outline, choose element **5**, `triangle`. With
units **cm**, scale **0.1**, height **2**, bounds are 20 × 20 × 20 mm at
(50, −20, 0) through (70, 0, 20). Height is already in the selected units; the
SVG scale multiplies only the source XY coordinates, never height.

### Explicit outer outline and opening

Inspect `fixtures/reference-opening.svg`. Choose element **2**, `plate`, as
the outer outline and explicitly select element **3**, `opening`, in the
optional opening selector. The selector always starts at **No opening** after
inspection. Choose units **mm**, scale **1**, the Y-down-to-Y-up convention and
height **8**. Import builds a 40 × 30 × 8 mm plate at X=10..50, Y=−50..−20,
with a 20 × 10 mm through-opening. Net area is 1000 mm² and volume 8000 mm³.
The deliberately different viewport hints do not move or rescale either ring.

Save the original SVG, v4 import record and editable v2 profile. Both selected
element indices, IDs, types, original points and closing-endpoint handling are
retained. Element **4** is an alternative unrounded-rectangle opening; choosing
it changes the opening rather than inferring an additional hole.

The imported opening populates the existing cutout editor. Change its points
to `[[22,-30],[38,-30],[38,-40],[22,-40]]` and height to **12**. Build, save the
new profile and reopen it in a fresh profile workbench: net area is 1040 mm²
and volume 12480 mm³. Keep the earlier import record separately; edited recipes
do not claim its source attestation. Failed or stale imports keep the last
successful model and downloads. Selecting **No opening** imports a single-ring
v1 profile and explicitly replaces any existing opening.

No selection is inferred from fill rules, winding, nesting, IDs or proximity.
Both rings use exactly the same scale, units and Y reflection. Each may have
either winding, but the opening must be strictly contained with no touching,
crossing or numerically ambiguous edges. The existing v2 extrusion validator
checks both rings and their relationship. Multiple openings, nested islands,
rounded rectangles and path/curve pairs are outside this import scope.

### Curved outline journey

Inspect `fixtures/reference-curved-outline.svg`, select element **2**, and set
units **mm**, scale **1**, convention **SVG Y down → model Y up**, maximum path
error **0.25** and height **8**. The quadratic right edge and cubic upper edge
produce a 45 × 39 × 8 mm reference. The status reports the point count and
0.25 mm approximation limit. Save the SVG import record, original and editable
profile before editing. Change the first point X to **−2**, change height to
**12**, build/save, and reopen the profile or layout: bounds are 47 × 39 × 12 mm.
The edited result is a new point recipe, not an edited SVG curve.

The tolerance is in the selected units, after SVG scaling, before the Y
reflection. For the same geometric limit with units **cm**, use scale **0.1**,
error **0.025**, and height **0.8**. No tolerance is inferred from viewBox, stroke
width, UI resolution or a manufacturing requirement. Smaller errors may exceed
the 128-point limit and reject; they are never relaxed automatically.

Inspection does not change the current model. Failed builds leave the last
successful fields, preview and downloads available. File changes require new
inspection, duplicate submissions are single-flight, and changed choices or
draft fields invalidate an older pending reply. The preview remains an
auto-fit wireframe including hidden edges. Save before leaving the page.

## Explicit coordinate contract

`units_per_svg_unit` is a positive number of `mm`, `cm`, `m` or `in` per raw
SVG user-space coordinate. It is required, with no implicit pixel/DPI rule.
`coordinate_convention` must be `svg-y-down-to-xy-y-up`. For every source point:

- recipe X = SVG X × units_per_svg_unit
- recipe Y = −SVG Y × units_per_svg_unit
- recipe Z = 0; extrusion goes toward +Z
- height uses recipe units; exported mesh/layout positions use millimetres

The root width, height, viewBox and preserveAspectRatio are retained as hints
for review. They never change the coordinates or choose the scale. This is a
raw-user-space import, not a viewport rendering. There is no centering or
translation to the viewBox origin. Changing units reinterprets the supplied
numbers; choose units and scale together.

## CLI and API

```sh
node bin/moonmold-reference-svg.mjs --input fixtures/reference-outlines.svg
node bin/moonmold-reference-svg.mjs --input fixtures/reference-outlines.svg --element 4 --units mm --units-per-svg-unit 1 --coordinate-convention svg-y-down-to-xy-y-up --height 8 --name svg-outline --format import --output new.svg-import.json
node bin/moonmold-reference-svg.mjs --input fixtures/reference-outlines.svg --element 4 --units mm --units-per-svg-unit 1 --coordinate-convention svg-y-down-to-xy-y-up --height 8 --name svg-outline --format recipe --output new.profile.json
node bin/moonmold-reference-extrude.mjs --input new.profile.json --format layout --output new.layout.json
node bin/moonmold-reference-svg.mjs --input fixtures/reference-curved-outline.svg --element 2 --units mm --units-per-svg-unit 1 --coordinate-convention svg-y-down-to-xy-y-up --max-error 0.25 --height 8 --name curved-outline --format import --output new.curved-import.json
node bin/moonmold-reference-svg.mjs --input fixtures/reference-opening.svg --element 2 --opening-element 3 --units mm --units-per-svg-unit 1 --coordinate-convention svg-y-down-to-xy-y-up --height 8 --name svg-opening --format recipe --output new.opening.profile.json
node bin/moonmold-reference-svg.mjs --input fixtures/reference-opening.svg --element 2 --opening-element 3 --units mm --units-per-svg-unit 1 --coordinate-convention svg-y-down-to-xy-y-up --height 8 --name svg-opening --format import --output new.opening.import.json
```

Default `inventory` format takes no build choices. Build formats are `recipe`,
`layout`, `obj`, `stl`, `import` (the standalone source/selection/recipe record)
and `json` (the complete extrusion result plus import record). Every import
requires all selection, scale, convention, unit, name and height choices.
Paths, circles and ellipses additionally require `--max-error`; omit it for
polygon/polyline/rectangle imports.
Output files use exclusive creation: choose new paths. Never redirect stdout
onto an input path, because the shell could truncate the input before reading.

- `inspectReferenceSvg({text})` or POST `/api/reference-profile/svg-inspect`
  returns `moonmold.reference-svg-inventory.v2`. Path candidates declare
  `requires_tolerance: true`, a source segment count, and no precomputed vertex
  count. Syntax/context support is not a promise that a chosen tolerance builds.
- `importReferenceSvgProfile({text,element,opening_element?,units,units_per_svg_unit,
  coordinate_convention,height,name,max_error?})` or POST
  `/api/reference-profile/svg-import` returns the normal extrusion result plus
  `svg_import`. Polygon/polyline retain `moonmold.reference-svg-profile-import.v1`;
  paths use `moonmold.reference-svg-profile-import.v2`, with original path data,
  approximation details and a separate approximation SHA-256.
- Supplying the optional `opening_element` (CLI `--opening-element`) requires
  a distinct positive XML element index. Omit the property for no opening;
  null, duplicate, missing or unsupported indices reject. A two-ring import
  uses `moonmold.reference-svg-profile-import.v4`; the outer identity remains
  in `element_index`, `element_id`, `element_type`, `source_points` and optional
  `source_basic_shape`, and the same opening-specific fields appear in `opening`.
  The import record binds the exact original SVG bytes to both explicit
  selections and the initial v2 recipe/geometry/layout hashes. Omitted drawing
  count excludes both selected elements. No `max_error` applies to these rings.
- `element` is the one-based index of the XML start element across the entire
  document, including the root, titles and groups. Use the inventory's index.
  Indices and IDs are labels, not identity across changed source files.
- The recipe is the existing `moonmold.reference-profile-extrusion.v1` contract
  for one selection or `moonmold.reference-profile-extrusion.v2` with `cutout`
  for two explicit straight-edge selections.
  No new extrusion or mesh contract is introduced.

## Supported subset and clear limitations

Inputs are UTF-8 XML up to 400000 bytes, one root SVG, at most 1000 elements and
32 nested levels. A UTF-8 BOM, XML 1.0 declaration, comments, either attribute
quote style, predefined/numeric entities, decimal/exponent coordinate values,
and comma/whitespace point separators are supported. Selected outlines have
3–128 vertices after removing exactly one repeated closing endpoint. Polygon
closure is implicit by SVG definition; polyline closure must be explicit.

Simple `g` ancestors and basic identity/display attributes are accepted.
Transforms, CSS/style/class, clipping, masks and unknown attributes on the
selected outline or ancestors make it unsupported. Definition/symbol/clip/mask
contents cannot be selected. Nested viewports, scripts, event handlers,
stylesheets, DTDs, CDATA, processing instructions and unknown XML elements
reject with diagnostics. This is a declared small SVG subset, not a universal
XML/SVG interchange parser or qualification of any particular drawing app.

Lines, text, images and uses can be counted as omitted drawing elements,
but are never converted or fetched. Inventory's
`supported` means the outline syntax and context fit; it does not certify a
valid ring. The existing extrusion validator rejects self-intersections,
touching/duplicate vertices, collinear corners and numerically ambiguous
geometry. Its size, height and numeric bounds still apply.

### Basic shapes into editable profiles

Inspect `fixtures/reference-basic-shapes.svg`. With mm, scale 1 and height 5:
element 2 is a 40 × 20 × 5 rectangle at X=5..45, Y=−30..−10; element 3 is a
20 × 20 × 5 disc; element 4 is a 40 × 16 × 5 oval. Set curve error 0.1 for the
disc or oval. Save the original SVG, import record and editable profile. Change
height to 12 and translate the profile points; build/save and reopen the profile
or derived layout through the existing workbench. The original import record
remains the initial revision, not an attestation of the edited points.

Rectangles require positive numeric width/height; x/y default to 0. Rounded
rectangles reject (rx/ry must be absent or zero). Circles require positive r;
ellipses require positive rx and ry; cx/cy default to 0. Decimal/exponent values
are accepted, but coordinate units such as `10px`, percentages and CSS lengths
reject. Geometry is the raw outline; fill and stroke do not change it.

Circle/ellipse flattening uses a deterministic inscribed equal-angle polygon,
in multiples of four from 4 to 128 vertices, retaining exact cardinal extrema.
For N segments, max(scaled radii) × (1 − cos(π/N)) bounds distance from the
ellipse to each chord; a binary64 guard is added. The smallest allowed N meeting
the explicit error is used. Error is in selected units after scaling; it must
convert to 0.000001..1000000 mm. Coordinates must stay within ±1000000 mm.
Over-budget, underflowing, degenerate and numerically ambiguous geometry rejects
without relaxing the limit. The point recipe has no editable analytic radius
or center handles. Polygon area/volume underestimate the analytic ellipse.

Basic shapes use `moonmold.reference-svg-profile-import.v3` and retain normalized
`source_basic_shape`, exact source bytes, initial recipe and distinct hashes.
Curved basics also retain `approximation`, its SHA-256, units, numerical guard,
maximum accepted bound and derived vertices. Rectangles have no approximation
record. Existing polygon/polyline v1, path v2 and inventory v2 remain compatible.

```sh
node bin/moonmold-reference-svg.mjs --input fixtures/reference-basic-shapes.svg --element 3 --units mm --units-per-svg-unit 1 --coordinate-convention svg-y-down-to-xy-y-up --max-error 0.1 --height 5 --name disc --format recipe --output new.disc.profile.json
node bin/moonmold-reference-extrude.mjs --input new.disc.profile.json --format layout --output new.disc.layout.json
```

### Bounded path parser and deterministic approximation

One absolute `M` starts the contour; `L`, quadratic `Q`, cubic `C`, and final
explicit `Z` are supported. Repeated parameter groups and implicit lines after
M follow SVG semantics. Comma/whitespace, signed decimals and exponents work.
Relative commands, H/V/S/T/A, multiple M/subpaths, implicit closure, malformed
or incomplete parameters, duplicate zero-length segments, underflow/overflow,
transforms and explicit fill-rule attributes on paths/ancestors reject.

Bounds: 100000 path characters, 4096 tokens, 512 source segments, 16 subdivision
levels and 128 output profile vertices. Control points, after scaling and unit
conversion, must lie within ±1000000 mm. `max_error` must be finite and between
0.000001 and 1000000 mm in the selected units. Numeric ambiguity rejects.

Quadratic/cubic curves use deterministic left-first De Casteljau subdivision
at t=0.5. A leaf is accepted only when its controls are monotone along its
endpoint chord and its maximum control-point distance to that finite chord,
plus a binary64 roundoff guard, fits the requested limit. The Bezier convex
hull then bounds deviation from the chord. The report retains the source
segment and parameter interval for every accepted segment, the maximum bound,
numeric guard, units, requested limit and exact approximated recipe vertices.

A conservative topology gate requires accepted control hulls to separate;
neighbouring hulls may share only the common endpoint. A small loop cannot be
silently hidden by choosing a coarse tolerance. Crossings, touching and near
contacts that this bounded test cannot distinguish reject; some valid curves
may therefore need an explicitly finer tolerance or a revised source. The
existing ring validator separately rejects invalid flattened profiles. This
is bounded binary64 approximation, not certified geometric/engineering
tolerance. No repair, simplification to meet bounds or automatic hole inference
is performed.

Path and curved-basic imports select only one ring. Other outlines do not
become holes or joins. Import replaces the current outer profile and cutout;
an opening can subsequently be edited through the existing v2 workflow. Styling,
stroke widths, external references and metadata do not become geometry.

## Source preservation and qualification

The import record contains exact original UTF-8 bytes as base64, SHA-256 and
byte length; selected type/index/ID; source points; closing-endpoint removal;
explicit conversion; retained viewport hints; original editable recipe and
recipe/geometry/layout SHA-256; omissions and declared losses. Decoding
`source.bytes` as base64 reconstructs the original input, including BOM and
line endings. The UI also offers those original bytes as an SVG download.
Path v2 records retain original `source_path`; `source_points` is null because
no original point polygon existed. Their `approximation` contains the derived
vertices, error/topology policy and parameter mapping. Its hash is independent
of original SVG bytes and the editable recipe, so changing tolerance or height
does not mislabel one identity as another. Flattened curves remain plain
editable points; curve parameter handles are available only in the original SVG.

Retain the original import record before editing. A modified profile is a new
editable revision; its OBJ/STL and layout are derived siblings, not substitutes
for the recipe. Reopened recipes do not claim the original import attestation.

Qualification is offline Node digital reference authoring only. Focused tests
exercise real CLI output and reopen, real loopback HTTP, bounded diagnostics,
source-byte identity, geometric bounds/volume, and production UI handlers with
DOM/canvas doubles. A graphical browser, MoonBit/native validation, full release
gates, third-party SVG interoperability and live Blender were not run. No
engineering tolerance, physical suitability or manufacturing authority is
established; inherited blocked or unrun release gates remain blocking.
