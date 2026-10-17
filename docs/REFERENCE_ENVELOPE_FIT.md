# Fit a reference into a world-axis size envelope

In the operator's `/reference-layout` workbench:

1. Add or reopen a reference layout, select an instance and apply or discard pending placement fields.
2. Enter positive world X, Y and Z limits in millimetres in **Fit selected reference inside a size envelope**.
3. Leave enlargement off to shrink only, or opt in to scale up to the largest proportional fit.
4. Preview the new geometry inside the blue envelope. Inspect the before/after sizes and remaining space. Downloads, measurements and editable source still describe the applied revision.
5. Apply to change the selected placement, or cancel to return the canvas to the applied geometry. Undo/Redo work as for other placement edits. Save editable layout JSON to reopen it later.

The fit uses the placed world-axis bounding box, including rotated geometry and unreferenced vertices. It preserves current bounding-box center, rotation, proportion, source units/bytes, and center/ground preference; translation compensates for scaling. Other instances are unchanged. For planar inputs, the zero-width dimension does not constrain uniform scale. All three requested envelope dimensions must still be positive. Existing scale, coordinate, mesh-size and layout limits continue to apply.

Changing envelope fields, selection, placement or the applied revision invalidates the preview. Repeated submissions are suppressed while calculating; stale or mismatched responses cannot be applied. Failures retain the last applied layout and its downloads. An applied inspection report contains the fit's parent/current identities and achieved dimensions; the editable layout contains ordinary source-preserving transforms, not a persistent constraint.

API: `POST /api/reference-layout/fit-envelope` takes exactly `layout`, `instance_id`, `size_mm` (three positive finite numbers, each at most 1e9), `allow_enlarge` (boolean), `expected_layout_sha256`, and `expected_geometry_sha256`. The response uses the existing composed layout result plus `envelope_fit` (`moonmold.reference-envelope-fit.v1`). Source frame remains unchanged; the envelope is world XYZ in millimetres.

This is a bounded one-time reference placement edit. It does not solve persistent CAD constraints, detect collision or clearance, certify tolerances or structural fitness, or authorize fabrication. No Blender or physical-device execution is involved.

Validation: `node --test adapter/reference-envelope-fit*.test.mjs`. Tests exercise production UI handlers and canvas commands in a minimal DOM harness, actual HTTP requests, numerical transformations, source persistence and interruptions. This is not a real-browser or live-provider qualification.
