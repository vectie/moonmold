# First Building and Procedure-Transfer Experiment

**Date:** 2026-07-13

## Question

Can one general, input-driven semantic procedure create structurally different
building artifact families—including one informed by a user image—while
preserving identity, scale, lineage, declared loss, validation, and the
physical-effect boundary in both mock and live Blender execution?

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

## Trial 3 — image-referenced city hall

**Input:** `fixtures/city-hall-image-referenced.json` plus the tracked image at
`inputs/moonmold-reference-building/city-hall-reference.png`. The reference
bundle separates observed visual cues, explicit non-pixel scale, estimates,
occlusions, unknowns, intended consumers, and byte-level provenance.

**Input digest:**
`sha256:ddb987928ebc988df39c496b224f0e710dc5d06bc281c5ca7f61eb462229ad81`

**Output:** accepted 28-operation run and five portable contracts. The same
generic procedure produced a seven-component model; no city-hall dimensions
or image-specific branches were added to the runtime.

**Boundary:** this is reference-informed semantic modeling. It does not claim
pixel-derived dimensions, photogrammetry, visual identity, structural fitness,
or physical readiness.

## Live Blender qualification

Blender 4.5.11 LTS executed all three plans through the fixed semantic bridge.
Each run produced and validated `.blend`, GLB, STL, PNG, manifest, and live
evidence outputs. The first pass was `applied`; a second identical pass for
each plan was an `idempotent-no-op`. The live test suite passed 3/3, including
the MCP path. All outputs remained digital and `physicalEffects:false`.

The first render review found that technically valid habitat and tower images
were too dark. The general renderer policy—not the fixtures—was revised to use
a neutral world, ground plane, balanced three-point lighting, AgX contrast, and
bounded exposure. All three plans were rerun and visually inspected; their
silhouettes and component boundaries are now readable. This is presentation
quality evidence, not engineering validation.

Live binary outputs remain ignored under `evidence/generated/live-blender-*`.
Their stable identities are recorded in `evidence/qualification-summary.json`.

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

The bridge emits real Blender meshes and review renders, but primitive semantic
modeling is not image reconstruction. Visual similarity scoring, topology and
manifold promotion gates, material calibration, physics validation, and
fabrication qualification remain later stages. Live and mock evidence classes
stay distinct.

Generated run artifacts are under ignored
`evidence/generated/` so qualification does not dirty the repository. Reproduce
the first two mock trials with `npm run demo` and `npm run demo:transfer`, and
run live qualification with `npm run test:blender`. All three complete runs
were repeated: byte-identical immutable artifacts become idempotent no-ops,
while divergent content remains a hard conflict.
