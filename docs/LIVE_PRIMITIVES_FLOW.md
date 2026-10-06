# Opt-in experimental primitive Flow capability

This is an additive candidate, not a default installation or deployment.
`pack.json`, the `moonmold-pack-local-v1` declaration, and the MoonBit semantic
adapter remain pinned to 0.2.0 and mock-only. The old unversioned Node
`flow-adapter` routes are retained without contract changes.

Importing a capability manifest is not executable installation. An owner must
perform the two explicit installation steps below, verify the resulting receipts,
bind the installed product-owned Node CLI in a v3 unattended manifest, and select
`moonmold/primitive.build@0.3.0`. No existing work item is migrated and there is no
automatic alias from spatial.operation.execute.

## Explicit export, contract install and runtime install

`scripts/live_runtime.mbtx` is the product-owned packaging entrypoint. Use the
supported MoonBit script runtime and cached dependencies, without npm dependency
installation:

1. `moon run scripts/live_runtime.mbtx --target native -- stage PRODUCT_SOURCE NEW_EXPORT_ROOT`
   exports a complete0.3.0 MoonPack as `NEW_EXPORT_ROOT/pack.json` plus its actual
   schemas, policy, adapter declaration, uninstall contract, a JSON runtime-package
   descriptor, and a separate `runtime-payload/` directory
2. `moonbook pack inspect NEW_EXPORT_ROOT`, followed by the existing
   `moonbook pack install NEW_EXPORT_ROOT SUITE HOST_PROFILE` and
   `moonbook pack verify SUITE moonmold 0.3.0`, installs only the declared
   contracts through the unchanged generic installer
3. `moon run scripts/live_runtime.mbtx --target native -- install NEW_EXPORT_ROOT SUITE`
   is the second explicit installation step. It rehashes every generic receipt
   artifact, validates the installed runtime descriptor, copies only its fixed
   typed resources, and emits `moonmold.live-runtime-installation.v1`

The descriptor is `moonmold.live-runtime-package.v1`. It states each relative
resource's role, media type, SHA-256 and byte count, the fixed Node entrypoint,
Node minimum version and external Blender selection. JS/Python source is not
misclassified as a provider-port contract: the generic installer copies the JSON
descriptor, while the separate product installer copies its implementation
payload. The Node import closure includes `adapter/runtime.mjs`, and preserves the
literal optional-manifest filename used by live health source identity.

The product runtime lives under
`SUITE/.moonsuite/products/moonmold/runtime-packages/0.3.0/DESCRIPTOR_SHA256/`.
Use its `bin/moonmold.mjs` with an explicitly selected host Node executable. The
generic installer writes0644 files, so do not assume executable permission. No
repository or staging path is needed by the installed Node imports. The product
runtime receipt binds the generic manifest and descriptor digests plus every
installed resource. `live_runtime.mbtx verify RUNTIME_ROOT INSTALLED_DESCRIPTOR`
checks the copied bytes again. Neither receipt grants execution authority or
issues health/review evidence. A partial runtime stage is retained for inspection,
never silently removed or retried.

The export's private npm package has a fixed `files` allowlist, no dependencies or
install lifecycle, and an explicit local bin. Root product npm metadata is left
unchanged. Local packing is separate from npm installation or publishing; neither
is implied by the MoonPack or runtime receipts.

The generic registry retains immutable0.2.0 and0.3.0 version roots, but has one
active default pointer per pack ID. Opting into0.3.0 explicitly changes that
default. Old pinned graphs/requests/catalogs retain their exact0.2.0 binding;
the active pointer must not be substituted for a stored exact version. Rollback
is explicit. Generic deactivation removes only the active pointer and preserves
both installed versions, the separately installed runtime and all model/run
evidence. Runtime payload cleanup is a separate operation; these scripts perform
no cleanup and never touch generated model/run artifacts.

## Narrow contract

- Input: `moonmold/primitive-building-plan@1.0.0`, with the explicit serialized
  `moonmold-building-plan-v1` subset defined in its JSON Schema
- Two to 32 boxes/cylinders, mm, z-up-right-handed; positive dimensions
  0.001..1,000,000 mm; positions within ±1,000,000 mm; cylinders 8..256 sides
- Explicit synthetic or supplied dimensions and nonempty unknowns; no reference
  URL/image intake, arbitrary intent, script, expression, device or shell surface
- Output: `moonmold/primitive-building-result@1.0.0`, containing a Blender scene,
  GLB mesh, STL candidate and PNG references and the bridge-manifest hash
- Workspace mutation / digital artifact only. No physics, structural,
  pressure-vessel, manufacturing, fabrication or physical authority
- `supports_reconcile=true`, `supports_cancel=false`; 1..120,000 ms product limit

The public result intentionally avoids labeling a primitive mesh as a validated
engineering or simulation model. Product acceptance means the product verified
its digital evidence, not independent or human acceptance.

## Product CLI and observed health

Use `node bin/moonmold.mjs live-flow` with one of these subcommands:

- `probe --workspace W --request R --result S --artifact D`: explicitly perform a
  bounded bootstrap test with the exact live request contract; never mock
- `health --workspace W --request R --result S --artifact D --evidence E --health H`:
  verify the completed probe, hash real executable/version/fixed bridge/product
  sources and all probe outputs, then emit a real ten-minute observation
- `execute --workspace W --request R --result S --artifact D --health H`: verify
  exact health evidence bytes, current runtime/source identity and fresh probe
  before executing or replaying
- `reconcile --workspace W --request R --result S --artifact D`: inspect only;
  completed, failed, interrupted-or-running or absent. Conflicting bytes are
  rejected. This does not rerun Blender and needs no healthy runtime to read
  already-produced artifacts
- `attest --workspace W --request R --result S --draft D --final F --attestation A
  --attestor-id moonmold-live-primitives-attestor-v1`: rehash retained outputs,
  reuse the existing product attestor, then publish the canonical final and
  `moonflow.product-attestation.v1`

The CLI does not discover an arbitrary PATH Blender. An owner supplies the
existing supported runtime selection, such as the documented process-local
`BLENDER_BIN`. Probe execution has no authorization magic; the host/operator must
already possess permission to run that bounded digital test.

Health includes a real hash and an actual observation. It is explicitly
`experimental-primitives-digital-only`, records the observed runtime, and keeps
`documented_target_qualified=false`. A successful Blender 4.3.2 run does not
qualify the documented Blender 4.5.11 LTS target. The observation is only a bounded
probe, not a full test of every size/count limit. Missing/stale health, changed
fixed bridge, changed executable or changed product source fails closed.

The host verifies health bytes before catalog compilation. The live executor
also verifies them because native Flow's pure catalog compiler does not read
those files. Retain the exact source bundle, catalog and graph report used.

## Immutable request and recovery behavior

The complete request bytes, ordered input bytes, request/result/draft references,
and exact operation bind an immutable attempt. An exclusive started record and
idempotency-key binding are committed before the fixed bridge. Concurrent
requests cannot start a second effect for the same attempt/key.

A terminal record binds start bytes, native receipts, draft, result, live evidence,
input-plan, all four binary outputs and bridge manifest. Replay and reconcile
rehash every retained file. Failed attempts retain any partial files with their
hashes and an error kind. A process interrupted after start remains ambiguous and
cannot be silently rerun, even when some or all output files exist. No PID-based
claim of running vs crashed is made. An operator must reconcile/review and grant a
new attempt if needed; this boundary does not invent that authority.

Output references are confined to the same workspace and reject traversal and
symlink redirects. JSON is not a transfer of its binary references. A consumer
outside this workspace must explicitly receive the complete referenced output
set with its hashes through the host's existing artifact transfer mechanism.

## Independent review is a separate, currently blocked boundary

The existing v3 Flow driver supports executor → product attestor → immutable
final snapshot → independent reviewer. Its expected independent contract is
`moonflow.acceptance-review-request.v1` producing `moonflow.acceptance-review.v1`.
The current MoonBook producer still emits `moonclaw flow-adapter review`; that
public command is retired and fails before model/provider execution. There is no
supported replacement producing this same criterion-review contract in the
inspected source. Generic capability and agent-goal receipts are not substitutes.

Therefore this candidate can produce and attest real inspectable work, while
independent acceptance remains pending/unavailable. Never mark the goal completed
or accepted because its product attestor returned accepted=true. A release owner
must restore/implement a genuinely independent supported review producer and
supply appropriate authority before claiming an end-to-end accepted workflow.
