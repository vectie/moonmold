# Local OBJ and STL reference workbench

For selecting one or several named objects/groups inside a single OBJ, preserving
source bytes and reusing selected geometry, see [Named OBJ parts](REFERENCE_PARTS.md).

For X/Y/Z plane inspection of the placed mesh and SVG/CSV/JSON section downloads,
see [Reference cross-sections](REFERENCE_SECTIONS.md).

MoonMold can now open existing geometry without first rebuilding it from boxes
or cylinders. This is a geometry-only reference workflow, separate from semantic
scene execution, immutable delivery reviews and Blender qualification.

Start the existing operator (`npm run operator -- --workspace /path/to/workspace`)
and open `http://127.0.0.1:4193/reference-mesh`. Choose a local OBJ or STL and explicitly
select its units. The page shows dimensions and bounds in millimetres, source
SHA-256, triangle count and omitted styling. Download editable geometry JSON,
normalised OBJ or ASCII STL. Input and results stay in memory until downloaded;
the import does not change the retained scene or call a provider.

For command-line conversion, from the repository:

```
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron.obj --units cm
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron.obj --units cm --format stl --output tetrahedron.stl
```

The fixture is synthetic and produces dimensions 20 × 30 × 40 mm with four
triangles. `--format` accepts `json` (default), `obj` and `stl`; omit `--output`
to print to stdout. An output file must be new. `--name` optionally names the
reference and STL solid, defaulting to `reference`.

The fixed `POST /api/reference-mesh/import` endpoint accepts OBJ by default:
`{"text":"OBJ contents", "units":"cm", "name":"reference"}` and returns
`moonmold.reference-mesh.v1` with zero-based vertices/triangles, bounds, source
digest and both text exports. Explicit units: `mm`, `cm`, `m`, `in`.

Supported OBJ input: vertices, faces, positive and negative indices, texture /
normal index syntax, comments and common grouping/material directives. Convex
planar polygons are triangulated with winding retained. Unsupported directives,
non-planar/concave/collinear polygons, missing indices and degenerate faces fail
with a line number; triangulate those polygons in your source editor first.
Only previously declared indices are supported. Input is limited to 400000 bytes
and 64 vertices per face. Coordinates are normalised to millimetres, retaining
the source coordinate frame (no axis conversion).

Materials, textures, vertex normals and smoothing are omitted and
reported in `losses`; external material files are never loaded. ASCII STL has no
unit metadata: the exported numbers are millimetres. No watertightness, manifold,
self-intersection across faces, structural or physical suitability assessment is
performed. Export is reference data, never manufacturing authority. Existing
semantic operation schemas are unchanged.

Focused verification: `node --test adapter/reference-mesh.test.mjs`. This includes
real local-file CLI and loopback HTTP requests; it does not claim browser-render,
Blender, native MoonBit adapter execution or manufacturing qualification.

## Bring an STL into the workbench

Open a `.stl` file from a modeling application, choose the exporter's source units,
then use the same orbit, scale, rotate, place, reset and download controls. Both
ASCII and binary STL input are accepted. Neither carries reliable unit metadata;
the chosen units are mandatory and no units or axes are inferred from the filename,
header or shape. The status shows detected encoding and source units. Binary input
is kept as raw bytes and its SHA-256 is over those exact bytes, including its header.

The two supplied synthetic STL fixtures represent the same 2 × 3 × 4 cm
tetrahedron as the OBJ fixture. Use `cm` for these samples. To place a binary
STL and convert it into editable OBJ geometry:

```
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron-binary.stl --units cm --transform fixtures/reference-placement.json --format obj --output placed-from-stl.obj
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron-ascii.stl --units cm --format json --output stl-reference.json
```

The CLI selects STL for a `.stl` extension (case-insensitive), otherwise OBJ.
`--input-format stl` or `--input-format obj` overrides that selection for files
with another extension. Output `--format stl` always produces **ASCII STL in
millimetres**, including when the input was binary. Binary STL output, original
file-byte round-tripping and material/color retention are not supported.
OBJ and STL downloads contain the last successful geometry edit. JSON additionally
retains source format, detected STL encoding, supplied units, digest, losses and,
when using the workbench or a transform recipe, original bounds and that recipe.

HTTP import and transform use the existing fixed endpoints. For ASCII text send
`{"input_format":"stl","text":"solid ...","units":"cm"}`. For either
STL encoding send `{"input_format":"stl","data_base64":"...","units":"cm"}`
with canonical standard base64 of the original file bytes. Supply exactly one of
`text` or `data_base64`. Optional `name` and `transform` work as for OBJ.
No URL, file path, external material or executable directive is followed.

STL support is deliberately bounded:
- At most 400000 decoded bytes. Reference endpoints allow 600000-byte JSON bodies
  to accommodate base64; other operator endpoints retain their existing limit.
- Binary STL uses an 80-byte header, little-endian triangle count and exactly
  50 bytes per triangle. The total byte count must match; a `solid` header does
  not force a binary file to be interpreted as text. Extra trailing data fails.
- ASCII STL uses one `solid`/`endsolid` pair, lowercase standard keywords,
  one record per line, three vertices per facet, decimal/scientific numbers,
  optional blank lines, LF/CRLF and an optional UTF-8 BOM. Names must use ASCII;
  an omitted closing name is accepted, while a supplied closing name must match.
  Multi-solid files must be split in the source editor first.
- Coordinates are converted into millimetres within ±1e9 mm. Missing, malformed,
  non-finite or degenerate triangles fail with a line/facet error.
- Exactly equal coordinates share a vertex index. This reconstructs connectivity
  from coordinates and may join coincident but separately intended surfaces.
  Nearby vertices are never tolerance-welded; triangle order and winding remain.
- Supplied normals are omitted and export normals are recalculated from winding.
  ASCII solid names, binary headers and nonzero binary attributes (including
  possible colors) are omitted and listed in losses. Binary normal bytes are
  ignored; they never override the actual triangle coordinates.

This imports reference geometry only. There is no geometry repair, winding
correction, manifold/watertight/self-intersection check, manufacturing validation
or physical execution. Keep the original STL with its units and transform recipe
for reproducibility; reloading the page discards its in-memory session.

Focused STL verification:
`node --test adapter/reference-stl.test.mjs adapter/reference-mesh.test.mjs adapter/reference-workbench.test.mjs`.
Tests exercise real CLI files and loopback HTTP plus served-page JavaScript in a
DOM/canvas test double; they do not qualify real-browser rendering or Blender.

## Edit and explore a reference

The same `/reference-mesh` page is now a wireframe workbench. Import an OBJ or STL with
explicit units, drag the preview to orbit (or use keyboard-accessible yaw and
elevation sliders), and use Front/Top/Isometric views. The orthographic wireframe
shows hidden edges too; it is a shape/placement aid, not a shaded CAD viewport.
The preview auto-fits after each edit, so inspect the numeric dimensions for size.

Apply a positive uniform scale, X/Y/Z rotations in degrees, and movement in mm.
“Center X/Y and place lowest Z on ground” is useful for placing imported assets.
The order is scale, rotate X then Y then Z around the original coordinate origin,
optional bounding-box XY centering and minimum-Z grounding, then translation.
Each apply starts from the original mesh, so adjusting a value does not compound
prior edits. Reset returns the original geometry. View orbit never changes export.

“Set scale to fit” computes a uniform scale for the requested longest dimension
using the last successfully applied orientation. Click Apply edits with that same
orientation for an exact fit. This does not distort the shape. Rotating afterward
can change the axis-aligned bounding dimensions. Values are applied explicitly;
downloads always contain the last successful edit, not unapplied form values.

Download JSON to keep the source digest, original bounds and transform recipe
alongside edited vertices; OBJ/STL contain transformed millimetre geometry only.
OBJ mesh JSON additionally retains exact UTF-8 source text, original units and any
named-part selection in `source`. The separate reusable source JSON can be reopened
in the workbench or CLI; placement is kept separately in the mesh report. STL/PLY
original source data remains in page memory for reset. Reload loses the in-memory
session. Keep downloads and any placement recipe for reproducibility.
No scene, engineering representation or source file is overwritten.

Reproduce the synthetic placement sample from the command line:

```
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron.obj --units cm --transform fixtures/reference-placement.json --format obj --output placed.obj
```

The sample applies scale 2, X rotation 90°, centering/grounding, and translation
[100,50,0] mm. Result: approximately 40×80×60 mm, bounds [80,10,0] to
[120,90,60]. Tiny floating-point differences are expected for trigonometric angles.
`--transform` reads a JSON recipe with optional `scale` (default 1),
`rotation_deg` (default [0,0,0]), `center_and_ground` (default false), and
`translation_mm` (default [0,0,0]). The fixed HTTP endpoint
`POST /api/reference-mesh/transform` takes the same import fields and a `transform`
object. It returns the existing reference contract plus `source_bounds`,
`transform`, and `transform_order`. Scale is bounded to 0.000001–1000000;
coordinates retain the importer’s ±1e9 mm range. Mirroring/nonuniform distortion,
vertex-level editing, booleans, topology repairs, assemblies, and engineering
validation are outside this workflow. Source coordinate axes are retained;
Z grounding is explicit, not inferred from input conventions.

Verification: `node --test adapter/reference-mesh.test.mjs adapter/reference-workbench.test.mjs`.

ASCII and little-/big-endian binary PLY 1.0 triangle references are also supported; see [PLY intake and limits](REFERENCE_PLY.md).
