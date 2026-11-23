# MoonMold Agent Guide

## Role

Work on governed spatial intent, editable digital models, representation
lineage, semantic adapter operations, and validation evidence.

## Working style

- Work from first principles: establish the real user goal, constraints, and
  success criteria before choosing an implementation. Use the existing task
  context to resolve routine choices and continue authorized work.
- Fix bugs at the root cause; do not cover symptoms with unrelated patches.
- Read `docs/project/HANDOFF.md` before each new task when it exists, and record
  newly discovered pitfalls there. Create it when there is a pitfall to record.
- Include performance cost in production design and acceptance, including
  startup, rendering, interaction latency, and build/link time where relevant.
- Use focused checks while iterating. Complete the required checks for the
  finished change; broaden or repeat testing when a failure, new change, or
  unresolved risk warrants it.

## UI/UX

- Avoid unnecessary secondary labels and descriptions; let the layout explain
  relationships and the next action.
- Every element must serve a clear user purpose. Remove slogans, decoration,
  duplicate information, and repeated status or counts.
- Show explanations for abnormal states or required actions. Put secondary
  details behind progressive disclosure, close to the work they explain.
  Keep errors, recovery actions, and consequential choices visible.
- Stay consistent with existing screens. Prefer removing or simplifying over
  adding; a local change should not trigger a whole-page redesign.
- A first-time user should understand what to click next and what will happen.
  Keep task, sources, and output connected; open related tools locally and
  provide a clear return path when navigation is necessary.
- Follow the shared `moonvis/docs/ICON_LANGUAGE.md` guidance. Use MoonMold's
  shared styles and icons; compare MoonTown's controls and MoonDesk's
  `ui/rabbita-desk/styles/type-hierarchy.css` for the shared control hierarchy.
  Align typography, control heights, spacing, corners, and row/column baselines
  across pages, drawers, and dialogs. Keep copied product assets local; do not
  add runtime source dependencies on sibling repositories.
- Use the established icon set for familiar, repeated actions, with localized
  accessible names and tooltips. Keep meaningful names and necessary form
  labels; do not make users guess an unfamiliar action from an icon.
- Localize system labels consistently in the selected language. Preserve
  actual filenames, paths, identifiers, and user-authored content.
- Give empty, loading, and error states distinct behavior with concise copy.
  Avoid duplicate empty messages, filters with nothing to filter, and actions
  that only open an empty surface.
- Verify changed layouts and interactions in the relevant UI states. When the
  task includes a packaged-app update, install the new resources and verify
  the actual app as well as the browser preview.

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

