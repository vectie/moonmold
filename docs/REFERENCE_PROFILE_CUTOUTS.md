# Editable profile with one polygon cutout

Use `/reference-profile` to author a plate or bracket reference with a through
opening. This extends the existing profile authoring, export and layout workflow;
it does not add a CAD boolean engine or an external backend. One optional simple
polygon cutout must lie strictly inside one simple outer polygon. Either ring
may be concave and may be authored in either winding direction.

The intent follows MM-W01 and MOONMOLD-B02: retain editable dimensions, units,
frame and exact source identity while deriving inspectable mesh siblings with
explicit losses. A plausible plate is not engineering or fabrication evidence.

## Try the complete workflow

1. Start the existing operator with `node bin/moonmold-operator.mjs --workspace
   "$PWD" --port 4193`, then open `http://127.0.0.1:4193/reference-profile`.
2. Click **Load plate with opening example**, then **Build reference mesh**.
   The example matches `fixtures/reference-cutout.profile.json`: outer 40 × 30 mm,
   inner 20 × 10 mm, height 8 mm. The build has 16 vertices, 32 triangles, outer
   area 1200 mm², cutout area 200 mm² and net profile area 1000 mm². The cap
   triangulation goes around the opening; an inward-facing wall bounds it.
3. In **Optional cutout XY points**, change the opening to
   `[[8,10],[32,10],[32,20],[8,20]]`; set height to 12 and build. Net area becomes
   960 mm² and bounds become 40 × 30 × 12 mm. Outer points can be edited too.
4. Save the editable profile, derived layout, OBJ, STL and lineage report.
   Reopen the profile here to recover both point editors, units and height.
   Clear the cutout field or enter `null` and rebuild to remove the opening.
5. Open the saved layout in `/reference-layout`, select the plate under
   **Explore surface area or closed-shell volume**, choose volume, then calculate.
   The original plate reports an algebraic shell volume of 8000 mm³; the revised
   opening/height reports 11520 mm³. These are descriptive digital observations.
6. Apply an ordinary placement translation, save that layout and reopen it.
   The opening persists in the embedded geometry. A translation preserves the
   reported volume; any placement change invalidates the prior measurement so
   calculate again. Keep the profile separately: layout edits do not update it.

Example loading and typing are draft edits until a successful build. Preview and
downloads keep the last successful build and are labeled accordingly. Invalid
opening edits or file opens preserve the existing artifacts; **Restore last built
fields** restores both rings and height. Late responses cannot overwrite newer
cutout edits. No automatic persistence occurs: save before closing the page.

DXF import remains single-outline intake. It replaces the current outer outline
and opening. Add a cutout after importing; no drawing hole inference is claimed.

## Portable v2 recipe

```json
{
  "contract_id": "moonmold.reference-profile-extrusion.v2",
  "name": "plate-with-opening",
  "units": "mm",
  "coordinate_frame": "xy-z-up",
  "vertices": [[0,0],[40,0],[40,30],[0,30]],
  "height": 8,
  "cutout": [[10,10],[30,10],[30,20],[10,20]]
}
```

All seven fields are required. `cutout` is one point array or `null`; it is not an
array of rings. Unknown fields reject. The existing v1 contract stays unchanged
and rejects cutout fields. A v2 recipe with `cutout: null` stays v2 on save/reopen.
The editor continues writing v1 for existing single-ring profiles until an
opening is authored. There is no code, URL, resource path or expression surface.

Use the existing CLI and endpoint; no new command is required:

```sh
node bin/moonmold-reference-extrude.mjs --input fixtures/reference-cutout.profile.json --format recipe --output plate.profile.json
node bin/moonmold-reference-extrude.mjs --input plate.profile.json --format layout --output plate.layout.json
node bin/moonmold-reference-extrude.mjs --input plate.profile.json --format obj --output plate.obj
node bin/moonmold-reference-extrude.mjs --input plate.profile.json --format stl --output plate.stl
node bin/moonmold-reference-extrude.mjs --input plate.profile.json --format json --output plate.result.json
node bin/moonmold-reference-area.mjs --input plate.layout.json --measure volume --output plate.volume.json
```

Output paths must be new; existing files are never overwritten. `POST
/api/reference-profile/extrude` accepts either recipe version and returns the
existing composed layout result plus the versioned extrusion report and editable
recipe export. Requests/files remain limited to 32000 UTF-8 bytes. HTTP malformed
or unsupported profiles return 400 without creating applied geometry.

## Bounds, triangulation and rejection

- Each ring has 3–128 finite XY vertices, at most 256 total, with implicit closure
  and no repeated point. XY coordinates are within ±1000000 mm after conversion.
  Height is 0.000001–1000000 mm. Explicit `mm`, `cm`, `m` or `in` applies to both
  rings and height. The XY base is Z=0; extrusion is toward +Z; output is mm.
- Reject self-crossings, nonadjacent touches, repeated or collinear corners,
  outer/cutout contacts or intersections, outside cutouts and numerical ambiguity.
  A cutout spanning a concave outer gap rejects even if all its vertices are
  inside. No snapping, repair, winding edits to the saved source or inferred
  additional vertices occur.
- Binary64 orientation uses a span² × 1e-12 ambiguity band across the rings.
  This is a rejection guard, not a certified tolerance or exact-predicate promise.
  Valid shapes too close to this band may be refused. The triangulator tries at
  most eight deterministic visible vertex bridges before refusing an ambiguous
  decomposition. This bounds retries; it does not promise every mathematically
  valid simple polygon is accepted.
- A visible bridge joins outer CCW and cutout CW traversals for ear clipping.
  Bridge endpoints reuse their authored indices, and the bridge is not a side
  wall. Before returning, caps are checked for net area, original boundaries,
  opposite internal edges, noncrossing cap edges and centroids in the material.
  The existing mesh importer also revalidates emitted triangles.
- With a cutout and N total points there are N triangles per cap and 2N wall
  triangles, 4N triangles total. Without a cutout the existing N−2 triangles per
  cap remain. Outer walls face outward and cutout walls face into the opening.
- Multiple openings, islands, curved boundaries, bevels, arbitrary solid
  subtraction, constraints, persistent feature history and fabrication are out
  of scope. DXF import does not infer cutouts from multiple entities.

## Identity and losses

The v2 report uses `moonmold.reference-profile-extrusion-report.v2`. It retains the
complete recipe, canonical recipe SHA256, output layout/geometry SHA256, authored
outer/cutout winding, height, outer area, cutout area and net `profile_area_mm2`.
The net area means outer minus cutout, not the bounding-box area.

Flattened profile indices first enumerate authored outer points, then cutout
points. Bottom mesh vertices follow that order; top vertices have an offset of N.
`profile_vertex_lineage` maps each flattened index to `{ring, vertex_index}`.
Cap `profile_vertex_indices` and wall `profile_edge` refer to those flattened
indices. Wall lineage also labels `ring` as `outer` or `cutout`. The recipe keeps
the user's original order; normalization is only for outward mesh winding.

OBJ comments identify the recipe hash. Ordinary OBJ/STL/layout siblings contain
triangles and do not retain point-editor semantics. Retain the recipe and report
to inspect their derivation. Editing either ring or height yields a new recipe
and geometry identity; old downloads remain independent snapshots. A later layout
placement is a separate derivative and must be remeasured. The original extrusion
report does not certify that later derivative.

This is bounded digital reference geometry. There is no engineering CAD,
dimensional-tolerance guarantee, material behavior, qualified live Blender,
customer acceptance, manufacturing certification or physical authority.

## Focused checks

```sh
node --test adapter/reference-extrusion.test.mjs adapter/reference-extrusion-cutouts.test.mjs adapter/reference-extrusion-ui.test.mjs adapter/reference-dxf-profile.test.mjs
```

Independent test oracles check cap/net area, signed volume, outward wall winding,
opposite directed edge pairs and Euler characteristic. Cases include concavity
in both rings, each winding, units, translation, min height, 128+128 points,
source revisions, malformed and ambiguous inputs, CLI files and loopback HTTP.
The unmodified profile and layout page scripts run in DOM/canvas doubles: load
sample, edit both rings/height, preserve failed drafts, save/reopen profile, load
the generated layout, measure volume, edit placement, save and reopen again.
These are production-handler functional checks, not graphical browser or
screenshot qualification. Broader live Blender/release gates remain separate.
