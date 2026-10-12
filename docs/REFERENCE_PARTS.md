# Extract named parts inside one OBJ

For unnamed disconnected regions in OBJ, STL, PLY or static GLB references, use
[edge-connected island separation](REFERENCE_ISLANDS.md) in the layout operator.

An imported OBJ can contain several named objects and overlapping groups. The
reference workbench now lets you inspect these occurrences, extract one or more,
and place or reuse that geometry independently. This selects faces **inside a
single source**; the layout's existing instance selector operates on separate
references. Nothing is repaired, welded, made solid or qualified for engineering.

This workflow needs only Node 20+. No npm dependencies, MoonBit build, Blender
or compiled Rabbita UI are needed:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-mesh`:

1. Import `fixtures/reference-shelf-assembly.obj` and explicitly choose **cm**.
   The synthetic shelf has a deck, back and two side brackets. Its four quads
   produce eight triangles. It is a collection of open, zero-thickness surfaces.
2. Inspect **Named OBJ parts**. Each object/group occurrence has its source line,
   face count and triangle count. Repeated `bracket` and `brace` names are
   intentional; choose by kind and occurrence/line rather than guessing a name.
3. Select the `back` object, then **Extract selected**. It contains two triangles,
   four vertices and measures **60 × 0 × 30 mm**. Select several entries with
   Ctrl/Command or Shift. A face shared by an object and a group is included once.
4. Apply placement as usual. Reset clears placement while keeping the extracted
   selection. **Restore whole source** returns every original vertex and face;
   extraction and restoration start with identity placement.
5. Download **selected source JSON** to retain the exact original OBJ text,
   original units and applied IDs. **Open saved source** reopens it without the
   original file, even after a page/server restart. It reopens with identity
   placement. The edited mesh JSON separately contains the source and transform.
6. Download OBJ or STL for the current geometry, then add that file to
   `/reference-layout` with **mm** units to place it as an independent instance.
   Those geometry exports do not carry the original source-face identities.
   For source-preserving editable layouts, use the saved source object directly
   in a layout manifest/API instance as described below.

Part choices are unapplied until **Extract selected**. Empty/invalid selection,
malformed import, bad saved source and invalid transform leave the last successful
geometry, downloads and reusable source unchanged. Controls are locked during
requests; a repeated click cannot submit a competing edit. Changing to STL/PLY
clears the OBJ catalog. No source, scene or server file is overwritten.

The fixture deliberately contains an unused vertex at `[99,99,99]` cm. Whole-source
bounds therefore span **990 × 990 × 990 mm**. Extracted bounds include only vertices
referenced by selected faces: selecting all four objects gives **60 × 40 × 30 mm**.
This exposes a practical difference between selecting all faces and keeping all
original vertices. The input is synthetic, not an engineering model.

## Actual local-file CLI

Run from the repository root. Each output filename must be new:

```sh
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-shelf-assembly.obj --units cm --format parts --output catalog.json
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-shelf-assembly.obj --units cm --parts object-2,object-4 --format source --output panels.source.json
node bin/moonmold-reference-mesh.mjs --source panels.source.json --format obj --output panels.obj
node bin/moonmold-reference-mesh.mjs --source panels.source.json --format stl --output panels.stl
node bin/moonmold-reference-mesh.mjs --source panels.source.json --transform fixtures/reference-part-placement.json --format json --output placed-panels.json
node bin/moonmold-reference-mesh.mjs --source panels.source.json --section-axis z --section-position-mm 15 --format json --output panel-section.json
```

The two selected panels have four triangles, six referenced vertices and dimensions
60 × 40 × 30 mm. The placement fixture rotates 90° around Z, centers/grounds, then
moves to `[100,50,0]` mm; placed dimensions are approximately 40 × 60 × 30 mm, with
bounds `[80,20,0]` to `[120,80,30]`. Tiny trigonometric residuals are expected.

`--parts` is a comma-separated list of occurrence IDs from `--format parts`, never
a list of labels. Omit it to keep the whole source. Empty, duplicate, nonexistent
and empty-occurrence IDs reject. `--format source` saves the reusable source
object, not applied placement; `--format json` is the full inspection result.
`--source` uses saved units and selection and cannot be combined with source
overrides (`--input`, `--input-format`, `--units`, `--name`, `--parts`).

## API and portable layout sources

Use the existing `POST /api/reference-mesh/import` or
`POST /api/reference-mesh/transform` endpoint, with original `text`, explicit
`units`, `input_format: "obj"`, optional `name`, and optional `part_ids` array.
An ordinary import returns the catalog without selecting anything automatically.
Transforms apply to the chosen union, starting from the original source each time.
The optional selection is also accepted by `/api/reference-mesh/section`.

The result's `source` is a reusable input object, for example:

```json
{
  "input_format": "obj",
  "units": "cm",
  "name": "shelf",
  "text": "original OBJ text, including comments and original line endings",
  "part_ids": ["object-2", "object-4"]
}
```

This example's placeholder text must be replaced with real OBJ text. The CLI/UI
source download already contains the actual bytes; use that object unchanged.
Put it in a layout instance's `source`, with its independent `id` and `transform`,
then call `POST /api/reference-layout/compose` or the
[layout CLI](REFERENCE_LAYOUT.md). Multiple instances can select different IDs
from the same original OBJ. Saved layout JSON retains each original source text,
units, selector and applied transform. Reopening replays the selection before
placement. Layout report `parts` includes the original face/vertex mapping for
each selected instance; its `triangle_range` locates that mapping in the combined
mesh. Overlapping instances still duplicate geometry, as normal layout composition.

## Identity, byte preservation and deliberate name semantics

- `obj_parts` lists nonempty object/group **declaration occurrences**, in source
  declaration order. Object IDs are `object-1`, `object-2`, etc.; each `o` starts
  a new occurrence even when a name repeats. `object-0` covers faces preceding
  any `o`. Bare `o` starts a new unnamed object. Empty occurrences are not listed.
- Each token on a `g` record gets its own `group-N` occurrence. Repeated names on
  later records remain distinct selections. Bare `g` clears groups. Object and
  group state are independent: changing `o` does not reset active groups. A face
  can belong to one object and several groups. Repeated names within one `g`
  record reject rather than inventing duplicate memberships.
- Selecting several occurrences forms a union of original faces. Source face
  order and triangle winding remain unchanged. Only referenced source vertices
  survive, compacted in source-index order. Shared source indices remain shared;
  equal coordinates at different indices are never welded. Quads/convex polygons
  retain the existing fan triangulation rules.
- `source_sha256` hashes exact UTF-8 source bytes. File import is strict UTF-8,
  retaining BOM and LF/CRLF; invalid UTF-8 and lone surrogate text reject. The
  `source.text` field round-trips those bytes; this does not support arbitrary
  non-UTF-8 OBJ encodings. Units are explicit and remain in `source.units`; all
  geometry/catalog bounds and derived geometry exports are in mm.
- `source_faces` reports zero-based original `source_face_index`, one-based
  `source_line`, original zero-based `source_vertex_indices`, object/group IDs,
  and original full-source `source_triangle_range` (`start`, `count`).
  `source_vertex_indices` at mesh level maps each compact vertex back to source.
  `triangle_source_faces` maps each output triangle to its original face.
  The catalog and its bounds always describe the original source, even after
  placement; mesh `bounds` describes the current selected/placed geometry.
- `selection` reports canonical source-order `part_ids`, full `source_face_count`
  and `selected_face_count`. It survives transforms, sections and layout reports.
  Section `triangle_ids` refer to the selected mesh and map through its
  `triangle_source_faces`. Source IDs are local to these exact bytes, not durable
  IDs across file edits. Preserve the source object instead of applying saved IDs
  to a newly edited file.

Derived OBJ keeps object/group names and needed state changes. It rewrites
coordinates/faces, so reimport creates new source identity and occurrence IDs.
Derived STL drops names and original-index identity. Materials, textures, supplied
normals and smoothing remain disclosed losses; no external material file is read.
Names are data, not HTML, paths or commands. Source JSON carries original text;
do not confuse derived geometry with a byte-for-byte original file export.

## Bounds and qualification

Existing source limit: 400000 UTF-8 bytes and 64 vertices per face. OBJ additionally
allows at most 256 object/group occurrences including the implicit initial object,
32 active group names, 40000 triangles, 100000 total face-to-part memberships,
and 200 characters for each object/group declaration's combined name text.
Unused declarations count toward the occurrence limit. Reference HTTP JSON bodies
remain limited to 600000 bytes including escaping; saved source JSON files are
limited to 2500000 bytes. Layout limits remain unchanged. Invalid data fails as a
whole; there is no partial extraction or fallback to guessed units/names.

Run `node --test adapter/reference-parts.test.mjs adapter/reference-parts-ui.test.mjs`
for focused qualification, or `node --test adapter/*.test.mjs` for the adapter
suite (which also needs the existing native adapter, Blender manifest and external
reference-image fixtures). `node --test adapter/reference-*.test.mjs` runs the full
Node-only reference suite. These tests exercise actual files/CLI, loopback HTTP and the production served-page
JavaScript handlers with DOM/canvas doubles, including failures, busy/repeated
actions, reopen, restore and format switching. Browser rendering, MoonBit native,
live Blender, topology, watertightness, engineering/manufacturing fitness and
physical execution are not established by these tests.
