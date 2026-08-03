# MoonMold responsibility and testability

MoonMold is a first-class MoonSuite product. It owns governed spatial intent,
editable digital geometry, representation lineage, semantic model operations,
and digital validation evidence. It is not a private backend of MoonRobo,
MoonClaw, MoonMoon, or MoonCast.

## Responsibility boundary

| Concern | Responsible product | MoonMold behavior |
|---|---|---|
| Spatial intent and editable geometry | MoonMold | Owns typed artifacts and semantic operations. |
| Model-loop execution | MoonClaw | MoonMold accepts a bounded request; it does not create an agent runtime. |
| Workflow state and retries | MoonFlow | MoonMold returns typed, idempotent receipts. |
| Authority grants | MoonGate/operator host | MoonMold rejects external and physical authority. |
| Simulation truth | MoonMoon | MoonMold may export a derived simulation representation with lineage. |
| Robot execution | MoonRobo | MoonMold may export engineering/collision inputs; it cannot command hardware. |
| Fabrication | External reviewed system | A manufacturing candidate remains digital analysis, never fabrication authority. |

`request_responsibility` is the executable version of this table. It is a pure
decision function called by request validation before backend execution. Every
accepted operation names `moonmold` as owner and exposes a bounded claim
ceiling. External effects require a separate host/MoonGate authority path;
physical effects are rejected.

## Test seams

The core is intentionally testable without Blender:

1. `request_responsibility` tests ownership, disposition, and claim ceilings.
2. `validate_request` tests identity, deadline, authority, operation shape, and
   workspace containment.
3. `MockBackend::execute` tests idempotency, stale-parent rejection, and scene
   lineage deterministically.
4. Adapter/demo tests prove real-backend behavior separately and must never
   relabel mock evidence as Blender evidence.

Workspace roots are explicit authority inputs rather than a developer-specific
hard-coded home directory. Both the root and every output must be canonical
absolute paths; traversal, alternate separators, and prefix-confusion paths
fail closed.

The primary visible path is isolated in
`ui/rabbita-moonmold/main/workflow_guide.mbt`: define → validate/build → named
review → accepted digital receipt. Backend qualification, raw receipts and
lineage remain inspectable through progressive disclosure rather than
dominating the ordinary task.

## Definition of responsible completion

A MoonMold result is complete only when its request identity, parent digest,
bounded authority, semantic operation, output lineage, validation evidence, and
claim ceiling are reviewable. No successful digital receipt implies structural
safety, simulation validity, manufacturing approval, fabrication, or physical
motion.
