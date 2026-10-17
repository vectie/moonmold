# Lay a picked face flat

In the operator's `/reference-layout` workbench:

1. Add or reopen a reference layout and select one instance. Apply or discard
   pending placement fields first.
2. In **Lay a picked face flat**, choose a zero-based local triangle index.
   The available range, its three local vertex indices and current XYZ
   coordinates appear below the controls. The canvas highlights that triangle
   and labels its ordered vertices A, B and C. This is a triangulated surface,
   which can be one triangle of an imported polygon, rather than the whole face.
3. Enter the desired world XY plane height in millimetres, then choose
   **Preview face placement**. The first vertex A retains its current world X/Y
   and moves to the requested Z. Edge A–B points along positive world X, and the
   triangle's winding normal points along positive world Z. The whole chosen
   instance moves rigidly; it is not squashed onto the plane.
4. Inspect the highlighted preview and height residual, then **Apply face
   placement** or **Cancel face preview**. Preview changes the canvas only;
   existing downloads and measurements still describe the applied revision.
5. Undo/Redo navigate applied placements. Save editable layout JSON to reopen
   the placement, and save the inspection report if you need the operation's
   input/output identities and numerical residual. History remains page-local.

Original source bytes, units, OBJ part/GLB node selection, uniform scale and
center/ground preference are preserved. Existing rotations are composed as
matrices, and translation compensates for grounding in the new orientation.
Unchosen instances and their vertices remain unchanged. The chosen triangle's
first vertex is the anchor, including when it is not the instance's first
vertex. Reopening the saved layout regenerates the exact geometry identities
and OBJ/STL outputs from the original source and ordinary placement recipe.

Changing triangle or height invalidates a preview. Changing selection, editing
placement fields, opening a layout, restoring history, or starting another
operation also clears it. A pending request locks conflicting operations and
suppresses repeated submission. Cancel remains available while it is pending and aborts the request;
late responses, including errors, cannot reinstate a canceled preview. Starting
face preview also discards any envelope or CSV-placement preview.

## Strict digital API

`POST /api/reference-layout/place-face` takes exactly these fields:

- `layout`: ordinary `moonmold.reference-layout.v1` editable layout
- `instance_id`: exact existing selected instance ID
- `triangle_index`: zero-based safe integer within that instance's current
  composed triangle range, after any source part/node selection
- `height_mm`: finite number in ±1e9 millimetres
- `expected_layout_sha256` and `expected_geometry_sha256`: exact current parents

The result is the usual composed layout with `face_placement`, contract
`moonmold.reference-face-placement.v1`. It binds parent and result identities,
selection, height, ordered local vertex indices, before/after coordinates,
source-preserving transforms, right-handed frame and numerical residual.
Unknown or missing fields, stale parents and invalid selections reject. No
provider or semantic scene is invoked; the route only derives digital geometry.

The direction frame rejects edges within 128 machine epsilons of the selected
coordinates' magnitude and near-collinearity with sine at most 1e-10. Source
parser, layout size, scale and coordinate limits still apply. Every chosen
vertex is checked against the intended rigid transformation after Euler and
center/ground recomposition, within a scale-aware double-precision tolerance.
A result that cannot retain the frame or fit the existing coordinate bounds is
rejected; source vertices are never flattened or overwritten to hide residuals.

This is a one-time digital placement edit. It does not establish persistent CAD
constraints, actual contact or stable support, minimum clearance, collision,
engineering accuracy, structural fitness, manufacturing or physical suitability.
It does not qualify a live Blender backend or authorize fabrication.

## Qualification

`node --test adapter/reference-face-placement*.test.mjs` covers geometry,
strict loopback HTTP, and the actual served JavaScript handlers using minimal
DOM/canvas doubles. Checks include current compound/gimbal orientations,
center/ground, reversed winding, binary originals and source selections,
unchosen geometry, malformed/numerically ambiguous requests, preview/cancel,
pending interruptions and late failures, response binding, conflicts,
Undo/Redo and save/reopen. This is Node-only evidence, not real-browser visual,
accessibility, native/MoonBit, Blender, provider or physical qualification.

PRD trace: MM-W01 (semantic request and representation lineage), MM-W02
(mock digital procedure and preview, contributing only reference-preview
interaction here), and MOONMOLD-B02 (representation truth and losses). This
narrow Node reference workflow does not claim mock semantic build/recovery,
live backend, or broader PRD completion.
