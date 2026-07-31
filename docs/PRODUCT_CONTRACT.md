# MoonMold product contract

Class: domain pack
Maturity: early digital-model alpha
Last reviewed: 2026-07-30

## Outcome

MoonMold converts governed spatial intent, references and constraints into
editable digital models with explicit representation lineage and validation
evidence.

## Ownership

MoonMold owns semantic spatial operations, editable model artifacts,
representation transformations, validation findings and manufacturing-candidate
preparation. It does not own arbitrary scripts, general CAD claims, structural
certification, machine control, robot control or fabrication authority.

## Capability status

| Capability | Status |
| --- | --- |
| Backend-neutral artifact and lineage contracts | available |
| Bounded semantic operation validation | available |
| In-process mock backend | available; fixture/reference evidence |
| Durable MoonFlow v2 invoke/reconcile/health | available |
| Rabbita spatial operator and named review | available |
| Blender adapter | conditional on qualified Blender environment |
| Current building/primitive procedure fixtures | experimental |
| General parametric CAD, assemblies and constraints | planned |
| Fabrication authorization | excluded |

## Representation truth

Editable source, presentation, simulation and manufacturing-candidate artifacts
are related siblings with explicit known losses. A rendered or printable output
cannot silently replace engineering geometry. Mock evidence must never be
labelled Blender evidence.

## Pack and adapter contract

`pack.json` is the installable product boundary. Public operations remain
semantic and typed; no shell, arbitrary Python, expression or URL execution is
part of the pack API. MoonFlow dispatches operations, MoonClaw reasons when
needed, and the pack’s Rabbita application projects its operator state.

## Authority and evidence

The current authority ceiling is digital artifact creation. Every live adapter
receipt records backend qualification, input digests, operation, outputs,
validation and concrete unknowns. A manufacturing candidate is analysis data,
not authority to start a printer, machine or robot.

## Verification

```sh
moon check --target all --warn-list +unnecessary_annotation
moon test --target all
npm test
npm run demo
npm run demo:transfer
```

## Release gates and next milestones

- Connect the fixed Blender provider to the MoonBit adapter only after live
  qualification; never relabel mock output.
- Expand beyond primitive/building procedures without adding arbitrary code
  execution.
- Exercise interrupted-provider recovery and concurrent-writer exclusion in a
  later live-provider qualification.
- Keep manufacturing and physical effects behind separate product-owned
  authority.
