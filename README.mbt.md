# MoonMold

MoonMold transforms governed spatial intent, references, constraints, and
procedures into editable digital models and representation-specific validation
evidence. It may prepare a manufacturing candidate, but it cannot claim
structural safety, physical readiness, or authorize a physical effect.

The public MoonBit package owns backend-neutral spatial artifacts, representation
lineage, validation findings, and bounded semantic adapter requests. The first
runtime supports an in-process mock backend and an optional Blender adapter;
there is deliberately no public script or shell operation.

```mbt check
///|
test "a presentation sibling cannot replace engineering truth" {
  let source = @moonmold.new_artifact(
    artifact_id="habitat-source",
    representation=EditableSource,
    digest="mm1-source",
    units="m",
    coordinate_frame="z-up-right-handed",
    parent_digest=None,
    relation=None,
    known_losses=[],
  )
  let styled = @moonmold.derive_artifact(
    source,
    artifact_id="habitat-presentation",
    representation=Presentation,
    digest="mm1-present",
    relation=StyledFrom,
    known_losses=["collision fidelity", "engineering materials"],
  )
  assert_true(styled.parent_digest() == Some(source.digest()))
  assert_eq(styled.is_lossless_engineering_representation(), false)
}
```

See `docs/CONSTITUTION.md`, `docs/ARCHITECTURE.md`, and
`docs/EXPERIMENT_REPORT.md` for the product boundary, implementation journey,
quality trials, and current limitations.

## Qualification

```sh
moon check --target all --warn-list +unnecessary_annotation
moon test --target all
npm test
npm run demo
npm run demo:transfer
```

The demos create ignored evidence only under
`/Users/kq/moonsuite/development/sources/moonmold/evidence/generated`. The two
fixtures use one general procedure but different topology and dimensions.

Start the bounded stdio MCP adapter with `npm run mcp`. Blender is optional;
when unavailable, live-backend requests fail explicitly and only mock-reference
receipts may be produced.

The unattended product boundary is owned by `moonmold flow-adapter execute`
and `moonmold flow-adapter attest`. Execution creates real Blender evidence;
attestation re-hashes every declared output, preserves concrete unknowns, and
publishes an immutable digital-only final artifact. `product-registry-entry.json`
is the canonical MoonDesk registry entry for a suite installation.
