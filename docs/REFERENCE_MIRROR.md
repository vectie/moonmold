# Make mirrored reference counterparts

Create a left/right, front/back or above/below counterpart from one or more
already placed references. Choose a world-axis plane explicitly in millimetres.
All originals stay in place; selected mirrored copies are appended as ordinary,
independently editable layout instances.

This is a bounded reference-surface edit, without Blender or any physical action.
Unlike repeating translations or rotations, a reflection changes handedness.
MoonMold reverses every copied triangle's winding so its front face reflects with
its geometry. It does not guess whether the original winding was correct.

## Example: a matching panel across X = 50 mm

From the repository root, with Node 20 or newer:

```sh
node bin/moonmold-reference-mirror.mjs \
  --input fixtures/reference-calibration.layout.json \
  --instances panel --axis x --position-mm 50 --suffix -mirror \
  --format layout --output mirrored.layout.json
```

The selected cm panel is already scaled, rotated, centered/grounded and translated.
Its placed corners are approximately `[130,-25,5]`, `[130,65,5]`, `[70,65,5]` and
`[70,-25,5]` mm. Reflection across X = 50 produces `[-30,-25,5]`, `[-30,65,5]`,
`[30,65,5]` and `[30,-25,5]`. The new instance is `panel-mirror`; the original
`panel` and PLY `stand` remain unchanged.

Open `mirrored.layout.json` with the existing reference-layout operator or CLI.
You can translate/rotate/scale the copied reference independently afterward.
Copies have millimetre OBJ sources with identity placement, because the world
reflection is baked into their geometry. The saved layout does not carry a
persistent symmetry constraint.

To mirror several instances, use `--instances panel,stand`. Copies are appended
in original layout order, regardless of the selection argument order. `--suffix`
is required, so the output names are visible and deliberate. Existing IDs are
never replaced. A name collision is an error; choose a different suffix.

## Retain the original-source recipe

Use the same command with `--format recipe --output panel.mirror.json` to save
the full original normalized layout, selected IDs, plane and suffix. The recipe
retains original bytes, units, selections and placements. Reopen it without
referencing the original files:

```sh
node bin/moonmold-reference-mirror.mjs \
  --recipe panel.mirror.json --format layout --output regenerated.layout.json
```

Regenerating a recipe is deterministic and does not append a second set of
copies. To change the plane, edit a copy of the recipe's `plane.position_mm` or
start again from the original layout. `--recipe` rejects command-line edit
overrides to avoid an ambiguous saved recipe. Mirroring an already mirrored
layout is a new edit; use another suffix for another set of copies.

## Outputs and programmatic entry point

- `--format layout` (default): ordinary reusable layout JSON, with originals and copies
- `--format recipe`: reusable original-source mirror recipe
- `--format json`: inspection report, including source/parent/recipe/output hashes and losses
- `--format obj`: named combined millimetre geometry
- `--format stl`: combined triangle surface, without instance labels or unused vertices

Without `--output`, the selected format goes to stdout. Output files must not
already exist; the command never overwrites them. Input errors print a JSON error
to stderr and exit nonzero.

The Node entry point is `mirrorReferenceLayout` in `adapter/reference-mirror.mjs`:

```js
mirrorReferenceLayout({
  layout: savedLayout,
  instance_ids: ['panel'],
  plane: { axis: 'x', position_mm: 50 },
  suffix: '-mirror'
});
```

Saved recipes additionally declare
`contract_id: "moonmold.reference-layout-mirror.v1"`. There is no new HTTP route
or operator button; use this CLI or function, then reopen its ordinary layout.

## Frame, identity and limits

The plane is in placed, right-handed world XYZ millimetres with Z-up. Source
conversion, scale, XYZ rotations, center/ground and translation happen first.
The chosen coordinate becomes `2 * position_mm - coordinate`; other coordinates
remain unchanged. Plane-coincident vertices and overlapping copies are retained.
No snapping, welding, clipping, union, deduplication or contact detection occurs.

All original instances and exact embedded sources remain in the output layout
and recipe. For each copy, the report binds the parent source hash, original
placement, input/output layout and geometry hashes, and recipe digest to the
new OBJ source hash. Local vertex and triangle order are retained, including
unused vertices; triangle corner order changes from `[0,1,2]` to `[0,2,1]`.
The correspondence is to the composed selected parent mesh, not stable IDs across
source revisions. Import losses remain separately reported for the parent.

Copies bake units, selections and placements into OBJ; object/group labels,
materials, texture coordinates and source normals do not survive. Save the
recipe and inspection report with the editable layout to retain the operation's
original lineage and losses. Editing a copied placement does not regenerate the
recipe or update its report.

At most 16 instances may exist after adding copies. Sources remain bounded at
400000 bytes per instance and the combined layout at 40000 vertices/triangles,
2000000 compact JSON bytes and 3000000 saved-layout bytes. Mirror recipe input
and output are limited to 3100000 bytes. Both the plane and every resulting
coordinate must be within ±1000000000 mm. The suffix is 1–79 ASCII letters,
digits, dot, dash or underscore; resulting instance IDs must fit 80 characters.
Reflection uses IEEE double precision and can produce rounding residuals;
a collapsed or out-of-range derived mesh is rejected.

No topology repair, watertightness, engineering adequacy, manufacturing
qualification or physical authority is implied. Focused Node API/CLI tests cover
this workflow; live Blender and browser rendering were not qualified here.
