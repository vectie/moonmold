# Ordered placed-reference vertex paths

In the reference-layout operator, **Measure an ordered vertex path** appends
selected instance/local-vertex pairs in the order the operator chooses. Select a
zero-based local vertex, click **Append vertex**, and repeat. The displayed list
and orange canvas labels preserve that order, including repeated points. Remove
the last point or clear the list to revise it. Choose 2–64 endpoints. Optional
**Close with a last-to-first segment** adds exactly one final segment.

**Measure ordered path** reports each straight 3D segment length and its running
cumulative length in millimetres, followed by the total. The canvas is only an
orthographic projection. This is a descriptive digital inspection: segments may
cross empty space or connect different references. It is not a surface/geodesic
measurement, shortest route, mesh edge traversal, engineering validation,
clearance or physical-suitability evidence. Repeated or coincident consecutive
points contribute zero; a repeated first point plus closure produces an explicit
zero-length closing segment. Nothing is deduplicated, sorted or welded.

Download the separate `*.path.json` observation and save editable layout JSON too.
The observation retains full layout/geometry identities, every ordered endpoint's
source digest, source format/units, selected-part original vertex index when
applicable, placed XYZ, placement recipe and losses. It also records ordered
segment endpoint indices, signed XYZ deltas, lengths, cumulative lengths, closure,
frame, transform order and `physical_authority: false`. It contains no original
source files and does not change the saved layout schema or record human review.

Reopen the editable layout first, then use **Reopen matching path choices** with
the observation JSON (maximum 1000000 bytes). The operator validates it against
the exact applied layout, geometry, endpoint provenance and recomputed lengths.
The exact pretty-printed JSON plus its final newline is byte-checked before export
under the same 1000000-byte limit, and selected-part provenance is retained for
every endpoint. This includes the valid maximum of 256 OBJ part occurrences and
64 ordered endpoints. Only the ordered choices and closure are restored; measure again to obtain a new
download. Even a source comment or layout-name edit invalidates an old observation
when geometry stays identical. Source/placement edits, undo/redo and layout load
or removal clear choices and downloads. Unapplied placement fields invalidate
observations immediately; apply or discard them before selecting a fresh path.
Changing closure or a vertex selector revokes the previous download. Repeated
submits are blocked; interrupted, failed, stale or mismatched responses cannot
publish an observation. Unapplied placement previews hide path overlays.

## API and bounded semantics

POST `/api/reference-layout/path` accepts exactly:

- `layout`: the existing editable reference layout
- `endpoints`: 2–64 ordered `{ instance_id, vertex_index }` objects
- `closed`: optional boolean, default false
- `expected_layout_sha256` and `expected_geometry_sha256`: current composition
  identities required for every observation

The response contract is `moonmold.reference-vertex-path.v1`. Indices on endpoints
and segment records are zero-based. Open paths have N−1 segments; closed paths
have N. Cumulative length includes its own segment, starting from zero before the
first segment. Per-point and segment ordering survives JSON round trips.

`composeReferenceLayout` is the only placement implementation, and
`resolveReferenceEndpoint` supplies the same provenance/index extraction as
existing distance and angle observations. Unit conversion, uniform scale,
rotation, grounding and translation happen before measurement. Part-selected
indices address the current compacted order; retained unreferenced vertices and
per-triangle duplicated STL vertices remain valid choices. Lengths use
`Math.hypot` on placed-coordinate differences and IEEE double accumulation.
Source precision and cancellation at extreme translations apply. Zero length can
reflect represented precision and is not proof of physical coincidence.

The existing 3000000-byte HTTP body limit and the composer's 2000000-byte compact
layout, 16-instance and 40000-vertex/triangle limits remain enforced. No semantic
operation, shell surface, generic execution API or physical command is added.

## Qualification

This is narrow progress on MM-W01 digital representation lineage and
MOONMOLD-B02 representation truth, N01 unit/frame integrity, N04 resource bounds
and N05 review legibility in `prd_work/content/moonmold.json`. It does not complete
those PRD requirements, a named review/client acceptance, live Blender
qualification, parametric CAD or physical readiness.

Focused Node tests cover 3/4/5 segments, closure, order/repeats, transforms,
part-selected indices, stale layout/geometry, invalid inputs, real HTTP, served
production UI listeners/canvas calls and saved-layout/observation JSON reopen.
UI tests use DOM/canvas doubles and are not graphical-browser qualification.
No MoonBit build, live Blender, external provider or hardware runs are claimed.

```sh
node --test adapter/reference-path.test.mjs adapter/reference-path-ui.test.mjs
```
