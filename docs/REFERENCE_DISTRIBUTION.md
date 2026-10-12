# Space existing references evenly between fixed endpoints

Place differently sized panels, signs or display elements with equal projected
edge gaps, without measuring and typing every translation. Choose the existing
references in their intended order along a world axis. The first and last stay
fixed, and the interior references move into the available span. Sources, units,
selections, scale, orientation and the other translation components are retained.

This is a one-time layout edit. The existing array commands create copies and
alignment moves a single reference; this operation arranges references that
already exist, including references with different geometry and dimensions.
The saved result is the ordinary editable layout, with no live constraints.

## Inspect, save and continue editing

Use Node 20+ from the repository root, with built-in modules only:

```sh
# Inspect the proposed placements and actual projected gaps first.
node bin/moonmold-reference-distribute.mjs --input fixtures/reference-distribution.layout.json --instances left,wide,tall,right --axis x --format json --output spaced.report.json

# Save the same candidate as an ordinary editable layout.
node bin/moonmold-reference-distribute.mjs --input fixtures/reference-distribution.layout.json --instances left,wide,tall,right --axis x --output spaced.layout.json

# Reopen and produce a derived sibling using existing workflows.
node bin/moonmold-reference-layout.mjs --input spaced.layout.json --format json
node bin/moonmold-reference-layout.mjs --input spaced.layout.json --format obj --output spaced.obj
node bin/moonmold-reference-drawing.mjs --input spaced.layout.json --output spaced.svg
```

The fixture's left reference occupies X = 0–10 mm and right reference occupies
120–130 mm. The two chosen interior references have widths 20 mm (originally
centimeters) and 30 mm. They move from 87 and 12 mm to 30 and 70 mm, giving three
20 mm projected gaps. The fifth reference, `unchosen`, remains at 45–50 mm even
though it overlaps a chosen reference's X range. Unchosen references are not
obstacles and no collision detection is performed.

`--instances` is an ordered comma-separated list of exact IDs, without spaces.
The list order is the desired increasing-axis order, not necessarily current
position or layout order. Reversing the interior IDs reverses their arrangement.
The first and last IDs are explicit fixed endpoints. There is no inferred
sorting, choice of anchors, or change to the saved layout's instance order.
Choose `x`, `y` or `z`; translations and reported bounds are world millimeters.

Open the saved layout in the existing `/reference-layout` operator to inspect
and continue editing each reference independently, or use the existing placement
CSV workflow. This command has no new operator button or HTTP endpoint. Save the
report beside the layout when operation lineage matters; the layout itself
stores current placements only. An old report does not update after later edits.
The CLI does not ask for approval: `--format json` computes a reviewable report,
and saving a layout is a separate invocation with the same input and options.

`--format` supports `layout` (default), `json`, `obj` and `stl`. Omit `--output`
for stdout. Output must be a new file; existing files and symlinks are never
replaced. Input is a regular local UTF-8 JSON file within 3000000 bytes. Unknown,
duplicate or missing flags and invalid requests return a JSON error on stderr
with a nonzero exit code. The candidate is completely computed and validated
before any output is written. Original inputs are not modified.

## Spacing rule

Let the first endpoint's maximum bound and last endpoint's minimum bound define
the inner span. Subtract the sum of the interior references' projected widths,
then divide by the number of gaps (chosen count minus one). That is the target
gap. Interior references are translated sequentially from the first endpoint.

At least 3 and at most 16 unique existing IDs are required. A zero gap is allowed.
If the span cannot contain the interior widths with nonnegative gaps, the whole
request rejects rather than shrinking references, moving endpoints, changing
order or allowing negative spacing. Move an endpoint farther apart or choose
fewer references, then run again. Initial positions of interior references can
be anywhere; only their final order and widths matter.

Bounds are axis-aligned envelopes of all retained placed vertices, including
unused OBJ vertices, after source-unit conversion, uniform scale, X/Y/Z rotation,
optional centering/grounding and translation. Gaps between these envelopes are
not distances between surfaces. IEEE double arithmetic can leave small residuals;
the report includes actual values and differences from the target. It does not
certify exact numerical equality or engineering tolerances. Reapplying the
simple supplied fixture is a no-op; arbitrary floating-point placements may
have tiny roundoff adjustments.

## Function and operation evidence

```js
import { distributeReferenceLayout } from './adapter/reference-distribution.mjs';
const result = distributeReferenceLayout({
  layout,
  instance_ids: ['left', 'wide', 'tall', 'right'],
  axis: 'x',
});
```

Those three fields are required and no others are accepted. The result is the
normal layout composition plus `distribution`, with contract
`moonmold.reference-distribution-operation.v1`. It records:

- Exact normalized parent and output layout/geometry SHA-256 identities
- Caller-supplied order, fixed endpoints, world axis/frame, span, total width and target gap
- Each chosen source hash, original/result transform and bounds, applied translation and minimum-bound residual
- Each adjacent pair's actual gap and residual, plus known limitations

The shared composition revalidates all source, layout, coordinate and triangle
budgets. Original OBJ part or GLB node selections and binary STL/PLY/GLB bytes
survive; source bytes are never baked or replaced. Unchosen and endpoint
normalized placements are retained exactly. Derived OBJ/STL still have their
existing representation losses; save/reopen layout JSON to retain original units,
independent placement controls and source selection. Digests identify content,
not authenticity, rights, safety or approval.

## Verification and limits

```sh
node --test adapter/reference-distribution.test.mjs
```

Nine focused tests exercise literal expected coordinates and gaps, explicit
reordering/subsets, scaled/rotated/grounded bounds on all axes, source selections
and binary bytes, independent later editing, insufficient span recovery,
retained unused vertices, deterministic repeat, and real CLI inspection/save/
reopen/export files. Tests retain their CLI evidence in the printed temporary
directory, or under an existing `MOONMOLD_DISTRIBUTION_TEST_ROOT` directory.

No dependency installation, MoonBit/native build, browser, actual operator
session, renderer, live Blender/provider, named client acceptance or physical
work was run. No persistent assembly constraint, surface clearance, collision,
fit, repair, structural analysis, dimensional certification or manufacturing
suitability is supplied; physical authority remains false.

PRD MM-W01/B02/N01 motivates bounded spatial edits with editable source, explicit
unit/frame handling and derived-output lineage. This operation does not complete
general CAD constraints, MM-W05/R01 client briefs, MM-W06/R02 digital acceptance
or R03 live-backend qualification. R50 remains the last fully verified cumulative
result; R51–55 remain separate.
