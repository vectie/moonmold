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
  assert_eq(styled.can_replace_engineering(), false)
}
```

See `docs/CONSTITUTION.md`, `docs/ARCHITECTURE.md`, and
`docs/EXPERIMENT_REPORT.md` for the product boundary, implementation journey,
quality trials, and current limitations.
