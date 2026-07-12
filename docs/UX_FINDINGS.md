# Developer and Agent UX Findings

MoonMold does not yet have its final MoonDesk visual surface, but its command
and MCP interfaces were reviewed as user-facing developer/agent experiences.

## Fixed

### MCP schema described required fields but not their properties

The first `tools/list` response declared `additionalProperties: false` and a
required-field list, but omitted `properties`. A strict MCP client would treat
every useful request as invalid. The schema now exposes every envelope field,
authority choice, semantic method, and deadline range. A regression test proves
that every required field has a property declaration.

### Mock fallback could be mistaken for Blender execution

The first adapter constructor accepted a `blender` backend label while still
running the reference state machine. That was removed. Live Blender requests
now fail visibly with `backend-unavailable`; capability discovery reports the
actual executable/version state and the evidence class.

### Output receipts exposed host paths

Runtime receipts initially returned absolute output paths. They now return
portable `moonsuite://` URIs while enforcing and testing the absolute path only
inside the adapter.

### Representation reports carried lineage but exported artifacts did not

An early trial put parent and loss declarations only in the surrounding
experiment report. This made an artifact unsafe when detached from that report.
Exported presentation, simulation, and manufacturing candidates now embed
their engineering parent digest, relation, known losses, claim ceiling, units,
frame, and `physicalAuthority: false`.

### Overbroad engineering method name

The first MoonBit API called a shape predicate `can_replace_engineering`.
Because validation and promotion are separate decisions, the name could imply
authority it did not possess. It is now
`is_lossless_engineering_representation`, with an explicit comment that the
predicate does not validate or authorize replacement.

## Current visible limitations

- No rendered 3D viewport or reference-image overlay exists until MoonDesk and
  the embedded browser integrate this track.
- Blender is absent, so mesh topology, normals, manifold state, visual
  comparison, and cancellation of a live worker are not qualified.
- CLI inputs are JSON fixtures; a user-friendly intent editor, reference
  picker, progress display, “Why blocked?” explanation, and visual comparison
  belong in the combined MoonDesk journey.
- Validation warnings are structured but not yet rendered with user/operator/
  developer disclosure layers.

These limitations are explicit gates, not compatibility warnings and not
claims of completed visual or physical modeling.

