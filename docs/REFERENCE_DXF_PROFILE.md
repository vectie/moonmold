# Turn a saved DXF outline into an editable 3D reference

Open a drawing rather than retyping its coordinate list. MoonMold can inspect a
bounded ASCII DXF, select one straight closed model-space LWPOLYLINE, and create
an editable profile and capped reference mesh. The workflow uses Node only and
the existing [profile extrusion](REFERENCE_PROFILE_EXTRUSION.md) engine.

Import still selects one outer outline and replaces the current profile,
including any previous cutout. After import, add one interior opening with the
[v2 cutout editor](REFERENCE_PROFILE_CUTOUTS.md). DXF multi-outline/hole inference
is not supported; other drawing entities remain explicitly omitted.

## Operator journey

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

1. Open `http://127.0.0.1:4193/reference-profile`. Under **Start from a CAD
   drawing**, choose `fixtures/reference-outlines.dxf` and **Inspect drawing
   outlines**. It contains two polylines and one omitted guide line.
2. Select entity 1, layer STEPPED. Set the name, units **mm** and height **8**
   in the profile fields. Click **Import selected outline and build**. The
   concave reference measures 40 × 30 × 8 mm, with 12 vertices, 20 triangles
   and a profile area of 700 mm². Nothing contacts a CAD app or provider.
3. Edit the imported points or height, then use **Build reference mesh**. The
   normal profile editor remains available; height 12 produces 40 × 30 × 12 mm.
   Subsequent edits are a new derivative and no longer carry the earlier DXF
   import report. Save that report before changing the recipe if you need it.
4. Alternatively select entity 3, layer TRIANGLE, set units **cm** and height
   **2**, then import again: bounds become 200 × 200 × 20 mm. Header unit hints
   do not override your choice. Units reinterpret both XY and height numbers.
5. Save the editable profile and reopen it on this page. Save the derived layout
   and open it at `/reference-layout` to move it among other references. OBJ,
   STL, profile lineage and original DXF import reports are also available.

Inspection changes only the candidate list. Failed inspection/import/build
leaves the last successful geometry, fields and downloads intact. Changing the
drawing clears the old candidate list; a new inspection is required. In-flight
submissions are single-flight, and replies from an older draft/file selection
cannot overwrite a newer one. Canvas preview is an auto-fit wireframe, including
hidden edges. No file is persisted until you download it.

## CLI and API

```sh
node bin/moonmold-reference-dxf.mjs --input fixtures/reference-outlines.dxf
node bin/moonmold-reference-dxf.mjs --input fixtures/reference-outlines.dxf --entity 1 --units mm --height 8 --name stepped --format recipe --output new.profile.json
node bin/moonmold-reference-dxf.mjs --input fixtures/reference-outlines.dxf --entity 3 --units cm --height 2 --name triangle --format layout --output new.layout.json
```

Default format `inventory` takes no build options. Other formats are `recipe`,
`layout`, `obj`, `stl` and `json` (full geometry, exports and import/lineage
reports); every build requires explicit entity, units, height and name. Entity
indexes are one-based positions across **all** records in ENTITIES, including
unimported types; they are not stable across drawing edits. Layer/handle/line
labels help inspect the choice but never replace exact source identity.

Output paths must be new; existing files are never overwritten. Omit `--output`
for stdout, but never redirect onto an input file because the shell truncates
that path before the reader starts. Errors exit nonzero and write stderr.

- `inspectReferenceDxf({text})` and `POST /api/reference-profile/dxf-inspect`
  return `moonmold.reference-dxf-inventory.v1` with candidate reasons/counts.
- `importReferenceDxfProfile({text,entity,units,height,name})` and
  `POST /api/reference-profile/dxf-import` return the existing extrusion result
  plus `moonmold.reference-dxf-profile-import.v1` in `dxf_import`.
- Unknown request fields reject. Decoded DXF text is at most 400000 UTF-8 bytes;
  HTTP JSON bodies are at most 850000 bytes to allow escaped line breaks.

## Supported drawing subset and losses

ASCII DXF code/value line pairs, LF or CRLF, complete named sections, exactly
one ENTITIES section and a final EOF are required. Maximum 20000 pairs and 1000
entities. The original text bytes are hashed, so CRLF/LF variants have different
source identities even if their geometry is identical. Binary/non-ASCII DXF
and malformed section structure reject; there is no encoding guessing.

Supported selected outlines have:

- LWPOLYLINE count group 90 matching 3–128 complete XY vertices (groups 10/20)
- Closed flags 1 or 129 (closed plus optional continuous linetype pattern)
- Model-space flag 67 absent/zero; layout 410 absent/Model
- Elevation 38, thickness 39, widths 40/41/43 and bulges 42 absent or zero
- Normal 210/220/230 absent or the default (0,0,1)
- Common identity/display metadata, subclass markers and optional vertex IDs

Unknown selected-polyline extensions, curves, holes, nondefault OCS, repeated
closing vertices, collinear corners and self-intersections are not repaired or
flattened. The existing extrusion validator checks finite coordinates, unit
bounds, simple geometry and triangulation; inventory's `supported` means only
the entity syntax fits the subset. It is not a build/engineering guarantee.
Only one ring is selected: other outlines do not become holes or joined solids.

Nonselected entities are counted and omitted. HEADER, BLOCKS, TABLES and other
sections are reported as omitted, never evaluated. INSERT instances, xrefs,
constraints, display styling, unit hints and external filenames are not
followed. A layer name is retained as a label, not a semantic material or role.
The entity codes follow Autodesk's
[LWPOLYLINE reference](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm).

The import report binds original source SHA-256, selected index/line/layer,
explicit units, recipe SHA-256 and derived geometry/layout hashes, plus omissions.
Keep the original DXF, report and editable recipe together for source correlation.
Profile JSON is an editable derivative, not a drawing archive; edited/reopened
profiles do not claim original DXF identity. Mesh/layout exports lose editable
profile intent unless the profile is retained separately.

This is bounded digital reference authoring. It does not qualify a particular
CAD exporter, general CAD, dimensional tolerance, live Blender, material
behavior, manufacturing suitability or physical authority.

## Validation

`node --test adapter/reference-dxf-profile.test.mjs adapter/reference-extrusion-ui.test.mjs adapter/reference-extrusion.test.mjs`

Tests exercise real CLI output/overwrite refusal, real loopback HTTP, geometric
bounds and volume, derivative reopen, selected/nonselected unsupported shapes,
resource limits and production UI handlers using DOM/canvas doubles. Graphical
browser rendering and interoperability with an external CAD application are
unrun. `scripts/verify_dxf_workflow.mbtx` creates a compact repeatable sample
journey with a revised/reopened profile; it takes the source root and a new
output directory as arguments.
