# MoonMold UI-to-UI qualification

Last reviewed: 2026-07-31
Surface: `spatial-operator`
Product class: first-class spatial-model domain pack and bounded tool provider

## Boundary under test

MoonMold is a pack because it owns spatial domain contracts, representations,
lineage, provider qualification, and review evidence. Its semantic operations
are tools callable through the generic MoonFlow/MoonClaw boundary. The Rabbita
application is an operator projection, not another runtime.

The current deterministic backend is `mock-reference`. It proves workflow,
lineage, durability, review, and denial behavior only. It is never Blender,
manufacturing, fabrication, or robot evidence.

## Prerequisites and launch

Build the Rabbita bundle once, then start the fixed local operator host:

```sh
cd /Users/kq/Workspace/moonmold
npm run ui:build
npm run operator -- --workspace /tmp/moonmold-ui-qualification --port 4193
```

Open:

```text
http://127.0.0.1:4193/
```

The header must show `moonflow.adapter.v2`,
`moonmold/spatial.operation.execute@0.2.0`, and
`NO FABRICATION · NO PHYSICAL AUTHORITY`.

## M1 — positive semantic model and named review

1. Confirm **Backend qualification** identifies deterministic mock/reference
   evidence and `production_qualified: false`.
2. Keep or enter:
   - Project: `robot-cell-demo`
   - Model: `guarded-cell-layout`
   - Backend preference: `mock-reference`
   - Reference: `references/approved-spatial-brief.json`
   - Constraint: `No physical authority`
3. Click **Create model**.
4. Verify semantic method becomes `scene.create-model`; retain valid JSON
   parameters with explicit name, units, and coordinate frame.
5. Click **Execute reference path**.
6. Expect a terminal durable receipt and a new request/idempotency revision.
7. Click **Add box**, set a bounded work-cell object, and execute again.
8. Click **Editable**, then execute the representation export.
9. Click **Engineering**, then execute the representation export.
10. In **Editable and derived siblings**, verify representation, parent
    digest, relation, known losses, claim ceiling, mock backend evidence, and
    `physical_authority: false`.
11. Enter reviewer `UI Qualifier`, decision `approve`, and notes:
    `Accepted as digital mock evidence only; robot ingestion remains gated.`
12. Click **Record named review**.
13. Expect one durable review receipt bound to the exact attempt and operation
    receipt digest.

When reopening the shared qualification workspace used on 2026-07-31, recovery
may project `editable-source` as the active exact receipt while also showing
`engineering` as a derived sibling. Treat the active receipt and the sibling
ledger as separate facts; the presence of an engineering sibling must not
rewrite the recovered attempt identity.

Expected evidence roots:

```text
/tmp/moonmold-ui-qualification/.moonsuite/products/moonmold/operator-inputs/
/tmp/moonmold-ui-qualification/.moonsuite/products/moonmold/operator-requests/
/tmp/moonmold-ui-qualification/.moonsuite/products/moonmold/adapter-attempts/
/tmp/moonmold-ui-qualification/.moonsuite/products/moonmold/projects/
/tmp/moonmold-ui-qualification/.moonsuite/products/moonmold/reviews/
```

## M2 — governed denials

### No pre-execution self-approval

1. Open a fresh workspace.
2. Enter reviewer and decision.
3. Click **Record named review** before validation or execution.
4. Expect: `Execute or validate before recording review.`

### Live-provider truth

1. Change backend preference to `live-blender`.
2. Click **Validate** or **Execute reference path**.
3. Expect an explicit backend-unavailable/provider-qualification error.
4. Verify the host does not silently fall back and does not label output as
   Blender evidence.

### Unsafe or malformed input

1. Put `../outside.json` in reference artifacts.
2. Expect path-boundary rejection.
3. Replace exact parameters with invalid JSON.
4. Expect a local invalid-JSON error and no adapter attempt.
5. Set a manufacturing candidate template and execute.
6. Verify its claim ceiling remains analysis-only/no-machine-authority.

## M3 — restart recovery and exact reconciliation

1. Complete M1 through an engineering export and named review.
2. Click **Reconcile same attempt**.
3. Expect `Reconciliation completed without replaying a new attempt.`
4. Record the attempt ID and review count.
5. Stop and restart the operator with the same workspace.
6. Reload the page.
7. Expect the latest exact durable receipt, derived representations, review
   receipts, and the next monotonic request/idempotency identities.
8. Change the old request while reusing its identity. Expect immutable conflict,
   not overwrite.

## Current MoonRobo interoperability truth

The first-class operator exports `moonmold.spatial-artifact.v1` with
representations named `editable-source` and `engineering`. MoonRobo’s existing
ingestion package accepts an older composite
`moonmold-portable-ingestion-v1` envelope using
`editable-authoring-model` and `engineering-model`.

The mismatch is structural, not merely vocabulary. MoonRobo's envelope also
requires a manifest and transform record with exact editable-parent and
engineering-child artifact identities/digests, spatial conventions,
intended/forbidden consumers, an authority reference, declared losses,
assumptions, and unresolved gaps. The current operator artifact is flat, uses
the scene-state digest as `parent_digest`, and does not carry all of those
fields.

Therefore the deterministic operator can prove the MoonMold side, but it cannot
yet claim a direct UI-to-UI MoonRobo handoff. A reviewed, versioned pack-owned
portable exporter/translator or a shared upgraded schema is required. Renaming
fields in UI code is not an acceptable workaround because lineage, digest,
authority, consumer, spatial, and known-loss semantics must remain exact.

## Qualification record

- Source/build validation: passed (`moon check --target all --warn-list +73`,
  MoonBit tests, 24 Node tests passed with 2 live-Blender tests skipped, UI
  production build, and `moon info`)
- Operator host and static UI: passed at `/`; `/api/status` reported
  `moonflow.adapter.v2`, mock evidence `production_qualified=false`, Blender
  unavailable, and `physical_authority=false`
- Semantic API M1: passed create-model, `editable-source`, and `engineering`
  executions, exact reconciliation, recovery projection, and named review.
  The engineering attempt was
  `attempt-qa-engineering-20260731-exec`; its backend remained
  `fixture-reference-only` and its claim ceiling was
  `digital-engineering-candidate`.
- Semantic API M2: passed explicit `provider-not-qualified` for
  `live-blender` and `workspace-boundary` for `../outside.json`; no fallback
  occurred
- Rabbita governed-error projection: fixed after browser qualification found
  that an HTTP 400 body was being decoded as a success payload. Pack-local
  gateway parsing now preserves the server's exact `code: message`; focused
  JS check, 5 UI tests, and production build passed.
- Browser M1: passed reload recovery, exact reconciliation without replay, and
  a named digital-only review. Recovery showed `editable-source` as the active
  receipt and `engineering` as a sibling; the UI did not conflate them.
- Browser M2: passed; `../outside.json` rendered the exact
  `workspace-boundary` denial after the gateway-parser fix
- Browser M3: reload recovery passed; a process stop/start was not exercised
- Browser evidence:
  [`named-digital-review.png`](../../_build/ui-to-ui/2026-07-31-consolidated/named-digital-review.png)
  and
  [`workspace-boundary-denial.png`](../../_build/ui-to-ui/2026-07-31-consolidated/workspace-boundary-denial.png)
- Restart portion of M3: pending browser-host process restart; exact reconcile,
  reload recovery, and recovery reads passed without replay
- Durable MoonBit adapter: passed consolidated qualification
- Blender: not tested; qualified provider absent
- Direct MoonRobo operator handoff: not implemented / not tested
- Fabrication and physical effects: excluded
