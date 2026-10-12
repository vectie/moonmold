# Reuse a saved reference arrangement

Merge one saved editable layout into another without flattening the originals or
rebuilding their placements. Every incoming instance remains independently
editable. Its ID becomes `prefix.original-id`; a single explicit world-axis
millimetre translation moves the entire imported arrangement. The current layout's
name, existing instances and placements stay unchanged.

This completes a practical reuse loop: arrange references once, save that layout,
merge it beside another arrangement, inspect the combined geometry, then save and
reopen the combined editable layout or export existing OBJ/STL/GLB/SVG siblings.
No external file links are retained. Updating either original file later does not
change the merged result.

## Operator workflow

Requires Node 20+ and built-in modules only:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `/reference-layout` and use **Open layout** to load
`fixtures/reference-merge-base.layout.json`. Under **Merge a saved arrangement**:

1. Choose `fixtures/reference-merge-incoming.layout.json`.
2. Enter ID prefix `left` and world offsets X=30, Y=40, Z=10 mm.
3. Click **Merge saved arrangement**. The original `panel` stays in place;
   `left.panel` and `left.rear` append in the incoming layout's saved order.
4. Save the editable layout and optional inspection report. Prepare a new drawing
   or GLB for inspection in other tools. Reopen the saved layout to keep editing.
5. To reuse the same arrangement again, choose the file again and another prefix,
   such as `right`, with its own offset. Reusing a colliding prefix fails instead
   of silently renaming or replacing an instance.

The fixture's current base spans 160 × 120 mm at Z=0. The two incoming panels are
in centimetres, with independent scale and rotation; one uses center/ground.
After merging, `left.panel` bounds are [25,10,15] to [55,70,15] mm, and
`left.rear` bounds are approximately [50,80,18] to [70,90,18] mm. Combined bounds
are [0,0,0] to [160,120,18] mm. Original CRLF source text remains byte-exact.

Merge is disabled when the current layout is empty, while an operation is busy,
or when placement fields contain unapplied edits. Apply or discard those edits
first. A failure keeps the last successful composition and downloads intact.
Repeated clicks while waiting submit only once. Successful merging clears old
measurements, drawings and GLB links; regenerate them for the new composition.
The server does not persist the layout. Save a download before closing.

## CLI

```sh
node bin/moonmold-reference-merge.mjs --input fixtures/reference-merge-base.layout.json --incoming fixtures/reference-merge-incoming.layout.json --prefix left --translation-mm 30,40,10 --output combined.layout.json
node bin/moonmold-reference-merge.mjs --input fixtures/reference-merge-base.layout.json --incoming fixtures/reference-merge-incoming.layout.json --prefix left --translation-mm 30,40,10 --format json --output combined.merge.json
node bin/moonmold-reference-layout.mjs --input combined.layout.json --format obj --output combined.obj
node bin/moonmold-reference-drawing.mjs --input combined.layout.json --output combined.svg
```

`--translation-mm` defaults to `0,0,0`. Values are signed decimal numbers, optionally
with exponent notation, separated by commas. Prefix is required. Default `layout`
output is the reopenable source. `json` includes the merge record and inspection;
`obj` and `stl` export derived geometry. Omitting `--output` prints to stdout.
Output files must be new. Unknown and repeated flags reject. Both input files
must be strict UTF-8 JSON, each at most 3000000 bytes.

## API and source preservation

`POST /api/reference-layout/merge` takes exactly these fields:

```json
{
  "layout": { "contract_id": "moonmold.reference-layout.v1", "name": "current", "instances": [] },
  "incoming_layout": { "contract_id": "moonmold.reference-layout.v1", "name": "incoming", "instances": [] },
  "id_prefix": "left",
  "translation_mm": [30, 40, 10]
}
```

Replace both illustrative empty instance lists with valid populated layouts.
Unlike the CLI, the API requires the translation. Each component must be finite
and within ±1e9 mm. IDs are exactly `id_prefix + "." + incoming ID`, with no
trimming, truncation or collision suffix. The prefix follows the existing
alphanumeric/dot/dash/underscore convention, starting alphanumeric. Resulting IDs
must be unique and at most 80 characters. The result uses the ordinary
`moonmold.reference-layout-result.v1` contract plus a `merge` record.

Both inputs are normalized through the existing composer. Incoming translation
components get the common offset added; original source bytes and format, units,
OBJ part/GLB node selections, scale, X/Y/Z rotation and center/ground are retained.
The common offset is applied last in world mm, so center/ground remains per source
and relative placements are preserved. There is no second mesh transformation
implementation. The result is recomposed and validated before being returned.

Existing combined limits apply: 16 instances, 400000 bytes per original source,
2000000 compact JSON bytes, 3000000 saved-layout bytes, 40000 vertices and triangles,
and coordinates within ±1e9 mm. The HTTP request containing both layouts is also
limited to 3000000 bytes. Pretty-print whitespace can make an HTTP request exceed
that limit even when its normalized output would fit. Invalid requests return
HTTP 400; no partially merged layout or server-side mutation is produced.

## Reports and limitations

The inspection result's `merge` record contains both normalized input layout and
geometry SHA-256 identities, the incoming name, prefix, world offset, ordered
old-to-new IDs and before/after translations, and the resulting layout/geometry
identities. Existing part records retain exact source hashes, source selections,
placed bounds and losses. Save the inspection report if the merge recipe matters:
the editable layout keeps the resulting sources and placements, not operation
history or a link to the incoming layout.

This is a one-time reference placement edit, not persistent grouping or assembly
constraints. Every imported instance can subsequently move on its own. No fit,
rotation alignment, welding, boolean union, collision/clearance, engineering,
manufacturing, Blender or physical-readiness claim is made. IEEE double precision
applies: very small offsets at large coordinates can be rounded. Existing derived
format losses still apply; keep the editable JSON for original sources.

## Focused checks

`node --test adapter/reference-layout-merge.test.mjs` exercises literal world
coordinates, mixed units/rotations/grounding, repeated import, immutable originals,
OBJ/GLB selection and binary PLY/STL retention, save/reopen, existing export formats,
CLI files, loopback HTTP and the served UI's real JavaScript handlers with DOM/canvas
doubles. Handler tests do not qualify browser rendering or live Blender.
