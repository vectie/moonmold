# Three-vertex angle observation

Open the reference-layout workbench, load or add references, and apply any placement
edits. In **Measure angle ABC at B**, select the instance and zero-based local vertex
index for A, B and C. B is the angle vertex. The canvas labels all valid choices,
draws B–A and B–C as selections change, and shows their placed XYZ coordinates in mm.
The canvas is projected; the measured angle is computed in three dimensions.

**Measure angle at B** returns the unsigned smaller angle (0–180 degrees), arm
lengths, exact source and placement provenance, layout/geometry hashes, and an
explicit digital-only qualification. Download the separate JSON observation. This
does not edit the saved layout, add persistent constraints, grant fabrication
or robot authority, or record a named human review.

The current composer and shared endpoint resolver are the only placement/index
implementation. Unit conversion, part selection, scale, rotation, translation and
grounding all precede measurement. Nonzero collinear arms yield 0 or 180 degrees;
coincident represented points at either arm are rejected. The implementation uses
normalized vectors and atan2 of cross magnitude/dot, including nearly parallel arms.
Source and IEEE double precision still apply. The result is not a dihedral angle,
surface normal, clearance, engineering accuracy or physical suitability assessment.

Editing placement fields immediately removes the old observation and selections,
even before Apply. Applied edits, history undo/redo, source replacement, a newly
opened layout and an emptied layout require fresh choices. Changing a choice revokes
the previous download. Late, stale or mismatched responses cannot publish a report.
A fit-envelope preview temporarily hides angle overlays, since it is unapplied;
measurement remains bound to the applied layout. Existing distance measurements and
named dimensions continue independently.

POST `/api/reference-layout/angle` accepts only `layout`, `endpoint_a`, `vertex_b`,
`endpoint_c`, `expected_layout_sha256`, and `expected_geometry_sha256`. Each selector
is exactly `{ instance_id, vertex_index }`; the layout request-size bound is reused.
The response contract is `moonmold.reference-vertex-angle.v1`. No generic executable
surface or semantic adapter schema has been added.

Qualification: Node tests execute this module, the production HTTP route and served
page listeners/canvas calls. A graphical browser, MoonBit native build and live
Blender were not run for this increment.
