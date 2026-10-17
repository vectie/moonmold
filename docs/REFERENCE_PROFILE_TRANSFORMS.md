# Editable profile ring transforms

Start `node bin/moonmold-operator.mjs --workspace /absolute/workspace --port 4193`
from this source and open `http://127.0.0.1:4193/reference-profile`.

1. Build or reopen a profile, or edit its current outer/cutout point arrays.
2. Under **Transform editable profile rings**, select **Outer ring only**,
   **Cutout only**, or **All profile rings**.
3. Enter translation X/Y, counterclockwise rotation in degrees, a positive
   uniform XY scale, and pivot X/Y. Translation and pivot use the current
   recipe's explicit units. The operation scales about the pivot, rotates
   about the pivot, and then translates. Height is unchanged.
4. **Preview ring transform** builds a separate candidate wireframe and shows
   its bounds and net area. The editable fields and current downloads still
   describe the current draft and last successful applied build, respectively.
5. **Apply preview and rebuild** sends the candidate recipe through the actual
   Node extrusion endpoint, updates both editable ring fields and downloads,
   and checks that the rebuilt recipe/geometry hashes match the preview.
   **Cancel transform preview** leaves the current draft and build untouched.
6. Save **editable profile** to retain the transformed coordinates and height.
   Reopen it here, or run `node bin/moonmold-reference-extrude.mjs --input
   revised.profile.json --format json`. The ordinary v1/v2 recipe remains the
   source; no transform log is required to rebuild it.

The outer-only selection keeps the cutout fixed. The cutout-only selection
requires an existing opening. All-rings selection moves both together. A
candidate must still satisfy the full simple-ring/cutout containment checks;
for example, a cutout translated outside the outer ring is refused. Zero or
negative scale, missing/nonfinite values and coordinates outside existing
extrusion limits reject. Changing draft or transform fields invalidates a
candidate; preview again before applying. Repeated submits are single-flight,
and cancelling an in-progress preview prevents its late reply from applying.

## Typed endpoint and lineage

`POST /api/reference-profile/transform` accepts only:

```json
{
  "contract_id": "moonmold.reference-profile-transform.v1",
  "recipe": { "...": "an ordinary complete v1 or v2 profile recipe" },
  "selection": "all",
  "translation": [3, -1],
  "rotation_degrees": 90,
  "scale": 2,
  "pivot": [2, 1.5]
}
```

The response is an ordinary extrusion result plus `profile_transform`, which
records the source recipe hash, target recipe/geometry hashes, operation
values, units and operation order. After applying, **Save profile transform
lineage** exports that record. Save the original recipe too if you need its
exact pre-transform coordinates; the lineage report contains identities, not
a second copy of the original recipe. A later manual rebuild or reopening
still produces the same transformed geometry but does not recreate that
optional operation report.

The transform edits authored XY rings. Layout placement continues to position
derived mesh instances. No engineering CAD constraints, reflection,
nonuniform scaling, multiple openings, curve editing, Blender qualification,
manufacturing or physical authority is added. Binary64 and existing extrusion
geometry limits apply. The canvas is an auto-fit wireframe, including hidden
edges, not a dimensioned engineering drawing.

## Verification scope

`node --test adapter/reference-profile-transform.test.mjs` exercises explicit
math and selection, valid concavity, proportionate invalid geometry cases,
production page handlers over a real loopback HTTP server, preview/apply/cancel,
late-reply cancellation, saved recipe reopening and the actual extrusion CLI.
It uses a minimal DOM, not a graphical browser. The existing extrusion,
cutout and profile UI regression files also remain applicable. These focused
checks do not qualify Blender, hardware, named human review or full release.
