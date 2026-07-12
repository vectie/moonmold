# MoonMold Agent Guide

## Role

Work on governed spatial intent, editable digital models, representation
lineage, semantic adapter operations, and validation evidence.

## Required boundaries

- Keep source, tests, fixtures, generated state, and evidence under
  `/Users/kq/moonsuite`.
- Use the MoonBit agent guide for MoonBit changes.
- Preserve exact semantic operation schemas. Do not add arbitrary Python,
  script, shell, eval, expression, URL, or physical-device surfaces.
- Treat presentation, simulation, and manufacturing outputs as derived
  siblings. They cannot silently replace engineering geometry.
- Do not label mock evidence as Blender evidence.
- A manufacturing candidate is analysis data, never fabrication authority.
- Do not depend on sibling source repositories. Exchange portable serialized
  contracts through versioned integration points.

## Validation

Run:

```sh
moon fmt
moon info
moon check --target all --warn-list +unnecessary_annotation
moon test --target all
npm test
```

Run both demo fixtures when changing operation compilation, representation
policy, canonicalization, or experiment reporting.

