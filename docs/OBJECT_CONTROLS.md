# Typed object controls

The operator now prepares the existing semantic operations through labeled
fields. These controls do not add modeling operations or change execution,
receipt, delivery or named-review authority.

## Use

1. Prepare/freeze the digital brief as before. Choose **Create model**, set its
   name and export units (mm, cm or m), then validate and execute. The typed
   frame is z-up-right-handed. Creating an existing model resets its scene.
2. Choose **Add box** and enter object ID, width, depth and height, or **Add
   cylinder** and enter object ID, radius, height and sides. Validate and
   execute the resulting operation. All dimensions are whole millimetres,
   regardless of the model/export unit.
3. Choose **Move object**, name an existing object and enter its absolute X, Y
   and Z positions in whole millimetres. Negative positions are supported.
   Executing the same position again does not add another movement amount.
4. **Refresh retained objects** reads the selected project/model's current
   retained primitive inventory from verified applied semantic operations.
   Inspect ID, kind, dimensions, absolute position and material plus an
   illustrative preview. Select an object, then **Prepare move**, **Prepare
   replacement**, or **Prepare duplicate**. Selection and refresh preserve
   unfinished fields. Preparation explicitly replaces the operation draft;
   it never saves, validates or executes it.
   - Move starts with that object's absolute position in mm
   - Replacement keeps its ID and kind/dimensions/sides; executing the create
     resets position to origin and material to none
   - Duplicate proposes an unused `-copy-N` ID, copying kind/dimensions/sides
     only. It also starts at origin with no material; move it separately
   - Preparation binds the snapshot's **workspace-global** scene parent, not
     a per-model/source digest. If other work happened, explicit execution
     rejects that stale parent. Refresh and reselect before preparing again
5. **Copy last object operation** copies the latest successful box, cylinder
   or move operation for the selected project/model into a new draft, keeping
   the next request identity and current scene parent. This older shortcut
   remains available alongside the retained object browser.
6. Choose a representation, validate and execute its export, then build and
   inspect the digital delivery package. Named review still binds the exact
   retained artifact/receipt. Changing fields marks old results historical;
   it does not alter old downloads or transfer their approvals.

Use a new ID to add a primitive. Executing a create operation with an existing
ID replaces its geometry and resets its translation/material. There is no new
resize operation, rotation, boolean or general CAD editor. Copying an old
operation only prepares parameters; execution remains explicit.

## Input and persistence contract

- Model/object identifiers: 1–128 ASCII characters. Start with a letter or
  digit, then use letters, digits, dot, underscore, colon or hyphen
- Width/depth/height/radius: decimal integers from 1 through 2147483647 mm
- X/Y/Z: decimal integers from -2147483648 through 2147483647 mm
- Cylinder sides: integers from 8 through 256; output remains a faceted mesh
- No guessed unit conversion: operation fields remain widthMm/radiusMm/etc.
  Model units control representation coordinates, including OBJ conversion
- Incomplete or invalid typed input stays visible and blocks Save, Validate
  and Execute. Advanced JSON continues to show the last complete values until
  the field is corrected; it is never dispatched on behalf of invalid input
- While a request is in flight, typed fields/operation selectors are disabled.
  Repeated queued dispatches do not start another operation
- Unsaved fields live only in this page. Save a complete request and use its
  returned workspace-relative reference to load it later. Recovery restores
  the latest durable operation, not unfinished edits. Choosing another
  operation replaces unsaved parameters, as disclosed beside the controls

## Retained scene contract and limits

`GET /api/scene/retained?project_id=…&model_id=…` is read-only. It reads one
complete as-of journal snapshot, verifies every workspace entry through the
durable attempt loader, and filters only applied operations into this model.
No-op replay is evidence but never reapplied geometry or a new workspace head.
The verified loader binds no-op receipts to an earlier independently verified
same-key/same-operation applied origin. Native replay receipts may name that
origin's old digest even when the workspace has since advanced.

The response separates workspace parent, journal digest and model source
digest. All displayed dimensions and translations are mm, including models
declared in cm or m. Model re-creation clears its object map; primitive
re-declaration resets translation/material. Empty created models are valid
inventories. Unsupported operations (including booleans), unsupported frames,
broken evidence or an observed concurrent journal change never produce an
approximate/partial inventory. Unsupported history is conservative: later
model reset does not erase the requirement to account for that history.

Limits are 4 MiB journal bytes, 2,000 workspace journal entries, and 100 model
objects. Crossing a limit fails closed instead of silently omitting objects.
Refresh errors clear the inventory/selection and preserve the operation draft.
Project/model changes and request load/recovery clear old selections. Late
responses cannot populate a newer model or refresh generation. Initial
recovery arriving after unsaved edits preserves those fields. After page reload
or recovery, use Refresh retained objects; inventory selection is not persisted.

This is a verified retained snapshot, not an automatic live subscription.
Changes by another operator may occur after it was read. Preparation retains
its workspace parent so normal stale-parent execution checks still apply.
Existing historical delivery packages are not used as a current inventory.

## Advanced JSON

The **Advanced semantic JSON** disclosure retains the existing method and
exact parameter editor. Loading a recognized exact model/box/cylinder/move
schema populates its typed fields. Unknown methods, extra keys, unsupported
frames, fractional values or values outside native integer bounds remain in
advanced JSON without coercion. Raw text edits remain byte-for-byte in the
draft; saved/loaded JSON preserves parameter values, with normal JSON
reformatting. Changing the method alone does not reinterpret incompatible
parameters as another primitive. Host validation remains authoritative.

## Verification boundary

Tests cover typed semantic JSON, decimal/native bounds, units, signed absolute
movement, malformed/incomplete drafts, method changes, load/recovery, busy and
repeated actions, prior validation invalidation and immutable delivery history.
The compiled MoonBit test emits operations that are compared with
`fixtures/typed-object-controls.json`. A repository-native Node test sends
those operations through the actual durable native adapter, then checks
editable-source JSON, parsed OBJ vertices/faces/bounds, SVG truth labels, file
SHA-256s, stale-parent rejection and unchanged old downloads for mm/cm/m.

This is synthetic source/unit/build and native-adapter evidence. It does not
qualify an interactive browser, the user's Mac, live Blender, other providers,
fabrication, engineering fitness, manufacturing safety or physical authority.
