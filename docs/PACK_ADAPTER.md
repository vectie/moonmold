# MoonMold pack adapter

MoonMold 0.2.0 owns a pack-local `moonflow.adapter.v2` implementation. It
does not add spatial policy to MoonFlow and it does not add a second agent
runtime to MoonClaw.

## Executable identity

`pack.json` owns the three tools and versioned schemas. The host binding is
[`adapters/moonmold-pack-local-v1.declaration.json`](../adapters/moonmold-pack-local-v1.declaration.json).

| Tool | Canonical identity | Authority | Claim ceiling |
| --- | --- | --- | --- |
| `spatial.operation.validate` | `moonmold/spatial.operation.validate@0.2.0` | `sandbox-execution` | observation |
| `spatial.operation.execute` | `moonmold/spatial.operation.execute@0.2.0` | `workspace-mutation` | digital artifact |
| `representation.validate` | `moonmold/representation.validate@0.2.0` | `sandbox-execution` | observation |

Each declaration supports reconciliation. None supports external or physical
authority.

## Durable invocation

The MoonBit adapter command is:

```sh
moon run cmd/moonflow_adapter -- invoke /path/to/workspace request.json
moon run cmd/moonflow_adapter -- reconcile-report /path/to/workspace request.json
```

`input_artifacts[0]` is always the exact typed MoonMold request. MoonFlow may
append immutable dependency evidence after it. The adapter requires every
reference to remain workspace-relative and verifies the ordered aggregate
artifact-set digest before it performs or records an operation.

For every attempt it persists:

```text
.moonsuite/products/moonmold/adapter-attempts/<attempt-id>/
  request.json
  input.json
  attempt.json
  operation-receipt.json
  adapter-result.json
  reconciliation.json
```

Mutating semantic requests also enter
`.moonsuite/products/moonmold/runtime/semantic-journal.json`. Restart recovery
replays that typed journal through MoonMold’s deterministic MoonBit backend.
An already-started attempt cannot execute again; callers must reconcile it.
Reconciliation returns `recovered-succeeded` or `not-applied`, and only the
latter permits a new attempt.

The public operation decoder recognizes only the fixed semantic methods in the
schema. Artifact references remain workspace-relative. Script, Python, shell,
eval, expression, URL and physical-device surfaces are absent.

## Health and capability truth

```sh
moon run cmd/moonflow_adapter -- health \
  /path/to/workspace \
  2026-07-31T00:00:00Z \
  2026-07-31T00:15:00Z

moon run cmd/moonflow_adapter -- source-bundle \
  pack.json \
  /path/to/workspace \
  2026-07-31T00:00:00Z \
  2026-07-31T00:15:00Z
```

The adapter writes short-lived, workspace-relative health evidence and hashes
its exact bytes with SHA-256. The source bundle contains the product manifest,
adapter declaration and health attestation required by MoonFlow’s executable
capability compiler.

Health of the deterministic semantic path is not Blender qualification. Its
artifacts and receipts say `fixture-reference-only` and
`production_qualified=false`. A discovered Blender runtime remains
`conditionally-discovered` until the fixed bridge passes its separate live
qualification; mock bytes are never labelled Blender evidence.
