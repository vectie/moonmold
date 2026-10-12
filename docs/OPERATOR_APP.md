# Spatial operator application

`ui/rabbita-moonmold` is MoonMold’s first-class Rabbita application. It is a
projection and operator surface over the pack adapter, not an agent runtime.

The operator can:

- create, save and load an exact `moonmold.spatial-operation-request.v1`;
- prepare model units, boxes, cylinders and absolute moves with typed fields,
  keeping the advanced JSON editor available;
- inspect intent, workspace-relative references, constraints, authority,
  idempotency and provider qualification;
- validate or execute through the MoonBit `moonflow.adapter.v2` command;
- reconcile the same durable attempt after interruption;
- inspect editable, engineering, presentation, simulation and
  manufacturing-candidate siblings, their lineage, losses, warnings and
  validation evidence;
- bind a named human decision to the exact receipt digest.

The local host exposes only fixed `/api` routes. It selects the MoonBit adapter
command itself. Browser input cannot select a shell command, executable, script,
URL, Python body or physical target.

For existing geometry, open `/reference-mesh` on the same operator host to import
and inspect a single reference. For independently placed multi-reference models,
open `/reference-layout` to add, edit, duplicate, remove, save and reopen a
[portable layout](REFERENCE_LAYOUT.md) and export combined OBJ/STL.

The single-reference workbench supports local OBJ and ASCII/binary STL input,
dimension inspection and reference JSON/OBJ/STL downloads. See
[reference mesh input](REFERENCE_MESH.md). This separate geometry workflow does
not execute semantic operations or replace retained engineering geometry.

## Run locally

```sh
npm --prefix ui/rabbita-moonmold install
npm run ui:build
npm run operator -- --workspace /path/to/workspace --port 4193
```

For development, run the operator on port 4193 and `npm run ui:dev`; Vite
proxies `/api` to that fixed listener.

The default backend is `mock-reference`. This is useful for deterministic
workflow and UI validation only. Entering `live-blender` fails explicitly until
the separately qualified live provider is connected; the host never silently
falls back.
# Downloadable digital delivery

The operator's digital delivery panel freezes a revisioned brief, packages the
selected deterministic presentation export into editable semantic JSON plus
OBJ/SVG siblings and loss/change reports, and downloads exact immutable files.
It extends the existing named receipt review with an exact package digest.
See [OBJECT_CONTROLS.md](OBJECT_CONTROLS.md) for typed box/cylinder/move inputs,
draft persistence and precise input bounds, and
[DIGITAL_DELIVERY.md](DIGITAL_DELIVERY.md) for unit conventions, the delivery API
and remaining qualification limits.

Reference layouts can also retain [named vertex dimensions](REFERENCE_DIMENSIONS.md)
and export annotated SVG sheets with source-bound companion JSON. This plain-JavaScript
reference workflow needs only Node and does not execute the MoonBit adapter.
