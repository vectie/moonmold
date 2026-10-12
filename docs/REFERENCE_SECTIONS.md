# Inspect a cross-section of an imported reference

For reusable CAD linework with millimetre coordinates and per-instance layers,
see [DXF section export](REFERENCE_SECTION_DXF.md).

Use this to inspect the width or shape at a selected height or depth of an OBJ
or STL after placing it. The result is finite triangle-intersection segments,
with numeric millimetre endpoints, an annotated SVG and exact input identities.
It is digital reference inspection, not a solid-model or fabrication operation.

## Workbench

Start the existing operator:

```
npm run operator -- --workspace /path/to/workspace
```

Open `http://127.0.0.1:4193/reference-mesh`.

1. Import an OBJ or STL and explicitly choose the source units.
2. Apply any scale, rotation, centering/grounding or translation first.
3. In **Cross-section of the last applied mesh**, select X, Y or Z as the plane
   normal and enter its position in **millimetres**. For example, Z = 10 is the
   horizontal plane at transformed Z coordinate 10 mm. **Use mesh midpoint**
   fills the selected axis's transformed bounding-box midpoint.
4. Click **Calculate section**. Read the segment count, projected dimensions,
   point contacts and omitted coplanar triangle count. The preview includes
   the source, transformed mesh and section identities.
5. Download section DXF, SVG, CSV or JSON. These are separate from the original
   reference mesh's JSON/OBJ/STL downloads.

Unapplied placement form values do not affect a section. Changing the selected
plane does not change the last calculated output until Calculate is pressed.
A successful import, edit or reset removes the previous section and its downloads;
calculate again against the new geometry. A failed request leaves the last
successful geometry and section intact. Only one request is active at a time.
The session stays in page memory and is lost on reload; keep the original file,
its declared units, transform recipe and downloaded results.

## CLI

Both section options are required. Existing mesh conversion without these
options is unchanged. `--format` for sections accepts `json` (default), `svg`
`csv` or `dxf`. Omit `--output` to use stdout; file outputs must be new.

```
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-section-cube.obj --units mm --section-axis z --section-position-mm 10 --format svg --output cube-z10.svg
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-section-cube.obj --units mm --section-axis z --section-position-mm 10 --format csv --output cube-z10.csv
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-section-cube.obj --units mm --section-axis z --section-position-mm 10 --format json --output cube-z10.json
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron-binary.stl --units cm --transform fixtures/reference-placement.json --section-axis z --section-position-mm 30 --format json --output placed-tetra-z30.json
```

The synthetic cube spans [0,0,0] to [20,20,20] mm. Any midpoint axis section
has 20×20 mm projected spans and eight finite segments with a total length of
80 mm. The eight segments come from the triangulated side faces. They are not
automatically simplified to four edges or joined into a closed contour.

The supplied tetrahedron is 20×30×40 mm when imported as cm. At Z = 20, its
three segments span 10×15 mm, with length sum `25 + sqrt(325)` mm. At Z = 40,
the apex is one point contact and no segment. With the supplied placement
recipe applied, Z = 30 gives projected X bounds [80,100] and Y bounds [50,90]
mm, subject to ordinary floating-point rotation error.

## HTTP

`POST /api/reference-mesh/section` accepts the existing import fields, optional
`transform`, and `section: { "axis": "z", "position_mm": 10 }`. Axis is
lowercase `x`, `y` or `z`; position must be a finite number within ±1e9 mm.
Original OBJ/STL input is re-imported and the transform is evaluated from it,
using the existing scale → X/Y/Z rotations → center/ground → translate order.
No client-supplied vertices or claimed mesh digest are trusted as geometry.
The reference endpoints retain the existing 600000-byte JSON-body limit and
400000-byte decoded source limit. No file URL or provider is fetched.

## What is in the outputs

- **JSON**: `moonmold.reference-section.v1`. Source format, optional STL encoding,
  declared source units, mm output units, normalized transform, plane and
  projection axes, tolerance, policies, diagnostics, bounds, independent
  segments and point contacts. Triangle IDs are zero-based positions in the
  imported triangulated mesh. Each segment has 3D endpoints, projected 2D
  endpoints, length and contributing triangle IDs. SVG/CSV text is also included.
- **CSV**: a normal header followed by one `record_type=metadata` row and one
  `record_type=segment` row per segment. Filter to segment rows for numeric
  analysis. Endpoints and lengths use the full JavaScript number representation
  in mm; fields use CSV quoting and CRLF. Metadata survives empty sections.
  Each row carries source/transform/mesh/section identity and the transform JSON.
  Metadata includes point-contact and coplanar counts; individual point contacts
  are in JSON, not the segment table.
- **SVG**: an auto-fitted, equal-aspect annotated diagram. The first projected
  coordinate increases right and the second increases up. X sections project
  Y/Z, Y sections X/Z, and Z sections X/Y. Orange dots indicate point contacts.
  Dimensions, units and identity are visible; complete structured section data
  is embedded in escaped XML metadata. It is not a physical-size print template.
  Labels use nine significant digits; JSON/CSV retain numeric precision.

SHA-256 fields are lowercase hex without a prefix:

- `source_sha256`: exact original OBJ UTF-8 or STL bytes, unchanged by placement.
- `transform_sha256`: canonical JSON of the normalized transform recipe.
- `transformed_mesh_sha256`: canonical JSON of `{units,vertices,triangles}` for
  the final mm mesh used for the intersection.
- `section_sha256`: canonical JSON of the section record before adding
  `section_sha256` itself and `exports`. Canonical JSON recursively sorts object
  keys and retains array order, using the existing adapter `canonicalJson`.

These identify the observations and input bytes. They are not acceptance,
engineering-validation or manufacturing certificates.

## Geometry and precision limits

- Plane positions refer to **transformed source axes**. No up-axis convention
  or external engineering coordinate frame is inferred.
- Vertices within the reported `tolerance_mm` of the plane are treated as on
  the plane and snapped to its coordinate in the result. Tolerance is the maximum
  of 1e-12 mm, the transformed bounding span along the normal × 1e-10, and
  `16 × Number.EPSILON × max(abs(position), abs(axis min), abs(axis max))`.
  Near-plane features thinner than this tolerance may therefore be classified
  as coplanar or point contact. No exact-arithmetic intersection is claimed.
- A triangle with all three vertices on the plane is counted as coplanar and
  omitted. Its perimeter and interior are not inferred. On-plane edges of
  neighboring noncoplanar triangles can still appear. Thus a cube boundary
  plane can show its four outer edges, while a fully planar isolated triangle
  produces `coplanar-only`, zero segments and no section bounds.
- Exactly coincident endpoint pairs are merged with their triangle IDs retained.
  No approximate welding, contour ordering/joining, gap filling, partial-overlap
  removal or solid repair occurs. Point-touching triangles are recorded
  separately; their contacts can coincide with another segment's endpoints.
- Bounds include segment endpoints and point contacts. Segment-length sum is
  a sum of the emitted independent segments, **not a guaranteed perimeter**.
  Overlapping geometry may contribute overlapping segments. No area, volume,
  manifoldness, watertightness or closed-contour claim is made.
- Sections outside the mesh have status `empty`, zero segments, null bounds,
  an explanatory SVG and a metadata-only CSV. Tangency can instead yield points
  or on-plane edges. These cases are useful results, not failed imports.
- Original source losses are retained. This path does not modify the semantic
  scene, execute Blender, accept a digital package, or authorize any machine.

Focused checks:

```
node --test adapter/reference-section.test.mjs adapter/reference-mesh.test.mjs adapter/reference-workbench.test.mjs adapter/reference-stl.test.mjs
```

Coverage includes actual file CLI operations, loopback HTTP and the served
JavaScript module in a DOM/canvas test double. It does not qualify actual-browser
rendering, the separate MoonBit UI, native semantic adapters or physical use.
