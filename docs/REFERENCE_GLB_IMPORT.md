# Bring a GLB scene into editable reference placements

Import a small static glTF 2.0 binary (`.glb`) scene from a compatible editor or
from MoonMold's GLB exporter. Each selected mesh node becomes an independently
editable reference in the existing layout workbench. Nested node transforms are
applied, original bytes are retained, and named placements can be moved, resized,
measured, sectioned, saved/reopened and exported again. No provider is involved.

This is bounded reference editing, not general CAD or reconstruction of an
editor's semantic scene. Original hierarchy/TRS is baked into reference vertices.
Layout scale/rotation/translation is an additional, repeatable placement from
those original vertices. Reset removes that additional placement; it does not
remove the GLB node's original world transform.

## Layout page

Start the operator and open the existing reference-layout page:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

At `http://127.0.0.1:4193/reference-layout`:

1. Under **Import a GLB scene as editable placements**, choose a `.glb` and click
   **Import GLB mesh nodes**. It appends each mesh node in the default scene.
   Existing applied placements remain. Duplicate names receive stable node-index
   suffixes; repeated imports receive additional collision-free suffixes.
2. Select one imported placement, edit it and click **Apply placement**. Other
   imported nodes remain in place. The status includes actual source SHA-256,
   fixed source units, omitted fields and transformed millimetre bounds.
3. Save **editable layout**, then reopen that file to continue editing, even
   without the original GLB on disk. The layout embeds the exact GLB bytes and
   the selected node index for each placement.
4. Download combined OBJ/STL or prepare GLB. These are derived geometry. Keep
   the editable layout for original bytes, node selections and placements.

A failed import leaves the previous layout, preview and downloads intact. A
scene that would exceed the layout's limits is rejected as a whole. Downloads
always represent applied placements. The page retains state only in memory.

The synthetic `fixtures/reference-scene.glb` contains two tetrahedron mesh nodes
under a rotated, nonuniformly scaled parent. One child is mirrored using a local
matrix. Initial dimensions are approximately 40 × 280 × 30 mm. Move only
`Mirrored_panel-node-2` by 500 mm on X to separate it from the other reference.

## CLI and fixed API

```sh
node bin/moonmold-reference-glb-import.mjs --input fixtures/reference-scene.glb --name imported-scene --output scene.layout.json
node bin/moonmold-reference-glb-import.mjs --input fixtures/reference-scene.glb --format json --output scene.report.json
node bin/moonmold-reference-glb-import.mjs --input fixtures/reference-scene.glb --nodes 2 --format obj --output selected-node.obj
node bin/moonmold-reference-layout.mjs --input scene.layout.json --format glb --output scene.glb
```

The import CLI defaults to editable `layout` output; `json`, `obj` and `stl` are
also supported. Omit `--output` for stdout. Output files must be new. `--nodes`
selects comma-separated zero-based mesh-node indices, not child subtrees or mesh
indices. Report `parts[].glb_nodes` includes indices, original names, mesh index,
world matrix, winding adjustment and geometry ranges. Selection order follows
scene traversal, not the order typed on the command line.

`POST /api/reference-layout/import-glb` takes:

```json
{"data_base64":"canonical standard base64 of the GLB bytes","name":"imported-scene","node_ids":[1,2]}
```

`name` and `node_ids` are optional. The result uses the existing
`moonmold.reference-layout-result.v1` contract with a saved
`moonmold.reference-layout.v1` document. This route creates no server-side files.
The page explicitly appends returned instances using the regular compose route;
the import API alone creates a new layout.

Existing mesh-import/transform/section APIs also accept `input_format: "glb"`,
`units: "m"`, `data_base64` and optional `node_ids`. Without selection they flatten
the default scene to one reference. `units: "m"` is mandatory because glTF defines
metres; contradictory or missing units are rejected. The single-reference CLI
accepts `.glb`, `--nodes` and reusable source output:

```sh
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-scene.glb --units m --nodes 1 --format source --output node.source.json
node bin/moonmold-reference-mesh.mjs --source node.source.json --format obj --output node.obj
```

The single-reference page's file chooser continues to accept OBJ/STL/PLY. Use the
layout page for interactive GLB intake.

## Frame, source identity and losses

Per the [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
node transformations are applied in hierarchy order. MoonMold then uses the
explicit mapping `[x,y,z] metres/Y-up -> [x,-z,y]*1000 millimetres/Z-up`. No units
are guessed from shape, filenames or `extras`. A negative world determinant
reverses triangle winding to follow glTF front-face semantics. Original float32
positions are read exactly into JavaScript doubles; transformation arithmetic has
ordinary floating-point rounding. Exporting to GLB rounds back to float32 and
uses the existing export loss report.

Every saved placement retains original bytes as canonical base64, actual byte
SHA-256, fixed source units and selected node indices. The digest is always
computed from the supplied file; embedded custom digests are never trusted.
Re-exported GLB node extras identify the imported scene/node and world transform
as well as source digest and applied layout placement. Custom metadata may be
removed by another editor; retain the editable layout outside downstream tools.

Materials, images, textures, normals and other non-position vertex attributes are
omitted from derived geometry and listed in losses. Image URIs are never fetched.
Cameras are omitted. Shared meshes become separate editable placements; vertices
are not welded by position. No topology repair, watertightness, collision,
engineering accuracy, manufacturing validation or physical authority is implied.

## Supported subset and limits

- GLB 2.0: one JSON chunk then one embedded BIN chunk, valid UTF-8 JSON and exact
  framing. No external/data-URI buffers, extra chunks or compressed extensions.
- One default scene, or the only scene when no default is set. Other scenes are
  omitted and reported. An ambiguous multi-scene file is rejected.
- Static TRIANGLES, indexed or nonindexed, one or several primitives per mesh.
  Positions are float32 VEC3. Indices are unsigned 8/16/32-bit SCALAR. Position
  accessor offsets and interleaved strides are supported; sparse, normalized or
  integer positions and strided indices are unsupported.
- Nested parent-child nodes, translation/unit-quaternion/scale or an affine,
  nonsingular local matrix decomposable into TRS. Nonuniform scale and reflection
  are supported. Cycles, repeated parents/roots, local shear, perspective and
  singular transforms reject. Valid hierarchy composition may produce world
  shear; it is applied to the geometry.
- No animations, skins, morph targets, or glTF extensions. Export a static,
  uncompressed core GLB first. This is geometry-subset validation, not a full
  glTF conformance validator for discarded styling/metadata.
- At most 400000 input bytes, 256 nodes, 64 hierarchy levels, 256 primitives per
  mesh, 40000 selected vertices/triangles, and ±1e9 mm final coordinates.
  Existing layout limits remain 16 instances, 40000 combined vertices/triangles,
  2000000 compact JSON bytes and 3000000 saved/request bytes. Repeated embedded
  source bytes count toward the layout limit; large GLBs may permit fewer than
  16 placements. Use `--nodes` to import a bounded subset.

## Verification

```sh
node --test adapter/reference-glb-import.test.mjs adapter/reference-glb.test.mjs adapter/reference-ply-binary.test.mjs
```

Tests use an independently Python-encoded scene and explicit expected geometry;
check matrix/TRS, reflected winding, accessors, bounds and byte retention; and
exercise actual CLI files, loopback HTTP and production page handlers with
DOM/canvas doubles. Test files are retained in `MOONMOLD_GLB_IMPORT_TEST_ROOT`
(or a unique directory under the system temporary directory). No specific editor
round-trip, graphical browser rendering, MoonBit/native, Blender or physical
qualification is claimed. Cumulative full-suite qualification remains R50.
