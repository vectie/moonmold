# Downloadable digital box delivery

The operator now has a bounded **deterministic mock / fixture-reference-only**
delivery path. It produces usable semantic JSON, Wavefront OBJ and SVG files
from the actual durable MoonBit adapter journal. It is not Blender output,
general parametric CAD, engineering qualification or fabrication authority.

## Operator journey

1. In **Digital delivery**, fill in the brief. Its project/model must match the
   operation editor. Set a stable commitment reference, revision, intended use,
   dimensions in millimeters, declared scene units, constraints and review
   criteria. The first supported offer is editable-source plus presentation.
2. Freeze the brief **before** executing the new design or change. Its exact
   reference is added to subsequent operation references. A changed brief needs
   a new revision; an existing revision is never overwritten.
3. Create a model, validate and execute the **Add box** operation using object
   ID `primary-mass`, and set its width/depth/height to the frozen dimensions.
   Optional declared box translations and material tags are supported. Validation
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
7. For a revision, freeze a new brief before changing the box/translation, then
   execute and export again. Earlier packages and reviews remain readable and
   are marked historical when a later model change exists. A new package starts
   with no inherited package review. The change report names the previous package
   and lists added, removed and changed objects with before/after values.

## Geometry convention and limitations

- Only boxes, absolute XYZ translations and retained material IDs are rendered.
  Re-declaring a box replaces its dimensions and resets translation/material.
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
  coordinate conversion. Other frames, cylinders and booleans return a specific
  unsupported-delivery error; their native evidence remains available.
- Boxes are centered on their translation. OBJ contains eight vertices and six
  outward-oriented quad faces per box. Overlapping boxes are separate solids;
  they are not fused, collision-checked or manifold-qualified.
- SVG is an illustrative isometric projection. It does not prove engineering
  dimensions or correct multi-object occlusion. Material fidelity, textures,
  measured mass, tolerances and physical suitability are not qualified.
- The dimensions of `primary-mass`, declared units and frame are checked against
  the frozen brief. Other constraints and review criteria are retained for human
  evaluation, not declared automatically satisfied.
- `editable-source.json` can be opened and edited in any text editor. Apply its
  supported operation parameters as new governed requests to revise the model.
  There is no arbitrary script, bulk source-import or physical-device interface.
  `presentation.obj` is directly editable in a mesh editor as a derived sibling.

## HTTP contract

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
brief freeze, box changes, export, both file download routes, recovery and named
package review. Test reviewer names are fixtures, not real human acceptance.
OBJ vertices, bounds, units and face orientation are parsed in tests. SVG pixels
are inspected through an installed static raster library. Browser interaction,
live Blender, resource ceilings, real model fidelity, external reviewer/client
acceptance and physical use remain unqualified.
