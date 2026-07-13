# Bounded Blender MCP Adapter Guide

## Surface

`adapter/mcp-server.mjs` is a JSON-RPC stdio server. It exposes exactly two MCP
tools: `moonmold_semantic_operation` for bounded scene operations and
`moonmold_live_building` for a complete plan-to-Blender artifact run. Neither
surface exposes Blender Python, shell, eval, arbitrary operators, arbitrary
file reads, arbitrary URLs, or physical devices. The live tool selects the
fixed audited bridge itself; request data cannot replace or extend it.

The semantic methods are capability discovery, model creation, box/cylinder
creation, transform, material assignment, boolean subtraction, validation, and
declared representation export. Parameter objects reject unknown fields as
well as script-like names.

Each request carries:

- project, session, model, request, and idempotency identities;
- expected scene-parent digest;
- a workspace root under `/Users/kq/moonsuite`;
- a bounded duration no greater than 120 seconds;
- digital authority class;
- semantic method and exact typed parameters.

Receipts carry before/after digest, changed object identities, warnings, output
hashes with `moonsuite://` logical URIs, validation, outcome, and recovery
lineage. Identical completed duplicates are no-ops; a conflicting duplicate or
stale parent fails before mutation.

## Running the reference adapter

```sh
npm run mcp
```

Send newline-delimited JSON-RPC 2.0 messages over stdin. `initialize`,
`tools/list`, and `tools/call` are the only MCP methods.

## Blender status

The qualified workspace runtime is Blender 4.5.11 LTS, discovered through
`/Users/kq/moonsuite/tools/blender/runtime-manifest.json`. Environment overrides
are explicit (`BLENDER_BIN` or `MOONMOLD_BLENDER`); otherwise discovery does not
search arbitrary host paths. Capability discovery reports executable, version,
source, scene digest, and whether the live surface is available.

The live path creates a `.blend` source, GLB presentation/interchange model,
STL manufacturing candidate, PNG review render, bridge manifest, and immutable
evidence record. It validates output signatures, sizes, hashes, object count,
bounds, input identity, reference bytes, and physical-effect absence before
acceptance. An explicit live request can never silently substitute mock output.

## Cancellation and bounded work

Semantic requests outside the declared deadline range fail at validation. The
Blender child process has a bounded deadline and is terminated on timeout or
MCP cancellation. `notifications/cancelled` is accepted while other requests
remain serviceable; cancelled work cannot produce an accepted receipt.
