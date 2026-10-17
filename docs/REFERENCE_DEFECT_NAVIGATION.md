# Locate reference defect edges

PRD MM-W01: traverse a derived sibling back to its exact source, declared units,
placement and losses. This is bounded reference analysis, not model repair.

## Operator journey

1. Start the existing operator with `npm run operator` and open `/reference-layout`.
2. Try `fixtures/reference-defects.layout.json` for closed, open, winding and
   nonmanifold examples. Open an editable layout or import supported OBJ/STL/PLY/GLB references. Apply
   placement edits, then choose the retained instance in the existing selector.
3. In **Locate defect edges in selected instance**, press **Locate boundary /
   nonmanifold / winding edges**. Orange marks boundary edges, purple marks more
   than two triangle uses, and blue marks two uses with the same direction.
4. Choose an edge ID. Its line becomes white in the existing orbit/top view and
   its incident triangles, local vertices, placed endpoints and source digest are
   displayed. Rotate the view to disambiguate coincident 2D projections.
5. Download annotated SVG and JSON, and save the editable layout separately.
   The shared three-view drawing shows E-number labels and a readable locator
   ledger; metadata binds full layout/geometry hashes, selected source hash,
   source units, placement, import losses and every incident use.
6. In the original modeling tool, reopen the matching source. For OBJ, use the
   original source line, zero-based face index and one-based OBJ vertex numbers.
   Selected OBJ objects/groups retain original numbering even after remapping.
   Correct the original there, replace its source in the layout and recalculate.
   This feature never changes or repairs the source.

OBJ is the original-face-locator workflow. STL/PLY/GLB show retained triangle and
vertex indices only; original face mapping is explicitly unavailable, including
in SVG. Do not treat these indices as original-tool face IDs. Original OBJ
triangulation diagonals can be involved; multiple incident triangles can map to
one original polygon. Exact coordinate incidence joins equal positions only for
observation, including STL triangle soup; no saved topology is welded.

## Bounds and behavior

`POST /api/reference-layout/defects` accepts only `{layout, instance_id}`. The
existing parser/composer enforces explicit units and supported formats, 1–16
instances, 40,000 combined vertices/triangles and 2,000,000 compact layout bytes.
The request limit is 3,100,000 bytes. Navigation is limited to 256 defective edges
and 4,096 incident uses. The output limit is 1,000,000 JSON and 4,000,000 SVG bytes.
An over-limit selection fails with an actionable message, never silent truncation.
Isolate smaller source selections in the original modeling tool when needed.

Selection changes, edits, apply/reopen, undo/redo and removal clear observations
and revoke downloads. Busy repeat clicks are inert. Pending placement edits
invalidate in-flight results. Failed or mismatched responses cannot replace a
valid displayed observation. A source-only revision changes source/layout binding
although its geometry hash can remain the same.

Zero defects is not certification. Exact floating-point placed-coordinate
matching has no tolerance, collision, self-intersection, near-gap, manifold-vertex,
Boolean or physical suitability analysis. A closed mesh may still be invalid.
All edges, including hidden edges, are shown; projection overlap is not contact.
SVG is auto-fitted, not a print-scale or fabrication template. Keep source/layout
JSON; SVG contains no original source bytes or editable model.

## Verification scope

`node --test adapter/reference-defects*.test.mjs` runs incidence/locator bounds
and the actual operator HTTP route with the served production page script and
DOM/canvas doubles. It checks selected-edge drawing calls and exact downloaded
SVG/JSON. This is not graphical browser, native MoonBit, live Blender, installed
lifecycle, customer acceptance or manufacturing qualification. Broader unrun
release gates remain blocking. No native source/build inputs were changed.
