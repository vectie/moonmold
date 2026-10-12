# Export a reference layout to GLB

To bring a static GLB back as independently editable named placements, see
[GLB scene import](REFERENCE_GLB_IMPORT.md). Original bytes and node selections
remain in the saved layout.

The reference-layout workbench can now produce a self-contained glTF 2.0 binary
(`.glb`) for import into compatible 3D viewers and editors. Each applied instance
becomes a separately named mesh and scene node. No provider or Blender is needed.
This is a derived reference presentation, not a replacement for the editable
layout or an engineering/manufacturing qualification.

## Use the existing workbench

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`, add references or open a saved
layout, and apply any placement edits. Click **Prepare GLB for 3D viewers**, then
**Download GLB**. Download **Save editable layout** too: that file retains the
original sources, source units, selected OBJ parts and editable transforms.

The GLB link describes the last successful applied layout. An applied edit,
new import, reopen or removal clears it. Unapplied fields disable preparing a
new GLB; the existing downloads continue to show the last applied revision.
Failed exports preserve those successful downloads. Repeated export clicks are
ignored while a request is running. No server-side file is created by this route.

## CLI and API

```sh
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --format glb --output placed.glb
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --format layout --output placed.layout.json
```

The output file must be new. Without `--output`, GLB bytes go directly to stdout;
redirect them to a file rather than displaying them in a terminal. `--format glb`
is for layouts and cannot be combined with section options. Existing layout,
OBJ, STL, inspection and section formats remain available.

`POST /api/reference-layout/glb` accepts the same self-contained
`moonmold.reference-layout.v1` JSON as the compose route. A successful response
is `model/gltf-binary` with attachment disposition and binary content length.
Invalid input is a JSON HTTP 400 error. The route does not accept URLs, original
file paths, already-composed geometry or a different source contract. Existing
layout/source limits apply: 16 instances, 40000 combined vertices/triangles,
2000000 compact layout bytes and 3000000 request/file bytes.

The Node API is `exportReferenceLayoutGlb(layout)` in
`adapter/reference-glb.mjs`; it returns a Buffer. It calls the existing composer
so import selection and placement order have a single implementation.

## Coordinates, identity and losses

- glTF coordinates are right-handed, Y-up and in metres. MoonMold layout
  coordinates are in millimetres with Z as the grounding axis. The explicit
  conversion is `[x,y,z] mm -> [x,z,-y]/1000 m`. This is a proper rotation plus
  unit conversion; face winding is retained. Source axes are never guessed.
- All placements are baked into each node's mesh positions. There is no added
  node transform, animation, CAD constraint or mesh welding. Coincident
  instances remain separate nodes. Nodes and meshes use the layout instance IDs.
- Positions use IEEE float32; indices use unsigned 16-bit integers within the
  existing 40000-vertex bound. Accessor bounds describe those stored float32
  values, including unreferenced vertices. Such vertices do not render.
- The maximum Euclidean vertex-rounding difference, in mm, is reported per node
  and for the asset. It measures this conversion only, not source precision,
  engineering accuracy or a tolerance guarantee. A triangle collapsing at
  float32 precision rejects with its instance and local triangle index. Move
  large coordinates closer to the origin or choose OBJ to retain doubles.
- `asset.extras.moonmold` records the `moonmold.reference-glb.v1` export contract,
  layout and pre-quantization geometry SHA-256, coordinate mapping, losses and
  `physical_authority: false`. Hashes identify source data; they do not certify
  geometry. The final file's own digest can be computed separately if needed.
- `node.extras.moonmold` records the original byte SHA-256, source format/units,
  source and placed bounds, applied transform, selected OBJ parts when present,
  import losses and rounding error. Original source bytes and complete face
  provenance are not embedded. Save the editable layout for replay.
- One neutral, double-sided material replaces original styling. Materials,
  textures, supplied normals and OBJ object/group names do not survive this
  presentation. No normals are emitted; glTF clients use flat shading. There
  are no external buffers, images, URIs or resources to fetch.

The format follows the Khronos [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
particularly coordinate conventions, accessors and the binary container. It is
not a claim that every viewer preserves custom `extras` on re-export. Keep the
editable layout outside downstream viewers.

## Verification scope

```sh
node --test adapter/reference-glb.test.mjs
```

Tests independently decode GLB framing, accessors, float32 bounds and triangles;
exercise mixed OBJ/STL/PLY, source units, placements, selected parts, precision
loss, deterministic reopen, real CLI files/stdout and HTTP; and execute production
page handlers with DOM/canvas doubles for edits, failures, repeated clicks and
stale downloads. Test files are retained under `MOONMOLD_GLB_TEST_ROOT`, or a
unique directory under the system temporary directory.

R241 also validates two actual output files with the official Khronos
`gltf-validator` 2.0.0-dev.3.10, with no runtime dependency added to this project.
This establishes format/data checks, not graphical browser rendering, a specific
editor import, native MoonBit, live Blender, engineering safety or fabrication.
