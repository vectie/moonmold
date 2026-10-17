Edit independent numeric placements together with the [CSV table workflow](REFERENCE_PLACEMENTS_CSV.md): export, edit, preview and apply one reversible batch while preserving every embedded source.

Try and reverse layout edits in the current page with [session Undo/Redo](REFERENCE_LAYOUT_HISTORY.md), including restoration after removing the final reference. Save editable layouts for durable copies.

Create a matching left/right reference while retaining the originals with
[world-plane mirror copies](REFERENCE_MIRROR.md).

Place one reference by matching a vertex to another reference, with an explicit
world XYZ offset: [Vertex placement](REFERENCE_SNAP.md).

# Compose a reference layout

Find the closest triangle points between two placements, including face interiors,
with [nearest-surface gap inspection](REFERENCE_SEPARATION.md). A source-bound
report and witness overlay help inspect digital arrangements; surface separation
does not certify solid nonoverlap or physical clearance.

Turn unnamed disconnected triangle regions into independent editable placements
with [mesh island inspection and separation](REFERENCE_ISLANDS.md), retaining an
original-source recipe and one-step Undo/Redo.

Measure selected references and export their mm²/m² triangle-sum areas with
[surface-area schedules](REFERENCE_SURFACE_AREA.md), including source-bound JSON
and read-only CSV. Overlapping and internal faces count independently.

Space differently sized existing references between fixed endpoints with
[equal-gap distribution](REFERENCE_DISTRIBUTION.md), preserving original sources
and independently editable placements.

Inspect a previous saved layout against the current applied revision with
[saved revision comparison](REFERENCE_REVISION_COMPARISON.md): explicit source and
placement changes, additions/removals and a shared-frame three-view overlay.

Set a placed reference to a known point-to-point length while keeping its first
vertex fixed with [measured-length calibration](REFERENCE_CALIBRATION.md).

For reusable CAD linework with millimetre coordinates and per-instance layers,
see [DXF section export](REFERENCE_SECTION_DXF.md).

Extract an open 3D cutaway on one side of a world plane with
[reference surface cutting](REFERENCE_CUT.md), preserving the original layout
in a portable recipe and saving the derivative as an ordinary editable layout.

Move or turn several existing placements around a shared world-space pivot with
[chosen-arrangement editing](REFERENCE_ARRANGEMENT.md), preserving their relative
spacing and editable sources.

Reuse a complete saved arrangement inside the current layout, preserving its
originals and relative placements, with [saved-layout merging](REFERENCE_LAYOUT_MERGE.md).

Revise embedded reference meshes in chosen instances while keeping their applied
placements with [source replacement](REFERENCE_REPLACEMENT.md).

For an inspectable 2D sibling, export a [three-view SVG drawing](REFERENCE_DRAWING.md)
with overall dimensions, colored instances and source identities.

To bring a static GLB back as independently editable named placements, see
[GLB scene import](REFERENCE_GLB_IMPORT.md). Original bytes and node selections
remain in the saved layout.

To reuse placed references in glTF-compatible viewers and editors, use
[GLB presentation export](REFERENCE_GLB.md). It keeps named instance nodes,
converts to metre/Y-up coordinates and records source identities and losses.
Keep the saved layout JSON for original sources and editable placements.

For signed XYZ deltas and point-to-point distance between two placed vertices,
use [reference measurements](REFERENCE_MEASUREMENTS.md). Reports are separate
hash-bound observations; the editable layout schema is unchanged.

Use the operator's `/reference-layout` page to arrange several existing OBJ, PLY or
ASCII/binary STL references without modifying their originals. The single-mesh
workbench links to it. This page and its API require only Node 20+; no MoonBit,
Blender, npm dependency installation or compiled Rabbita UI is needed.

To choose faces inside a single named OBJ before composing instances, use
[named OBJ extraction](REFERENCE_PARTS.md). Saved OBJ source objects may include
`part_ids`; layout save/reopen preserves those IDs with the exact original text
and units, and each selected instance has its own placement.

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`:

1. Add a local OBJ/STL/PLY and explicitly choose its original units. Repeat for each
   reference, or duplicate an already applied instance.
2. Select an instance. Set scale, X/Y/Z rotations and millimetre translation;
   optionally center its X/Y bounds and ground its lowest Z before translation.
   Click **Apply placement**. The other instances keep their placements.
3. Inspect selected and combined bounds/dimensions. The selected wireframe is
   highlighted. Changing the view does not edit geometry.
4. **Save editable layout** downloads a self-contained `.layout.json` with
   original source text/bytes, source units and every applied transform. Reopen
   it through **Open layout**, even after moving it to another directory or
   restarting the server. It needs no original files or external paths.
5. **Combined OBJ** and **Combined STL** download derived millimetre geometry.
   **Inspection report** includes all part bounds, source hashes, index ranges,
   the normalized layout and derived outputs. Reopen the editable layout,
   rather than the inspection report, to continue editing.

For rows, grids and stacks, **Repeat selected placement** expands the selected
instance with explicit X/Y/Z counts and world-axis millimetre pitch. Generated
copies remain independent ordinary placements. See [editable reference arrays](REFERENCE_ARRAYS.md)
for the CLI, API, source-preserving example and spacing semantics.

For an existing placement, **Align selected placement** translates one world axis
to match a minimum/center/maximum bound on another instance, plus a signed mm
offset. It evaluates actual scaled/rotated/grounded bounds rather than source
origins. See [reference alignment](REFERENCE_ALIGNMENT.md) for the CLI, API and
an example panel-above-stand layout. This is a one-time edit, not a constraint.

Unsaved form values are not included in downloads. Duplicate, reset and remove
operate on the last applied layout. Reset affects only the selected transform.
Invalid edits/imports leave the last successful layout and its downloads intact.
Removing the last instance clears the preview/downloads until another is added.
The server does not persist these layouts: save a download before closing.

## Portable manifest and CLI

`fixtures/reference-layout.json` is a complete synthetic three-instance example:
an OBJ triangle in mm, an STL triangle in inches translated to `[10,20,5]` mm,
and a separately scaled/rotated/grounded OBJ copy. It produces 9 vertices and
3 triangles spanning about **57.4 × 45.4 × 6 mm**. Floating-point rotation can
leave near-zero residual coordinates.

```sh
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --format layout --output saved.layout.json
node bin/moonmold-reference-layout.mjs --input saved.layout.json --format obj --output combined.obj
node bin/moonmold-reference-layout.mjs --input saved.layout.json --format stl --output combined.stl
node bin/moonmold-reference-layout.mjs --input saved.layout.json --format json --output inspection.json
```

Output files must not exist. Omitting `--output` writes to stdout. Default
`--format json` is an inspection report; `--format layout` is the reusable source.

The bounded JSON contract has exactly these fields:

```json
{
  "contract_id": "moonmold.reference-layout.v1",
  "name": "layout-name",
  "instances": [
    {
      "id": "part-1",
      "source": {
        "name": "original.obj",
        "input_format": "obj",
        "units": "mm",
        "text": "v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3\n"
      },
      "transform": {
        "scale": 1,
        "rotation_deg": [0, 0, 0],
        "center_and_ground": false,
        "translation_mm": [0, 0, 0]
      }
    }
  ]
}
```

- `name` and unique instance `id` use 1–80 ASCII letters/digits/dot/dash/underscore,
  starting with a letter or digit. Order in `instances` controls export order.
- `input_format` is explicitly `obj`, `stl` or `ply`; `units` is `mm`, `cm`, `m` or `in`.
- OBJ sources may include `part_ids`, a nonempty unique array of object/group
  occurrence IDs from that exact source's import catalog. Selection happens
  before placement; source bytes, IDs and face provenance survive save/reopen.
- OBJ uses `text`. PLY and STL use either ASCII `text` or canonical `data_base64`
  containing complete original ASCII/binary bytes. Binary PLY supports little- and
  big-endian indexed triangles; see [PLY intake](REFERENCE_PLY.md). Exactly one
  source payload is allowed.
  `source.name` is optional, defaulting to `reference`; original file paths and
  URLs are not accepted or fetched.
- `transform` is optional, with identity defaults. It uses the existing
  [reference workbench transform order](REFERENCE_MESH.md): source conversion to
  mm, uniform scale, right-handed X/Y/Z rotation about the source origin,
  optional per-instance centering/grounding, and translation in mm.
- At most 16 instances, 400000 source bytes per instance, 2000000 compact JSON
  bytes, and 40000 combined vertices and triangles each. Saved layout files and
  HTTP bodies are limited to 3000000 bytes, including whitespace. Derived
  geometry can exceed the original single-reference import-size limit; keep the
  layout to reopen larger compositions.
- The API is `POST /api/reference-layout/compose` with the manifest as its JSON
  body. It returns `moonmold.reference-layout-result.v1`. Invalid manifests are
  HTTP 400 and never partially compose. No semantic scene state is mutated.

## Identity and representation limits

Each part reports the exact original byte SHA-256, source format/encoding/units,
source bounds in mm, normalized transform, placed bounds, and zero-based
`vertex_range` / `triangle_range` (`start`, `count`) in the combined arrays.
`layout_sha256` hashes canonical normalized layout JSON, including original
bytes and all placements. `geometry_sha256` hashes canonical
`{units:"mm",vertices,triangles}`. A source-comment edit can change source/layout
identity while retaining identical geometry. Canonical object keys are sorted;
array order is significant. These hashes identify data; they do not certify it.

Composition concatenates independent vertices and offset triangle indices.
Coincident vertices and overlapping faces remain separate, including duplicates.
OBJ includes an `o <instance-id>` before each part's faces. STL has no instance
identity and flattens all triangles into one solid label. Both bake transforms
and source units into mm coordinates. STL also omits unused source vertices;
displayed bounds and OBJ include all imported vertices. Keep the layout for
editable source identity, per-part placement and original source bytes.

Source import losses remain listed per part. Materials, textures and source
normals do not survive derived export. This is reference placement composition,
with no welding, boolean union, collision/clearance detection, topology repair,
watertightness, engineering, manufacturing or physical-readiness assessment.
Existing primitive semantic operations and delivery acceptance are unchanged.
For per-instance X/Y/Z observations of this placed composition, use the
[layout-section CLI and API](REFERENCE_LAYOUT_SECTIONS.md). The single-mesh
workbench continues to section individual references.
