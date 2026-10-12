# Undo and redo applied reference-layout changes

Try placement, source replacement or a cut in the existing reference-layout
workbench, inspect it, then return to the previous applied layout without finding
an older download. This is a bounded editing convenience in the current page.
Save editable layouts to keep work across reloads, closing the tab or restarting.

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`:

1. Open `fixtures/reference-measurement.layout.json`.
2. Set **Move X** to `10`, then **Apply placement**. Duplicate or remove a part
   if desired. Each successful changed layout adds one Undo state.
3. Choose **Undo layout change** to restore the previous applied sources,
   placement recipes, instance order, layout name and selected part. Inspect the
   regenerated preview, bounds and editable-layout/OBJ/STL downloads.
4. Choose **Redo layout change** to return to the later state. A successful
   different edit after Undo starts a new branch and clears Redo. A rejected edit
   or an identical applied placement keeps Redo.
5. **Save editable layout** downloads the currently restored state. History is
   not included in that file. Keep inspection/operation reports separately.

Removing the last part remains undoable. The empty state has no geometry or
stale downloads; Redo can return to it. Adding the first reference can likewise
be undone back to the initial empty state. A successfully opened saved layout
or cut recipe starts a fresh history; a failed open leaves prior history intact.

## Unapplied fields and interruptions

Undo/Redo operate on applied layouts, not individual keystrokes. If placement
fields are edited, both are disabled until **Apply placement** succeeds or you
choose **Discard unapplied placement fields**. Discard restores fields from the
current applied selection without changing geometry or history. A failed Apply
keeps the fields and history so the values can be corrected or discarded.

Restoring a nonempty state calls the existing local composition endpoint and
checks the returned exact layout and geometry identities against its snapshot.
A cut state uses the existing cut endpoint with its retained original recipe.
These operations only regenerate digital reference outputs. The server does not
persist the history. Unavailable or inconsistent responses leave the current
layout, downloads, Undo and Redo available for another explicit attempt. Buttons
are locked while an operation is pending; repeated gestures do not create
additional restore requests. There is no background retry.

## What returns, and what must be prepared again

History retains normalized layout JSON with embedded source text/base64,
explicit units, part/node selections, transforms and selected instance ID. It
also retains a cut's companion recipe so **Restore originals to revise cut**
continues to work after returning to that cut. Original source files and their
bytes are never rewritten by Undo/Redo.

A restored state is recomposed, not a replay of a physical or provider action.
Its inspection download is a fresh composition report. Prior alignment,
replacement, calibration or arrangement reports are not reattached as new
operation receipts. A cut recipe is reevaluated and its cut report regenerated.
Download original operation reports before leaving those states if you need them.

Every successful restoration clears measurement selections, named dimension
sets, sections, SVG drawings and GLB links. Reopen an exact matching dimension
companion or prepare these observations again. Previously downloaded files are
not deleted, but they do not become current evidence by navigating history.
Unapplied form contents, camera view, file picker contents and standalone
measurement/dimension edits are not Undo/Redo entries.

## Bounds and qualification

History keeps at most 20 past/future snapshots combined and at most 16 MiB of
retained UTF-16 snapshot text (two bytes per code unit for JSON, selection and
hash strings). More distant states are dropped first from the larger stack,
with a visible limit notice. This bounds retained snapshot text, not total
browser memory: the current result, object overhead, temporary requests and
rendered geometry are additional. Large source layouts may therefore retain
fewer than 20 states. History is page-local; there is no localStorage, database,
server history, session recovery or new on-disk format.

The new functional tests execute the actual served page script with a minimal
DOM/canvas contract fixture and real production composition functions. One case
loads the page and sends its requests through the real Node loopback server.
They check exact saved bytes/geometry/exports, source replacement, cut recipes,
empty states, repeated pending gestures, failed restores, unapplied fields,
branching and both bounds.

```sh
node --test adapter/reference-history.test.mjs
node --test adapter/reference-*.test.mjs
```

This verifies JavaScript handlers and the existing Node digital geometry lane.
It does not qualify graphical browser rendering/accessibility, Rabbita,
MoonBit/native, Blender, provider, engineering, manufacturing or physical use.
PRD trace: MM-W01 (editable representations and lineage) and MM-W04 (operator
load, inspect and review). Undo is an editing action, not a named acceptance
record or approval of a design.
