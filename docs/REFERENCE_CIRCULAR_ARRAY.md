# Make an editable circular reference array

Repeat one placed reference around a declared world-axis line. A circular array
turns both its position and orientation; this makes radial panels, spoke-like
layouts or repeated display elements without calculating each placement by hand.
The existing Cartesian array only changes translations. This command preserves
the original reference and appends ordinary, independently editable copies.

## Example: four radial display panels

Use Node 20+ with built-in modules only, from the repository root:

```sh
node bin/moonmold-reference-circular-array.mjs \
  --input fixtures/reference-circular-array.layout.json --instance panel \
  --axis z --pivot-mm 10,20,5 --step-deg 90 --count 4 \
  --output radial.layout.json
```

The existing base stays in place. The selected centimeter panel already has a
0.5 scale, 90-degree X rotation, center/ground preference and translation. Its
first corner is [60,20,5] mm. The three appended copies' first corners are
[10,70,5], [-40,20,5] and [10,-30,5] mm. They face successively around the same
world Z line through [10,20,5], rather than around their own source origins.

`--count 4` includes the original at zero degrees: this adds three copies at 90,
180 and 270 degrees. For a full ring use 360/count degrees; for an arc choose a
smaller step. A negative step turns the other way using the right-hand rule.
Count is 2–16 and the complete output layout may contain no more than 16
instances, including unchosen references. Copies use the next available IDs
`circular-1`, `circular-2`, etc., skipping existing IDs without replacing them.

## Save, inspect and continue editing

Run the same command with `--format json --output radial.report.json` to save
the operation inspection report. With the identical input and options, output
is deterministic. Use `--format obj` or `--format stl` for derived geometry.
The supported formats are `layout` (default), `json`, `obj` and `stl`.

Reopen the saved layout through the usual CLI or reference-layout operator:

```sh
node bin/moonmold-reference-layout.mjs --input radial.layout.json --format json
node bin/moonmold-reference-layout.mjs --input radial.layout.json --format obj --output radial.obj
node bin/moonmold-reference-layout.mjs --input radial.layout.json --format stl --output radial.stl
```

Each saved instance has its own source and transform. Change a copy's
translation, rotation or scale and save a new layout to revise just that copy.
No live pattern dependency or hidden group is created. Re-running this command
on an already expanded layout deliberately adds another set of copies. Keep the
original input if you want to change the pattern from its starting point.
An old report identifies the pre-edit result; it does not update after edits.

Output files must be new. Omit `--output` to write to stdout. Failed requests
print a JSON error on stderr and exit nonzero. Input must be strict UTF-8 JSON
within 3000000 bytes. Decimal and exponent notation work; blank components,
hexadecimal, infinities and NaN reject. Unknown or duplicate flags reject.

## Function and operation lineage

```js
import { circularArrayReferenceLayout } from './adapter/reference-circular-array.mjs';
const result = circularArrayReferenceLayout({
  layout, instance_id: 'panel', axis: 'z', pivot_mm: [10,20,5],
  step_deg: 90, count: 4,
});
```

All six fields are required; unknown fields reject. `axis` is exactly `x`, `y`
or `z`. The pivot contains three millimeter coordinates within ±1e9. The step
must be finite, nonzero and strictly between -360 and 360 degrees. Total sweep
may exceed one turn. Coincident copies, including a final whole-turn copy, are
kept; this command does not infer clearances or remove overlaps.

The result is the ordinary layout composition plus `circular_array`, with
contract `moonmold.reference-circular-array-operation.v1`. It records parent and
output layout/geometry hashes, template ID and original source digest, frame,
axis, pivot, step, count and every generated ID, index, angle and placement.
The editable layout stores placements only. Keep the report with the saved
layout when operation lineage matters. Existing per-part losses are retained.

Every original normalized instance stays unchanged. Copies retain exact embedded
OBJ/STL/PLY/GLB bytes, declared source units, selected OBJ parts or GLB nodes,
uniform scale and center/ground preference. No baked replacement source is made.
Every copied vertex obeys pivot + R_axis(index × step) × (original − pivot).
World rotations use the existing arrangement operation and rotation matrices,
not component-wise Euler addition. Each copy starts from the original placement.
Center/ground translations are compensated to keep this rigid world motion.

## Boundaries

The frame is right-handed world XYZ, Z-up, in millimeters. Angles are degrees.
Floating-point and equivalent Euler-angle decomposition can leave small rounding
residuals. Layout/source byte limits and the combined 40000 vertex/triangle limit
still apply; resulting out-of-range or collapsed triangles reject atomically.
OBJ/STL bake placements to millimeters; STL loses instance labels and unused
vertices. Reopen layout JSON to retain editable original units and selections.

This is a CLI/function workflow. There is no new operator button, HTTP route,
browser-rendering qualification, Blender execution, topology repair, welding,
union, collision check, manufacturing claim or physical authority.

Focused checks: `node --test adapter/reference-circular-array.test.mjs`. CLI
fixtures and attempts are retained under `MOONMOLD_CIRCULAR_TEST_ROOT`, or the
default temporary directory. No test teardown deletes them.
