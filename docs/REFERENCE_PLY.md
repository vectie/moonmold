# Import an ASCII or binary PLY reference

Use a PLY triangle mesh in the existing Node-only reference workbenches. Choose
its source units explicitly (mm, cm, m or in); PLY comments never infer units.
No dependency installation, MoonBit build or Blender is required.

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `/reference-mesh` to import a `.ply`, inspect dimensions and known losses,
apply placement/scale, take a section and download derived millimetre OBJ/STL.
Open `/reference-layout` to compose PLY with OBJ/STL references. Save the editable
layout to retain exact original PLY bytes, original units and applied transforms.
Reopen that layout to continue editing. Inspection JSON is a report, not the
editable source document. Failed imports leave the previous successful outputs.

```sh
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron.ply --units cm --format json
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron.ply --units cm --transform fixtures/reference-placement.json --format obj --output placed.obj
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron.ply --units cm --section-axis z --section-position-mm 20 --format svg --output section.svg
node bin/moonmold-reference-layout.mjs --input fixtures/reference-ply-layout.json --format layout --output saved.layout.json
```

CLI detects `.ply` case-insensitively; `--input-format ply` explicitly overrides
the extension. Output paths must be new. It reads raw bytes and detects the PLY
encoding from the header, never from a filename or guessed body content.

API source payloads use `{input_format:"ply",data_base64:"...",units:"cm",name:"reference"}`
for either binary or ASCII PLY. `data_base64` must be canonical base64 of the
complete original file, including its header. Existing ASCII payloads using
`text` are still accepted and reopened unchanged. Supply exactly one payload;
binary PLY requires `data_base64`, never decoded text. Exact original bytes are
hashed before unit conversion. Both workbenches read `.ply` files as bytes and
retain base64, including for new ASCII imports. Saved layouts embed the payload
without rewriting it; existing ASCII text layouts remain compatible.

Derived OBJ/STL/GLB discard PLY colors and stored normals. GLB is available through
the layout page/CLI. Keep editable layout JSON for original units, encodings,
bytes and placements. The single-mesh **Open saved source**/`--source` option is
still for OBJ selections only; use **Open layout** to reopen binary PLY placements.

## Binary PLY example

The two synthetic fixtures `reference-tetrahedron-le.ply` and
`reference-tetrahedron-be.ply` encode the same four-vertex/four-triangle colored
reference in opposite byte orders. Choose cm explicitly: each is 20 × 30 × 40 mm.
Their SHA-256 identities differ even though the decoded geometry is equal.

```sh
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron-le.ply --units cm --format obj --output little-endian.obj
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-tetrahedron-be.ply --units cm --section-axis z --section-position-mm 20 --format svg --output big-endian-section.svg
node bin/moonmold-reference-layout.mjs --input fixtures/reference-binary-ply.layout.json --format layout --output binary-pair.layout.json
node bin/moonmold-reference-layout.mjs --input binary-pair.layout.json --format glb --output binary-pair.glb
```

Open the supplied pair layout in `/reference-layout`, or add each binary `.ply`
with source units cm. Its second instance is translated 60 mm on X; total bounds
are 80 × 30 × 40 mm. Select, resize, rotate or move either instance, apply the
placement, save, and reopen. The PLY encoding and original source hash appear in
the selected-part status and inspection report. Truncated/unsupported imports
leave the previous successful preview, source and downloads available.

## Supported subset and losses

- ASCII header `ply`, followed by `format ascii 1.0`,
  `format binary_little_endian 1.0` or `format binary_big_endian 1.0`;
  LF or CRLF, with a newline after `end_header`.
- Binary body is packed in declared property order and byte order, without
  alignment or padding. Header types control 1/2/4-byte integers and IEEE
  float32/float64 values. Float32 values are read as stored; lost exporter
  precision cannot be reconstructed. No byte-order guessing or repair.
- One nonempty `vertex` element, then one nonempty `face` element, at most
  40000 records each and 400000 input bytes total.
- Vertex scalar x/y/z properties in any order. Finite values only, converted
  coordinates within ±1e9 mm. Indexed winding is preserved; no tolerance welding.
- Face `property list <integer-type> <integer-type> vertex_indices` (also
  `vertex_index`) with exactly three distinct, valid zero-based indices.
  Degenerate triangles are rejected; polygons must be triangulated beforehand.
- Optional scalar nx/ny/nz and red/green/blue/alpha on vertices or faces are
  validated and explicitly reported as discarded. Partial normal/color fields
  are allowed but do not carry semantics into output. STL normals are recomputed.
- Scalar types: char/uchar/short/ushort/int/uint/float/double and their
  int8/uint8/int16/uint16/int32/uint32/float32/float64 aliases. Integer type ranges
  and finite floating-point values are checked.
- Comments and obj_info are discarded and reported. Additional elements, other
  properties/lists (including texture coordinates, intensity/confidence and
  Gaussian-splat fields), missing/extra records and non-ASCII header/text are
  rejected. Point clouds without faces and polygon faces other than triangles
  are unsupported. Re-export with the supported fields and triangulate first.
- Binary bodies require exact exhaustion: truncated scalars/lists and any extra
  bytes, including trailing newline or padding, are rejected. Nonfinite values
  in coordinates or discarded normal/color fields are rejected. No PLY export
  or broad scanner/exporter compatibility qualification is added.

The synthetic tetrahedron in cm imports as 20 × 30 × 40 mm with four triangles.
The z=20 mm section has three independent segments. The supplied layout scales
it by two and translates X by 10 mm, retaining the original text for reopening.
These are unqualified reference geometry, not engineering or fabrication proof.
Topology, watertightness, manufacturing suitability and live Blender are untested.


## Focused verification

`node --test adapter/reference-ply-binary.test.mjs adapter/reference-ply.test.mjs`
checks actual CLI files, loopback HTTP, both byte orders, scalar/list-width aliases,
reordered properties, raw source identity, limits, section/export and save/reopen.
The served page handlers are exercised with DOM/canvas doubles, including repeated
imports, edits and failed reopen. This does not qualify graphical rendering, a
particular external application's PLY export, native MoonBit or live Blender.

The PLY layout follows the [original project description](https://sites.cc.gatech.edu/projects/large_models/ply.html):
header properties describe vertex records, and faces are counted index lists.
The supported subset above is intentionally smaller than general PLY.
