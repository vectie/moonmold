# Model workspace

The default MoonMold page connects source references, a central model viewport,
and a selected-object inspector. Profile extrusion, profile revolution, and
single-mesh workbenches share this layout. The semantic operator remains
available at `/operations`.

## Interaction and representation

- Solid view uses local WebGL assets, flat face normals and two-sided shading.
  Drag to orbit continuously, scroll to zoom, and Shift/right-drag to pan.
  Two pointers support pinch and pan. Arrow keys rotate, plus/minus zoom,
  Home fits, and 1–5 select isometric/front/side/top/bottom views.
- Source visibility, colors and the exploded view affect presentation only.
  Chunked references with the same source name move together when exploded.
  Applied double-precision millimetre geometry, source bytes, exports, history
  and semantic operation schemas retain their existing ownership.
- Inspect switches to the existing wireframe so its point labels, measurement
  arms and defect overlays remain visible. Solid is available beside it.
- Native forms retain their handlers, disabled controls, constraints and
  operation-local results. Invalid input leaves the successful model visible.
  Occasional tools and qualification details are disclosed locally.
- Camera interaction updates uniforms and schedules drawing only when needed.
  Mesh buffers are reused until the scene object changes. Positions are
  centered and normalized before conversion to GPU float32. No idle animation
  loop, framework or remote asset dependency was added.
- Desktop panels scroll independently. Below 760 px the model comes first,
  followed by sources and inspector. Focus rings and reduced-motion preferences
  are retained. A failed WebGL initialization/context loss exposes wireframe
  with a retry action.

## Shared visual language

Working-style and UI/UX guidance in `AGENTS.md` was adapted from MoonTown.
Typography and controls follow the MoonDesk hierarchy: 13 px controls,
14 px body, 17 px panel titles, restrained panel borders and 6 px control
corners. The `package`, `undo`, `redo` and `expand` SVGs are local copies of
MoonDesk's `ui/rabbita-desk/assets/ui-icons` assets, used in accordance with
MoonVis `docs/ICON_LANGUAGE.md`. Sibling repositories are design references,
not runtime dependencies.

## Verification on 2026-11-23

- Full Node suite: 556 passed, 2 pre-existing opt-in skips, 0 failures.
- Core MoonBit tests: 18 per wasm/wasm-gc/JS target, 21 native, all passed;
  all-target checks and interface generation passed.
- Rabbita UI: 75 JS tests passed; all-target check and production build passed.
  Existing MoonBit deprecation warnings remain. Generated public interfaces
  are unchanged.
- Focused final viewer/profile/revolution checks: 22 passed. Viewer checks
  cover source immutability, normalization, multi-turn orbit, finite named
  views, GPU buffer reuse/disposal, and bounded local asset routing.
- Actual browser verification covered the E1 12-instance layout, drag orbit,
  side view, source visibility, exploded view, inline vertex measurement,
  layout download, failed-open recovery, profile height revision, a revolved
  collar, standalone STL import and the advanced operations page. A hidden
  390 × 844 browser surface verified the stacked mobile layout; temporary
  viewport overrides were reset.
- Camera/visibility tests kept layout identity
  `be636b8adbec65b449f853da895caa1899b5179c66ff9331ef1e00b1ed85a1aa`
  and geometry identity
  `8a7743cdedff6168aeed38adcebf28fc5a3a4f45a1b22582a63e53e24edf3336`.

The E1 editable input remains
`exports/e1-neck-transfer-20261123/trial-v03/stepped-review.layout.json`
relative to the MoonSuite workspace. This UI work does not change the trial
housing's fit assumptions or its incomplete printable-solid status. No print
was submitted.
