# MoonMold

Transform the editable outer ring, cutout, or all profile rings with explicit
translation, rotation, uniform XY scale and pivot. Preview, apply or cancel,
then save/reopen the revised profile. See
[profile ring transforms](docs/REFERENCE_PROFILE_TRANSFORMS.md).

Start from a vector drawing with [SVG outline intake](docs/REFERENCE_SVG_PROFILE.md):
select one polygon, closed polyline/path, unrounded rectangle, circle or ellipse,
declare scale, curve approximation error when required, and Y-axis
conversion, retain original drawing bytes, and revise the editable 3D profile.

Create a plate or bracket reference with an editable interior opening using
[profile cutouts](docs/REFERENCE_PROFILE_CUTOUTS.md). Edit outer/cutout vertices
and height, save/reopen the v2 recipe, then reuse existing layout placement and
area/volume observations. One bounded polygon opening; no general CAD booleans.

Start from a saved CAD drawing with [DXF outline intake](docs/REFERENCE_DXF_PROFILE.md):
inspect named closed polylines, choose explicit units, import one into an editable
profile, then revise the height/points and reuse the derived 3D layout.

Create a capped 3D reference from an editable concave XY outline with
[profile extrusion](docs/REFERENCE_PROFILE_EXTRUSION.md). Revise points/height,
save/reopen the profile recipe, and export a derived layout, OBJ or STL for the
existing reference workbench. This bounded digital-only workflow needs Node only.

[Closed-shell volume exploration](docs/REFERENCE_VOLUME.md) adds per-instance
algebraic volume and centroid to the editable reference-layout workbench and
measurement CLI. Inspect closed and open sources together, change scale, and
export a source-bound JSON/CSV schedule with explicit topology limitations.

Space existing differently sized references between fixed endpoints with
[equal-gap distribution](docs/REFERENCE_DISTRIBUTION.md), preserving original sources
and independently editable placements.

Create open cutaways from placed reference surfaces with an explicit world plane,
retain originals in a portable recut recipe and save an independently editable
derivative with [reference surface cutting](docs/REFERENCE_CUT.md).

Reuse a complete saved arrangement inside the current layout, preserving its
originals and relative placements, with [saved-layout merging](docs/REFERENCE_LAYOUT_MERGE.md).

Revise embedded reference meshes in chosen instances while keeping their applied
placements with [source replacement](docs/REFERENCE_REPLACEMENT.md).

Export a portable top/front/right SVG drawing with overall mm dimensions and
source identities from the reference-layout workbench. See
[three-view drawings](docs/REFERENCE_DRAWING.md).

Import a static GLB scene as independently editable named placements, retaining
original bytes and explicit unit/frame conversion with
[GLB scene intake](docs/REFERENCE_GLB_IMPORT.md).

Open existing OBJ or ASCII/binary STL geometry in a wireframe workbench, resize, rotate, center/ground
and move it, then export reference JSON/OBJ/STL with the
[local reference mesh workbench](docs/REFERENCE_MESH.md).
Compose several references with independent placements, save and reopen their
original sources and transforms, and export combined OBJ/STL with the
[reference layout workbench](docs/REFERENCE_LAYOUT.md).
Align a selected placement's minimum, center or maximum to another instance's
placed world bounds, with a signed millimetre offset, using
[reference alignment](docs/REFERENCE_ALIGNMENT.md). The result remains editable.
Measure two placed reference vertices with signed XYZ deltas, a wireframe
overlay and a separate identity-bound JSON report using
[reference measurements](docs/REFERENCE_MEASUREMENTS.md).
Inspect named object/group occurrences inside one OBJ, extract selected panels,
save/reopen their exact original source and place them independently with
[named OBJ parts](docs/REFERENCE_PARTS.md). This reference workflow needs Node only.

> **Domain pack · early digital-model alpha.** Read the
> [product contract](docs/PRODUCT_CONTRACT.md) for representation truth,
> Blender qualification, authority limits and release gates.

MoonMold is a first-class installable MoonSuite domain pack. It transforms governed spatial intent, references, constraints, and
procedures into editable digital models and representation-specific validation
evidence. It may prepare a manufacturing candidate, but it cannot claim
structural safety, physical readiness, or authorize a physical effect.

The public MoonBit package owns backend-neutral spatial artifacts, representation
lineage, validation findings, and bounded semantic adapter requests. The first
runtime supports an in-process mock backend and an optional Blender adapter;
there is deliberately no public script or shell operation.

```mbt check
///|
test "a presentation sibling cannot replace engineering truth" {
  let source = @moonmold.new_artifact(
    artifact_id="habitat-source",
    representation=EditableSource,
    digest="mm1-source",
    units="m",
    coordinate_frame="z-up-right-handed",
    parent_digest=None,
    relation=None,
    known_losses=[],
  )
  let styled = @moonmold.derive_artifact(
    source,
    artifact_id="habitat-presentation",
    representation=Presentation,
    digest="mm1-present",
    relation=StyledFrom,
    known_losses=["collision fidelity", "engineering materials"],
  )
  assert_true(styled.parent_digest() == Some(source.digest()))
  assert_eq(styled.is_lossless_engineering_representation(), false)
}
```

See `docs/CONSTITUTION.md`, `docs/ARCHITECTURE.md`, and
`docs/EXPERIMENT_REPORT.md` for the product boundary, implementation journey,
quality trials, and current limitations.

The executable ownership rules and test seams are documented in
[`docs/RESPONSIBILITY_AND_TESTABILITY.md`](docs/RESPONSIBILITY_AND_TESTABILITY.md).

## Qualification

```sh
moon check --target all --warn-list +unnecessary_annotation
moon test --target all
npm test
npm run demo
npm run demo:transfer
```

The demos create ignored evidence only under this checkout's
`evidence/generated` directory. The two
fixtures use one general procedure but different topology and dimensions.

Start the bounded stdio MCP adapter with `npm run mcp`. Blender is optional;
when unavailable, live-backend requests fail explicitly and only mock-reference
receipts may be produced.

The unattended product boundary is owned by `moonmold flow-adapter execute`
and `moonmold flow-adapter attest`. Execution creates real Blender evidence;
attestation re-hashes every declared output, preserves concrete unknowns, and
publishes an immutable digital-only final artifact. `product-registry-entry.json`
is the canonical MoonDesk registry entry for a suite installation.

## First-class pack adapter and operator

MoonMold now publishes the exact three manifest tools through a pack-local
MoonBit `moonflow.adapter.v2` implementation with durable attempts, journal
replay, reconciliation, short-lived health evidence and SHA-256 binding. See
[`docs/PACK_ADAPTER.md`](docs/PACK_ADAPTER.md).

The Rabbita operator at `ui/rabbita-moonmold` creates and loads governed
requests, shows backend qualification and representation lineage, runs the
bounded adapter, and records a named-human review without adding another agent
runtime. See [`docs/OPERATOR_APP.md`](docs/OPERATOR_APP.md).

### Editable reference arrays

Generate rows, grids and stacks from a placed OBJ/STL/PLY reference through the
operator layout page, API or CLI. Each copy preserves its original source and is
independently editable after save/reopen. See [reference arrays](docs/REFERENCE_ARRAYS.md).

For radial placements, use the [circular reference array](docs/REFERENCE_CIRCULAR_ARRAY.md)
CLI: choose a world axis, millimeter pivot, angular step and count. It retains
the original source units and bytes, appends independently editable placements,
and exports ordinary layout, inspection JSON, OBJ or STL.

## Reference layout GLB export

Export placed references as self-contained glTF 2.0 GLB with separately named
instance nodes, explicit metre/Y-up coordinates and source/loss metadata. Use
`--format glb` in the existing layout CLI, or **Prepare GLB for 3D viewers** in
the layout workbench. Keep editable layout JSON for original bytes and placements.
See [the GLB workflow and limits](docs/REFERENCE_GLB.md).


### Binary PLY reference intake

The Node-only mesh and layout workbenches import ASCII and little-/big-endian
binary PLY 1.0 indexed triangles. Explicit source units, exact original bytes,
encoding and normal/color losses survive portable layout save/reopen. Use the
[PLY workflow](docs/REFERENCE_PLY.md) and `fixtures/reference-binary-ply.layout.json`
to place and export the supplied pair as OBJ/STL/GLB. This is reference geometry,
with no live Blender, engineering or physical-readiness claim.

### Batch placement CSV editing

Export an applied reference layout to a source-bound CSV, edit several independent
scales/angles/mm offsets, then preview and apply one undoable batch in the Node
operator. Save/reopen ordinary layout JSON and reuse existing OBJ/STL/GLB exports.
See [placement table workflow](docs/REFERENCE_PLACEMENTS_CSV.md) for CLI/API, the
worked example and spreadsheet/qualification limits.

- [Saved layout revision comparison](docs/REFERENCE_REVISION_COMPARISON.md) — inspect source/placement changes and before/after overlays without changing either revision.

### Closed SVG curves into editable profiles

Import one absolute M/L/Q/C/Z closed path with an explicit approximation error
in selected units. Deterministic bounded Bezier subdivision produces ordinary
editable point/height recipes and derived layout/OBJ/STL, retaining original
SVG and separate source/approximation/recipe identities. Inspect and import in
the profile workbench or use `moonmold-reference-svg --max-error`. See the
[SVG outline guide](docs/REFERENCE_SVG_PROFILE.md) and curved-outline fixture.
