# Step and Quality Ledger

## B0 — Boundary and repository

**Input:** fourth-update plan, Moon Suite product constitution, requirement for
a first physical-world bridge without physical control.

**Output:** standalone `vectie/moonmold` module, product constitution,
architecture, workspace-only policy, and explicit non-goals.

**Quality gate:** no files outside `/Users/kq/moonsuite`; no dependency on
sibling source trees; no script/shell/public physical operation.

## B1 — Spatial contracts

**Input:** canonical artifact family and portable lineage relations.

**Output:** representation, artifact, lineage, validation, authority, semantic
operation, request, receipt, and typed error contracts. Canonical manifests use
fixed field order and deterministic `mm1` integrity keys without pretending to
be cryptographic hashes.

**Quality gate:** generated MoonBit interface is reviewable; style is a sibling
with explicit loss; paths, units, frames, parents, and claims are explicit.

## B2 — Reference runtime

**Input:** semantic adapter request with expected parent and idempotency key.

**Output:** applied receipt, identical duplicate no-op, or typed fail-closed
rejection. Mock backend updates deterministic scene lineage.

**Quality gate:** positive tests plus stale parent, conflicting duplicate,
path escape, invalid geometry, unsupported script, excessive authority, and
deadline tests. No failed request mutates the scene.

## B3 — Parametric primitive building

**Input:** schema-validated building intent with explicit scale, frame,
references, unknowns, components, dimensions, positions, and materials.

**Output:** deterministic semantic scene and five immutable representation
packages. The CLI compiles components generically; it contains no habitat or
tower dimensions.

**Quality gate:** all operation receipts accepted; scene digest is reproducible
for the same plan; a different topology produces a different digest.

## B4 — Reference and uncertainty envelope

**Input:** MoonBook-style logical reference URI, provenance/license,
confidence, scale evidence, and unresolved facts.

**Output:** input digest and experiment report preserve references and unknowns.
Missing scale evidence or implicit unknowns cannot advance.

**Quality gate:** this is reference-informed semantic modeling, not a claim of
image reconstruction. Live visual matching remains pending a browser/Blender
review surface.

## B5/B6 — Declared downstream siblings

**Input:** accepted scene and authoritative engineering artifact.

**Output:** presentation (`styled-from`) and simulation
(`physics-derived-from`) siblings that name the engineering digest and declare
their losses and claim ceilings.

**Quality gate:** downstream outputs cannot overwrite engineering truth and do
not claim measured mass, environmental calibration, or collision fidelity.

## B7 — Manufacturing-candidate analysis boundary

**Input:** accepted engineering candidate.

**Output:** immutable manufacturing-candidate package with explicit unresolved
watertightness, tolerance, material, and process assumptions.

**Quality gate:** claim ceiling is `analysis-only-no-machine-authority`; no
printer, slicer execution, device, physical action, or authorization surface
exists.

## Trial policy

Unqualified output cannot advance. Change a general input constraint or product
behavior, record why, rerun from the nearest honest checkpoint, and compare the
result. Fixture-specific geometry must never enter the validator. Procedure
transfer is proved with a structurally different second building.

## Recorded trial — script-key normalization

**Unqualified result:** the first negative runtime trial rejected
`python_script` but accepted camel-case `pythonScript`, because the forbidden
name matcher recognized separators rather than semantic substrings.

**General correction:** parameter names are now rejected case-insensitively
whenever they contain a script/eval/shell/code concept, independent of naming
convention and nesting depth. This is adapter-wide policy, not a fixture value.

**Qualification:** snake/kebab/camel and nested variants are exercised through
the same public runtime; rejected requests leave the scene digest unchanged.
