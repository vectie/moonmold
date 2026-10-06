# Spatial operator application

`ui/rabbita-moonmold` is MoonMold’s first-class Rabbita application. It is a
projection and operator surface over the pack adapter, not an agent runtime.

The operator can:

- create, save and load an exact `moonmold.spatial-operation-request.v1`;
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
See [DIGITAL_DELIVERY.md](DIGITAL_DELIVERY.md) for the supported box-only workflow,
unit conventions, API and remaining qualification limits.
