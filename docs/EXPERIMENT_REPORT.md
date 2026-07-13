# First Building and Procedure-Transfer Experiment

**Date:** 2026-07-13

## Question

Can one general, input-driven semantic procedure create two structurally
different building artifact families while preserving identity, scale,
lineage, declared loss, validation, and the physical-effect boundary?

## Trial 1 — arched lunar habitat

**Input:** `fixtures/habitat-a.json`, three components, explicit millimetre
scale evidence, z-up right-handed frame, conceptual reference provenance, and
three unresolved engineering unknowns.

**Output:** accepted 16-operation run; editable-source, engineering,
presentation, simulation, and manufacturing-candidate artifacts.

**Final scene digest:**
`sha256:e3bbec14942d4d2536c8edb4c5116ee5bb79571af085fe734bef25e98575acb1`

**Quality:** unique object identities, explicit materials/unknowns, no missing
model metadata, presentation and engineering review separated, no physical
readiness claim.

## Trial 2 — tri-deck observation tower

**Input:** `fixtures/tower-b.json`, four cylindrical components with a
different topology and scale schedule, the same schema but no geometry copied
from Trial 1.

**Output:** accepted 19-operation run using the same
`parametric-building-from-explicit-spatial-intent-v1` procedure and the same
validator.

**Final scene digest:**
`sha256:819a4d87b5182401c75b73ea4e3d87bd8ae0e3761a7f761a3a87311226501bbf`

**Transfer result:** the plans and scene digests differ; the procedure,
acceptance criteria, authority policy, and representation relations remain the
same. This proves structural procedure reuse without embedding either
building's dimensions in the runtime.

## Negative trials

The suite rejects stale parents, idempotency conflicts, duplicate objects,
zero/invalid geometry, missing scale evidence, implicit unknowns, weak plans,
foreign/traversing/symlinked paths, unknown methods, script/eval/shell fields,
undeclared parameters, excessive deadlines, external effects, physical
effects, and immutable-output overwrites.

The first script-key trial exposed a camel-case bypass. The matcher was
generalized across naming conventions and nesting depths, then the whole
negative suite passed. No fixture-specific token was added.

## Current limitation

The artifacts are deterministic semantic scene packages, not rendered Blender
meshes. Blender was absent, and MoonMold reports that fact. Visual similarity,
topology/manifold checks from a real mesh, and live backend cancellation remain
future live-adapter gates; no mock result is labeled as live Blender evidence.

Generated run artifacts are under ignored
`evidence/generated/{habitat-a,tower-b}` so qualification does not dirty the
repository. Reproduce with `npm run demo` and `npm run demo:transfer`.
Both commands are repeatable: byte-identical immutable artifacts become
idempotent no-ops, while divergent content remains a hard conflict.
