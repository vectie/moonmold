# Move and turn a chosen reference arrangement

Select several placed references and move them as one rigid arrangement around
an explicit world-space pivot. For example, turn two already spaced panels 90°
together, then move the pair elsewhere while the base stays in place. The
original bytes, source units, OBJ part/GLB node selections and uniform scales
stay intact. Save the result as the usual editable layout; every placement can
still be edited independently afterward.

This fills the gap between individual placement edits and reuse of a saved
layout: [merge](REFERENCE_LAYOUT_MERGE.md) adds saved placements with an offset;
an arrangement edit turns or moves any chosen placements that already exist.
It creates no persistent group or assembly constraint.

## Operator workflow

Start `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193` from the
source root and open `http://127.0.0.1:4193/reference-layout`.

1. Open `fixtures/reference-arrangement.layout.json`. It contains `fixed`,
   `panel` and `rear`; the latter two are differently placed/scaled cm sources.
2. In **Move or turn an arrangement together**, choose `panel` and `rear` with
   Ctrl/Command. Set the shared pivot to **10,20,5 mm**, world rotation to
   **0,0,90 degrees**, and translation to **100,-10,2 mm**.
3. Click **Move chosen arrangement**. `fixed` stays in place. The two panels turn
   around the same pivot, retaining their relative spacing. The first panel's
   corners become [160,25,7], [100,25,7], [100,-5,7], [160,-5,7] mm.
4. Save editable layout and inspection report. Prepare new OBJ/STL/GLB or SVG
   outputs as needed. Reopen the saved layout to continue editing each instance.

Pending single-placement edits must be applied or discarded first. While a
request runs, another click does not apply it again. After it finishes, clicking
again deliberately applies another move to the current placements. Keep the
original saved layout if you need to return. Changing the selected single
placement resets the multi-selection to that instance. Successful group edits
retain their chosen instance set for another move.

A successful move clears previous measurements, GLB and drawing links. Re-select
measurement endpoints and prepare new derived outputs. Invalid moves, server
errors and mismatched parent responses leave the last valid layout/downloads
intact. Closing the page does not persist anything; save files first.

## CLI

Node 20+ with only built-in modules is sufficient. No Blender, MoonBit build,
external npm dependency or sibling repository is needed.

```sh
node bin/moonmold-reference-arrange.mjs --input fixtures/reference-arrangement.layout.json --instances panel,rear --pivot-mm 10,20,5 --rotation-deg 0,0,90 --translation-mm 100,-10,2 --output turned.layout.json
node bin/moonmold-reference-arrange.mjs --input fixtures/reference-arrangement.layout.json --instances panel,rear --pivot-mm 10,20,5 --rotation-deg 0,0,90 --translation-mm 100,-10,2 --format json --output turned.report.json
node bin/moonmold-reference-layout.mjs --input turned.layout.json --format glb --output turned.glb
node bin/moonmold-reference-drawing.mjs --input turned.layout.json --output turned.svg
```

`--instances` is a comma-separated list of exact existing IDs, without spaces.
Pivot and rotation are required; translation defaults to zero. A pure move uses
`--pivot-mm 0,0,0 --rotation-deg 0,0,0`. Decimal/exponent notation is accepted;
hexadecimal, missing components, infinities and NaN reject. `--format` supports
`layout` (default), `json`, `obj` and `stl`. Omit `--output` for stdout. Output
files must not exist. Input must be strict UTF-8 JSON within 3000000 bytes.

## Fixed API

`POST /api/reference-layout/arrange` accepts exactly:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "example", "instances": [] },
  "instance_ids": ["panel", "rear"],
  "pivot_mm": [10, 20, 5],
  "rotation_deg": [0, 0, 90],
  "translation_mm": [100, -10, 2]
}
```

Replace the illustrative empty layout with a valid nonempty editable layout.
All five fields are required. The chosen IDs must be unique and present. Numeric
vectors contain three finite numbers; pivot and translation components are
bounded to ±1e9 mm. Existing layout budgets, source constraints, coordinate
bounds and noncollapsed-triangle checks apply to the complete result. Unknown
fields reject. Errors return HTTP 400; request-level errors use
`invalid-reference-arrangement`. No semantic scene or provider state changes.

The response is the usual composition result, with an `arrangement` observation
(`moonmold.reference-arrangement-edit.v1`). It records the parent and result
layout/geometry hashes, chosen IDs in layout order, pivot, world rotation,
translation and before/after placement recipes. The ordinary editable layout
stores final placements, not this operation history; retain the inspection
report when the edit recipe matters.

## Rotation, grounding and identity

For each chosen placed vertex p, the intended new position is
pivot + Rz(Ry(Rx(p − pivot))) + translation, using right-handed world XYZ axes
and degrees. Rotation is around one common pivot, not each instance's origin or
bounds center. Axes remain world-aligned through the X/Y/Z sequence.

Existing rotations are composed as rotation matrices and converted back into an
equivalent X/Y/Z Euler recipe. They are not added component by component. Euler
angles may change range or representation, especially at ±90° Y. The saved
orientation is equivalent within IEEE double precision. Pure translation or
whole-turn rotation preserves the prior Euler recipe exactly.

Source, selection, scale and `center_and_ground` are retained. For a grounded
instance, the new rotated bounds change its grounding offset; its translation
is compensated so the whole arrangement follows the intended rigid move. Thus
its translation fields may change by more than the requested world translation.
Recomposition and exports still use the original placement pipeline, with a
shared rotation implementation. No replacement mesh or baked source is made.

Unchosen normalized instances and vertices remain unchanged. Layout/geometry
hashes identify the result, and source hashes continue to identify exact
original bytes. Reopening the unchanged saved layout yields identical hashes
and derived bytes. Numeric roundoff remains possible, especially for extreme
coordinates or tiny geometry. No collision, fit, minimum clearance, topology,
engineering accuracy, live Blender, manufacturing or physical-readiness claim
is made; `physical_authority` remains false.

## Focused checks

`node --test adapter/reference-arrangement.test.mjs` covers literal expected
coordinates, compound rotations, both gimbal directions and near-gimbal cases,
16 mixed placements, grounding, source selections and binary originals,
no-op/pure translation, independent subsequent edits, repeated moves, invalid
requests, real CLI files and loopback HTTP, plus production UI handlers executed
with DOM/canvas doubles. These checks do not qualify graphical browser rendering.

For equal projected gaps between existing differently sized references, use
[equal-gap distribution](REFERENCE_DISTRIBUTION.md) with explicit fixed endpoints.
