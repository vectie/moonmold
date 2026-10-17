# Explore closed-shell volume and centroid

Open the existing `/reference-layout/` workbench and load
`fixtures/reference-volume.layout.json`. Under **Explore surface area or
closed-shell volume**, choose **Algebraic closed-shell volume and centroid**.
Select instances and calculate. The mixed fixture includes a centimetre
tetrahedron (4,000 mm³), a scaled and reversed millimetre tetrahedron (32 mm³),
and an open panel whose volume is unavailable. Selecting just the two closed
references produces a 4,032 mm³ shell sum. Each result shows its volume
centroid or the boundary/nonmanifold/inconsistent edge counts that prevent it.

Download the JSON report and CSV schedule. Save the editable layout separately.
Changing the tetrahedron scale to 2, applying it, and recalculating multiplies
its volume by 8. Original source bytes and placements remain in the saved
layout. Changing selection, measurement mode or placement clears stale
downloads; a delayed response cannot replace a newer selection.

The existing command-line measurement entry point also supports:

```
node bin/moonmold-reference-area.mjs --input fixtures/reference-volume.layout.json --measure volume --instances tetra-cm,reversed-tetra --format json --output shell-volume.json
```

Use `--format csv` for a read-only schedule; output files use exclusive creation
and cannot overwrite a prior report. Without `--measure`, area mode is unchanged.
The local operator API is `POST /api/reference-layout/volume` with only `layout`
and `instance_ids`, matching the workbench selection. Imported OBJ, STL, PLY and
GLB layouts use their existing declared-unit and placed-geometry parsers.

## What the estimate means

For each selected instance, edge matching uses exact placed vertex coordinates,
supporting repeated triangle-soup STL vertices without modifying the source.
Every edge must occur exactly twice in opposite directions. Open, nonmanifold
or inconsistently wound parts get an unavailable result. Other valid parts are
still shown; any unavailable part prevents a misleading overall total.

Each edge-connected shell uses signed tetrahedral volume and its signed volume
centroid. A whole-shell winding reversal changes its sign but not its absolute
volume or centroid. A part's reported volume is the sum of absolute algebraic
shell volumes. Reversed disconnected shells do not cancel one another.

Nested shells, overlapping geometry and coincident instances count separately.
There is no Boolean union, cavity subtraction, collision or self-intersection
test. Closed, consistently wound geometry can still self-intersect, so this is
an algebraic estimate, not proof of a solid or watertightness certification.
No density, mass, capacity, engineering fitness or manufacturing authority is
inferred. Zero/nonfinite signed volumes are unavailable. Double precision and
the source importer's triangulation and representation losses still apply.

This source-bound observation is local product functionality. It does not use
or qualify Blender. DOM lifecycle tests and local HTTP tests do not establish
real-browser rendering, live Blender recovery, installed lifecycle or release
readiness. All prior product gates and digital-only limitations remain.
