# Downloadable digital box and cylinder delivery

The operator now has a bounded **deterministic mock / fixture-reference-only**
delivery path. It produces usable semantic JSON, Wavefront OBJ and SVG files
from the actual durable MoonBit adapter journal. It is not Blender output,
general parametric CAD, engineering qualification or fabrication authority.

## Operator journey

1. In **Digital delivery**, fill in the structured brief. Its project/model must match the
   operation editor. Set a stable commitment reference, revision, intended use,
   dimensions in millimeters, declared scene units, constraints and review
   criteria. The first supported offer is editable-source plus presentation.
   **Use current project/model** updates identities without resetting fields.
   Advanced JSON remains available for values the form cannot show losslessly.
2. Freeze the brief **before** executing the new design or change. Its exact
   reference is added to subsequent operation references. A changed brief needs
   a new revision; an existing revision is never overwritten.
3. Create a model, validate and execute the **Add box** operation using object
   ID `primary-mass`, and set its width/depth/height to the frozen dimensions.
   Use **Add cylinder** to add `support-cylinder` with explicit `radiusMm`,
   `heightMm` and integer `sides` (8–256); edit the object ID to add more shapes.
   To make the primary object a cylinder instead, use `primary-mass` and set the
   frozen brief width/depth to twice its radius and height to its height. These
   are nominal dimensions, not the inscribed polygon's axis-aligned bounds.
   Optional declared primitive translations and material tags are supported. Validation
   and execution remain distinct; the operator does not execute automatically.
4. Choose **Presentation**, validate and execute its immutable representation
   export, then prepare the digital delivery package. This packages the selected
   real execution attempt rather than treating a validation receipt as a build.
5. Download and inspect the editable source, OBJ, SVG, brief and reports. The
   bundle is a portable JSON envelope containing every file's UTF-8 text, manifest,
   SHA-256 and reviews. Individual files have direct attachment downloads.
6. Use the existing reviewer, decision and notes fields to record the package
   review. Its receipt retains the exact native receipt digest **and** delivery
   manifest digest. Package generation is not human approval. Approve,
   request-changes and reject keep their existing meanings. This is a named
   operator review, not verified client acceptance or payment.
7. For a revision, choose **Start next revision from draft**, edit its fields,
   and freeze before changing a box/cylinder/translation, then
   execute and export again. Earlier packages and reviews remain readable and
   are marked historical when a later model change exists. A new package starts
   with no inherited package review. The change report names the previous package
   and lists added, removed and changed objects with before/after values.
   After reload, **Load selected package brief** explicitly loads its exact
   retained content for revision. Unsaved brief fields are page-local. See
   [Structured digital brief](BRIEF_CONTROLS.md) for draft and recovery limits.

## Geometry convention and limitations

- Boxes, cylinders, absolute XYZ translations and retained material IDs are rendered.
  Re-declaring a primitive replaces its kind/dimensions/sides and resets translation/material.
  Create-model resets that model's object collection.
- Idempotent no-op attempts remain in provenance but are not applied again to
  geometry; replaying a completed box does not reset a later translation or
  establish a new design revision. Package construction selects an applied
  presentation export; replaying an earlier export key cannot bind later
  geometry to that earlier receipt. Retrying the original durable attempt remains
  supported because it returns its original applied receipt.
- Geometry dimensions and translations are always millimeters, as declared by
  the semantic parameter names. Scene units may be mm, cm or m. OBJ numbers are
  divided by 1, 10 or 1000 respectively; the importer must be configured to those
  units because OBJ itself has no universal unit metadata.
- Only z-up-right-handed is supported by this renderer. There is no silent
  coordinate conversion. Other frames and booleans return a specific
  unsupported-delivery error; their native evidence remains available.
- Boxes are centered on their translation. OBJ contains eight vertices and six
  outward-oriented quad faces per box. Overlapping boxes are separate solids;
  they are not fused, collision-checked or manifold-qualified.
- Cylinders are centered on their translation, with axis +Z. An N-sided cylinder
  has two rings of N vertices, starting at +X and proceeding counterclockwise
  viewed from +Z. It exports N outward quad side faces and two outward ngon caps.
  Sides is required, never defaulted by the renderer. Flat polygon facets
  approximate a circular cylinder; no smooth normals or analytic CAD surface
  are exported. Ring vertices lie at the nominal radius. The maximum radial
  deviation of an edge midpoint is `radius * (1 - cos(pi / sides))` millimeters,
  retained per cylinder in the loss report. It is not a physical tolerance claim.
  Odd side counts may not span the nominal diameter along either axis.
- `validation.json` reports actual tessellated mesh bounds, separate box/cylinder
  counts and, for cylinder scenes, the nominal brief check. `editable-source.json`
  keeps explicit radius/height/sides, pose, material tag and exact semantic history.
  Any retained cylinder operation history uses `moonmold.editable-primitive-source.v1`,
  even after a cylinder is replaced by a box or a model reset removes it.
  Genuinely cylinder-free histories keep `moonmold.editable-box-source.v1` and
  the original box-only package bytes.
  No migration or rewrite of retained packages or reviews is performed.
- SVG is an illustrative isometric projection. It does not prove engineering
  dimensions or correct multi-object occlusion. Material fidelity, textures,
  measured mass, tolerances and physical suitability are not qualified.
- The dimensions of `primary-mass`, declared units and frame are checked against
  the frozen brief using nominal primitive dimensions. Other constraints and review criteria are retained for human
  evaluation, not declared automatically satisfied.
- `editable-source.json` can be opened and edited in any text editor. Apply its
  supported operation parameters as new governed requests to revise the model.
  There is no arbitrary script, bulk source-import or physical-device interface.
  `presentation.obj` is directly editable in a mesh editor as a derived sibling.

## HTTP contract

### Read the saved report fields

Open a saved package by pasting its exact `delivery-…` ID into **Saved delivery ID**
and choosing **Open saved delivery**, or use the package recovered on reload.
Expand **Changes and checks · exact saved delivery**. The reader shows complete
field values from `change-report.json`, `loss-report.json`, and `validation.json`,
including before/after primitive dimensions, positions and material IDs, added and
removed IDs, cylinder tessellation losses, and pending human criteria. Empty arrays
are shown explicitly as `[]`. It does not derive additional findings.

The host verifies the package ID against its manifest, the exact manifest digest,
all eight member byte lengths/digests, source and brief member bindings, and the
retained native receipt before returning these fields. The UI retains the package,
manifest, brief and per-report digest labels and checks per-report binding before
rendering. All content is escaped text; no SVG or HTML is inserted into the page.
The separate preview/download and named-review actions retain their existing scope.

Interpretation accepts only the existing v1 report contracts. Each report is limited
to the exact recursively typed historical field shapes, including native execution
receipt/result fields, `ValidationFinding` severity strings (`Info`, `Warning`,
`Error`), boolean acceptance, finding arrays, and closed primitive/tessellation
records. Legacy validation has no cylinder extension fields; the cylinder variant
requires `cylinder_count`, `object_count`, and `bounds_scope` together, correctly
typed. Unknown nested fields, partial variants and coerced identities are unavailable.
The reader renders recorded findings without deriving an acceptance decision.

Each report is limited
to 256 KiB of UTF-8 JSON, 2,048 displayed leaf fields, depth 16, 4,096 UTF-16 code
units per field path and 16,384 per text value. A member that is malformed,
unsupported, or over those limits shows **Interpretation unavailable**, with its
exact download still available. It is never partially truncated or treated as a
passed check. Missing or altered members instead reject the whole package read
and download through existing integrity checks. Historical reads remain historical
after scene edits. Selection requests use generation and exact identity guards;
late callbacks cannot replace the selected report. Refresh retries the same ID.

Reading, refreshing and opening reports do not write packages, reviews, scene,
journal, geometry, or a new report schema. Named review remains a separate action.
The committed `fixtures/reader-workspace` is the synthetic native R29 material
fixture, copied byte-for-byte for reproducible read tests. It is not new native
execution or customer evidence. `adapter/delivery-reader.test.mjs` uses real loopback
HTTP and can emit snapshots for the compiled UI bridge with
`MOONMOLD_READER_EVIDENCE_DIR`; the bridge receives them in
`MOONMOLD_READER_HOST_FIXTURE`.

- `POST /api/delivery/brief` with `{brief}` returns `{reference,digest,brief}`.
  The immutable record includes the exact pre-execution journal prefix.
- `POST /api/delivery/build` with `{attempt_id,brief_ref}` returns the exact
  manifest, `manifest_digest`, individual file URLs, `download_url`, `reviews`,
  `review_status` and `stale`. `attempt_id` must be a presentation execution.
- `GET /api/delivery/<package_id>` returns the same current projection.
- `GET /api/delivery/<package_id>/bundle` downloads the immutable unreviewed JSON
  bundle. After review, the projection's download URL instead selects
  `/api/delivery/<package_id>/reviewed/<review_sha256>`, which downloads the exact
  named review alongside the frozen manifest/files. Later reviews use new URLs;
  neither a later decision nor a changed model rewrites an earlier download.
- `GET /api/delivery/<package_id>/file/<filename>` downloads a listed member.
- `POST /api/review` accepts optional paired `delivery_id`/`delivery_digest`
  fields alongside existing `attempt_id`, reviewer, decision and notes. Omit
  both for the unchanged ordinary receipt review path.
- `GET /api/recovery/latest` additionally includes the latest retained delivery
  for the recovered model, including historical status and exact package reviews.

The immutable manifest binds brief, exact native attempt/receipt, semantic
source and every file's SHA-256. Downloads and package review require all eight
members and matching bytes, including editable source and loss report. An
incomplete package cannot be mistaken for a complete delivery. This changes no
MoonFlow reviewer policy, native operation schema, authority ceiling or provider
qualification policy.

## Qualification boundary

Direct no-listener tests exercise the actual native adapter, request validation,
brief freeze, box and cylinder changes, mixed scenes, export, both file download routes, recovery and named
package review. Test reviewer names are fixtures, not real human acceptance.
OBJ vertices, radius/height, bounds, units, face orientation and directed edge
closure are parsed in tests for 8, 9, 31, 32, 255 and 256 sides. These fixture
checks do not qualify arbitrary imported topology. SVG is also inspected through
an installed static raster library. Browser interaction,
live Blender, resource ceilings, real model fidelity, external reviewer/client
acceptance and physical use remain unqualified.
