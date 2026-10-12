# Separate unnamed mesh islands into editable placements

An imported STL or PLY assembly may contain several disconnected triangle regions
without names. Existing named OBJ extraction cannot identify those regions.
**Separate mesh islands** inspects one applied reference, then replaces it with
ordinary independent layout placements. The other references remain exact.

This is a reference geometry workflow, not solid CAD or a topology certificate.
An “island” here means triangles connected by complete edges with exactly equal
endpoint XYZ coordinates. It does not mean a separate physical object.

## Operator journey

Only Node 20+ is needed. From the repository root:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`:

1. Open `fixtures/reference-islands.layout.json`, or add a local OBJ/STL/PLY with
   explicit source units. Existing static GLB and named OBJ selections work too.
2. Select **brackets** under Edit selected placement. Apply or discard any
   pending placement fields.
3. Under **Separate mesh islands**, click **Inspect selected islands**. The
   catalog lists each region's triangle count and placed bounds. Download the
   JSON catalog for the exact source and parent-local triangle/vertex mappings.
   Inspection leaves the model and existing exports unchanged.
4. Click **Separate all inspected islands**. The example replaces `brackets`
   with `brackets.island-1` and `brackets.island-2`. `marker` stays unchanged.
   Choose either island in the ordinary placement selector to highlight its
   wireframe and move, rotate, duplicate or remove it independently.
5. Save **island recipe with originals**, **editable layout**, and **Inspection
   report**. The recipe retains every original byte and applied placement; the
   editable layout is the separated derivative. Further edits clear the recipe
   link, so save it before editing.
6. **Undo layout change** reverses the split in one step. Redo restores it and
   its recipe link. **Restore pre-split layout** restores the recipe's originals.
   Opening a saved island recipe reproduces the split and enables that restore
   button. Opening the editable layout continues work on the separated geometry.

The synthetic fixture has two open rectangular panels in one unnamed ASCII STL,
with interleaved facets, original units cm, scale 2, a 90° Z rotation and a
`[100,10,5]` mm translation. Each island has two triangles. Their world bounds are
approximately `[80,10,5]` to `[100,50,5]` mm and `[60,110,25]` to `[100,130,25]` mm;
trigonometric residuals are expected. The fixed marker has one triangle, so the
saved derivative has three instances and five triangles. These open synthetic
surfaces have no thickness or physical qualification.

Changing selection, applying edits, entering unapplied placement fields, or
removing the final reference clears the catalog. Failed or mismatched responses
leave the last successful layout and valid catalog intact. Requests lock competing
actions. One island has nothing to split; more than 16 resulting placements
leaves inspection usable but disables separation. No server persistence is added:
download your files before closing the page. Existing session history limits apply.

## Local files and portable recipes

```sh
# Catalog only; this is the default format.
node bin/moonmold-reference-islands.mjs --input fixtures/reference-islands.layout.json --instance brackets --output brackets.catalog.json

# Ordinary layout with independent derived references.
node bin/moonmold-reference-islands.mjs --input fixtures/reference-islands.layout.json --instance brackets --format layout --output separated.layout.json

# Preserve originals and lineage separately.
node bin/moonmold-reference-islands.mjs --input fixtures/reference-islands.layout.json --instance brackets --format recipe --output brackets.islands.json
node bin/moonmold-reference-islands.mjs --recipe brackets.islands.json --format json --output separated.report.json

# Reopen or export the derivative with existing product tools.
node bin/moonmold-reference-layout.mjs --input separated.layout.json --format obj --output separated.obj
node bin/moonmold-reference-islands.mjs --input separated.layout.json --instance brackets.island-1
```

`--format` accepts `catalog`, `layout`, `recipe`, `json`, `obj` and `stl`. All
formats except catalog perform the split. Omit `--output` for stdout. Output files
must be new; existing files or symlinks are never replaced. Inputs must be regular
local strict UTF-8 JSON files, at most 3100000 bytes. A recipe cannot be combined
with an instance override. The npm alias is `reference-islands`; no packages need
installing. Invalid input fails before writing an output.

## API and exact semantics

- `POST /api/reference-layout/islands` runs `inspectReferenceIslands`.
- `POST /api/reference-layout/split-islands` runs `splitReferenceIslands`.
- Both accept `{ "layout": <complete layout object>, "instance_id": "brackets" }`.
  They also accept the saved `moonmold.reference-island-split.v1` recipe, which has
  those fields plus `contract_id`. Unknown fields reject. The HTTP body limit is
  3100000 bytes. No paths, URLs, expressions, scripts or file writes are accepted.
- Inspection returns `moonmold.reference-islands.v1`: layout and geometry hashes,
  source-byte hash/format/units/selection/transform/losses, original composed
  ranges, frame, counts, connectivity policy and ordered components.
- Components are ordered by their first input triangle. Their IDs are `island-1`,
  `island-2`, etc. Triangles retain their original relative order inside each
  component. Referenced vertices are compacted in original local-index order.
- Connectivity is evaluated after existing import selection and complete world
  placement. A complete shared edge connects even if its endpoints use distinct
  indices. Output does **not** weld those indices. Shared vertex-only contacts,
  crossings, overlaps without matching full edges and partially matching edges
  do not connect. All faces on a nonmanifold edge connect, regardless of winding.
  Duplicate coincident faces stay present and may belong to the same component.
- Equality is exact IEEE numeric equality (`-0` equals `0`), with no tolerance.
  Almost-touching edges remain separate. Coordinate rounding caused by source
  import or a placement at extreme scale can affect connectivity. Connectivity
  is not an intersection, proximity, orientation or semantic-part inference.
- Split replaces the selected instance at its original list position. IDs use
  its first 60 characters plus `.island-N`; collisions with retained references
  get `-2`, `-3`, etc. These are deterministic for this input, not durable IDs
  across source changes. Unselected normalized instances are unchanged.
- Selected world vertices and triangles become millimetre OBJ sources with
  identity transforms. Winding is preserved; triangle order across components
  and combined index numbering may change. Vertex-only shared indices can be
  duplicated across independently editable outputs. No geometry is welded,
  retriangulated, repaired or removed except unused vertices.
- Derived OBJ omits old object/group labels and earlier original indices. Original
  materials/normals/textures already follow the importer's disclosed losses.
  Original bytes, source selections and placements remain in the separate recipe.
- `island_split` in the result binds parent/output layout and geometry hashes,
  recipe hash and component mappings. `parent_local_triangle_indices[N]` identifies
  which selected pre-split composed triangle became output triangle N in that
  island. Vertex mapping works the same way. Add the inspection's composed range
  starts to obtain indices in the complete parent layout. These local indices
  are not stable source-face IDs; reopen the recipe to reconstruct prior OBJ/GLB
  selection provenance. Keep the report and recipe together.
- Existing limits still apply: 16 instances, 400000 bytes per source, 2000000
  compact layout JSON bytes, 3000000 saved layout bytes, and 40000 combined
  vertices/triangles each. Splitting can duplicate point-contact vertices or
  enlarge OBJ text. A derivative that exceeds limits or cannot reimport fails
  atomically; inspection alone does not promise that derivative creation fits.

Hashes identify exact digital data; they do not certify suitability. All outputs
remain reference-derived siblings with no fabrication or physical authority.

## Qualification

```sh
node --test adapter/reference-islands*.test.mjs
node --test adapter/reference-*.test.mjs
```

Focused tests cover source and geometry preservation, selected OBJ, ASCII/binary
STL, PLY, selected GLB, transformed placement, exact-edge semantics, independent
moves, save/reopen, real CLI files, loopback HTTP, and production page handlers
with DOM/canvas doubles including Undo/Redo. Graphical browser rendering, MoonBit
native, live Blender, full product operation, engineering and hardware are not
qualified by these tests. No dependency installation or Moon invocation is needed.
