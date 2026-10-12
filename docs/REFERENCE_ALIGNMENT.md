# Align imported reference placements

Arrange an imported part relative to another placed part without calculating its
rotated/scaled bounds by hand. In `/reference-layout`, **Align selected placement**
sets one world-axis minimum, center or maximum to another instance's bound plus
a signed millimetre offset. Original sources, units, named OBJ selection, rotation,
scale, grounding and other translation axes stay intact. Save and reopen the
ordinary editable layout to continue work; no persistent dependency is created.

This is a Node-only reference editing tool. It does not alter semantic operations,
call Blender, create a solid union or establish surface contact, collision freedom,
engineering fit or physical readiness.

## Operator example

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout` and load
`fixtures/reference-alignment.layout.json`. The synthetic layout contains a named
OBJ panel in cm, scaled 1.5 and rotated 90 degrees around Z, and a PLY stand in mm.

1. Select `panel`. In the alignment form, choose reference `stand`, world axis Z,
   selected anchor **Minimum**, reference anchor **Maximum**, and offset **5** mm.
   Click **Align selected**. Panel Z moves from 5 to 45 mm because stand maximum Z
   is 40 mm. The scaled/rotated panel remains 60 × 90 mm in X/Y.
2. Align its **Center** to the stand's **Center** on X, offset 0, then repeat on Y.
   Its final translation is `[40,50,45]` mm. The stand never moves.
3. Save the editable layout and reopen it. Move either instance independently;
   the other does not follow. Use Combined OBJ/STL for baked mm geometry.

The reference chooser excludes the selected instance. Alignment is available with
at least two instances, and uses the last applied placements. Apply any pending
placement form edits first. Invalid alignment leaves the previous successful
layout, preview and downloads intact. A repeated click while a request is pending
does not submit another edit. The page does not persist work: save before closing.

## CLI and API

```sh
node bin/moonmold-reference-align.mjs --input fixtures/reference-alignment.layout.json --instance panel --reference stand --axis z --moving-anchor min --reference-anchor max --offset-mm 5 --output raised.layout.json
node bin/moonmold-reference-align.mjs --input raised.layout.json --instance panel --reference stand --axis x --moving-anchor center --reference-anchor center --offset-mm 0 --output centered-x.layout.json
node bin/moonmold-reference-align.mjs --input centered-x.layout.json --instance panel --reference stand --axis y --moving-anchor center --reference-anchor center --offset-mm 0 --output aligned.layout.json
node bin/moonmold-reference-layout.mjs --input aligned.layout.json --format obj --output aligned.obj
```

The default output is the reusable layout. `--format json` produces an inspection
report with the alignment recipe; `obj` and `stl` emit derived geometry. Omit
`--output` to use stdout. Output files must be new. Input is strict UTF-8 JSON with
the existing 3000000-byte file limit. No paths, URLs or external sources are added
to the portable layout contract.

`POST /api/reference-layout/align` accepts exactly this JSON shape:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "example", "instances": [] },
  "instance_id": "panel",
  "reference_id": "stand",
  "axis": "z",
  "moving_anchor": "min",
  "reference_anchor": "max",
  "offset_mm": 5
}
```

Replace the placeholder `layout` with a valid populated layout, such as the
fixture. Both IDs must exist and differ. `axis` is `x`, `y` or `z`; each anchor is
`min`, `center` or `max`. The offset is required, finite and within ±1e9 mm.
The response is the existing `moonmold.reference-layout-result.v1` plus an
`alignment` operation record. Invalid requests return HTTP 400 with a useful
message. Sources are embedded and recomposed in memory; server state is unchanged.

The translation formula is:

`delta = reference_anchor_world_mm + offset_mm - moving_anchor_world_mm`

Only the moving instance's chosen `translation_mm` component gets that delta.
Positive offset always means the positive world-axis direction, independent of
which anchors you choose. To place on the positive X side, align moving min to
reference max with a positive offset. For the negative X side, align moving max
to reference min with a negative offset. Center uses `(min + max) / 2`.

## Evidence and limits

The operation record includes parent normalized layout SHA-256, both instance IDs,
axis, anchors, requested offset, translation delta, before/reference/desired/after
anchor positions, actual signed offset and residual. `residual_mm` is actual
offset minus requested offset, so a tiny requested offset lost at large coordinates
remains visible. IEEE double precision applies; zero residual is not a surface-
contact proof. Save the inspection report if the operation recipe matters: the
editable layout preserves the resulting transform, not an operation history.

The result preserves original source bytes, source units, hashes and selected OBJ
face lineage. It uses axis-aligned bounds after unit conversion, scale, X/Y/Z
rotation, optional center/ground and translation. Those bounds include all retained
vertices, including unused ones. Named OBJ selection first removes unselected faces
and unused vertices. A bounding face is not necessarily a model surface; a positive
offset between chosen anchors is not a minimum distance between meshes.

Existing limits remain: 16 instances, 400000 source bytes per instance, 2000000
compact layout bytes, 40000 combined vertices and triangles, coordinates ±1e9 mm.
Recomposition enforces these limits and rejects collapsed or out-of-range geometry.
No tolerance snapping, welding, constraint solver, rotation fitting, mesh repair,
collision test, manufacturing certification or fabrication is provided.

Run `node --test adapter/reference-alignment.test.mjs` for focused verification or
`node --test adapter/reference-*.test.mjs` for the complete Node-only reference
suite. Tests exercise real CLI files, loopback HTTP, save/reopen and the actual
served JavaScript handlers with DOM/canvas doubles. They do not qualify browser
rendering, MoonBit native, live Blender or physical use.
