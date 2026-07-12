# Bounded Blender MCP Adapter Guide

## Surface

`adapter/mcp-server.mjs` is a JSON-RPC stdio server. It exposes exactly one MCP
tool, `moonmold_semantic_operation`; that tool accepts the typed MoonMold
envelope and one allowlisted method. It does not expose Blender Python, shell,
eval, arbitrary operators, arbitrary file reads, arbitrary URLs, or physical
devices.

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

Blender was not installed in the qualification environment. Capability
discovery reports `available: false`; the mock reference runtime therefore
proves all core state, identity, lineage, validation, and policy behavior.
Explicitly requesting `backend: "blender"` fails with `backend-unavailable`
rather than silently substituting mock evidence.

A future live installation must provide a fixed, audited semantic bridge that
maps the existing operations to Blender calls. It must not add a user-supplied
script field. Live Blender evidence is optional until that executable is
present; it cannot be fabricated from mock receipts.

## Cancellation and bounded work

The current semantic primitives are in-process bounded operations. Requests
outside the declared deadline range fail at validation. The future external
Blender worker must implement deadline termination and cancellation before it
can produce live-backend receipts.

