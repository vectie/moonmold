# Register two references with three vertex pairs

Open the operator's `/reference-layout` workbench. This workflow edits ordinary
reference placements and needs only its Node operator, not Blender or MoonBit.

1. Add two reference meshes (choose their source units explicitly), import a GLB
   scene, or reopen an editable layout. Select the reference that should move.
   Apply or discard pending placement fields first.
2. In **Register two references with three vertex pairs**, choose the fixed
   reference. Enter three corresponding zero-based local vertex indices on each
   reference, in the same order. Each pair is an explicit correspondence:
   moving 1 to fixed 1, moving 2 to fixed 2, moving 3 to fixed 3.
3. Check the available index ranges and placed XYZ coordinates. The canvas
   labels the selected vertices M1–M3 and F1–F3. Indices are from the current
   imported/part-selected vertex order, including retained unreferenced vertices.
   STL often repeats vertices; choose geometrically distinct points. Each triple
   must be non-collinear and numerically well resolved.
4. Choose **Preview rigid registration**. Only the selected moving reference
   rotates and translates. The canvas shows the candidate and residual lines;
   the report shows all three signed XYZ residuals and distances, RMS distance,
   and maximum distance. Current downloads still describe the applied revision.
5. Choose **Apply registration** or **Cancel registration preview**. Apply is
   single-use. Undo/Redo restores applied placements. Save editable layout JSON
   for reopening and further edits, and save the inspection report to retain
   this registration's exact parents, correspondences and residuals. History is
   page-local; reopening a layout reconstructs geometry, not historical reports.

The method minimizes the sum of squared distances across the three ordered
pairs using a proper (determinant +1) rigid rotation and centroid translation.
It never fits scale or reflection. Unequal triangle edge lengths cannot all
match, so nonzero residuals are expected. A zero three-point residual does not
prove whole-mesh agreement, source accuracy, a physically valid fit, or correct
correspondences. In particular, a mirrored solid may match the three selected
planar vertices through a proper rotation while its other vertices do not fit.

Original source text/base64 bytes, source units, part/node selections, uniform
scales, center/ground preferences and every other instance remain unchanged.
Existing rotations are composed as matrices and translated to compensate for
center/ground after the new rotation. Saved layout JSON uses the unchanged
layout schema. OBJ/STL remain derived baked-geometry exports with their existing
loss reports, rather than a substitute for the editable source.

Changing a vertex, fixed reference, selected instance, placement fields or
applied revision invalidates the candidate. Starting another operation clears
it, and registration clears competing face, envelope and CSV previews. While
waiting, repeated/conflicting operations are locked; Cancel aborts the request.
Late success or failure cannot revive invalidated preview ownership. The UI
checks parent/result identities, correspondences, preserved layout/source data,
proper rotation, resulting vertices and reported residuals before enabling Apply.

## Strict digital API

`POST /api/reference-layout/register-vertices` accepts exactly:

- `layout`: `moonmold.reference-layout.v1`
- `moving`: `{ "instance_id": "moving-id", "vertex_indices": [0, 1, 2] }`
- `fixed`: `{ "instance_id": "fixed-id", "vertex_indices": [4, 7, 2] }`
- `expected_layout_sha256` and `expected_geometry_sha256`: both exact parents

Moving and fixed must identify different instances. Each ordered index list
contains exactly three distinct safe integers in that current instance's vertex
range. Unknown or missing fields, stale parents and unsupported geometry reject.
Request bodies and layouts retain the operator/composer's existing size limits.

The response is the ordinary composed layout with a `registration` report,
contract `moonmold.reference-registration.v1`. It includes exact source-bound
endpoints, both parent/result identities, before/after transforms, world rotation
and translation, source/target centroids, edge lengths and per-pair residuals.
The stable map is `target_centroid + R * (point - source_centroid)`; a world
translation is also reported for inspection. Report `numerical_tolerance_mm` is
an internal floating-point recomposition check, not a requested fit tolerance
or a source/engineering accuracy guarantee. No residual acceptance threshold or
persistent CAD constraint is inferred.

The centered triangles are expressed in ordered right-handed plane frames.
Their two-dimensional covariance has positive determinant, so the rank-two
proper Procrustes/Kabsch solution is the in-plane angle from its cross/dot sums;
both normals are mapped consistently. The input guard rejects lengths or
triangle altitudes within 128 machine epsilons of the chosen coordinate
magnitude, and directional sine at most 1e-10. After Euler/grounding conversion,
every moving vertex is checked against the intended rigid map. Unsupported
coordinate bounds or inaccurate recomposition reject without altering source.

## Evidence and limits

`node --test adapter/reference-registration*.test.mjs` exercises geometry,
strict loopback HTTP, and actual served production JavaScript with DOM/canvas
doubles. It covers equal/unequal triangles, ordered pairs, determinant and
handedness, binary/part/GLB sources, current rotations and grounding, tiny and
large coordinates, degenerate inputs, per-pair/RMS residuals, preview ownership,
late callbacks, cancellation, repeated clicks, competing workflows, applied
history, saved exports and editable reopen. The round's external focused runner
also checks adjacent reference workflows, filtering disk-heavy CLI tests.

These are Node-only bounded development checks. Full `npm test`, MoonBit
format/info/check/all-target tests, real-browser visual/accessibility QA, live
Blender, installed-host, provider and physical qualification are unrun release
gates. No native/compiler/dependency build, deployment or physical action occurs.

PRD grounding: MM-W01 and MOONMOLD-B02 (source-preserving reference lineage),
MM-W02 (the narrow preview interaction only), and MOONMOLD-B09 (digital authority
ceiling). This does not complete semantic build/recovery, full CAD, live backend,
named client review, manufacturing or broader PRD acceptance.
