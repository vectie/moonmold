# Working notes

## Model workspace and 3D preview

- The legacy reference-layout page exposed every specialist operation as a
  full-height form before the model. Keep source, viewport and selected-object
  controls connected; disclose occasional tools without removing their native
  handlers, validation or current-state messages.
- Reference wireframes include hidden edges. They are useful for measurements
  and defect overlays but do not provide a readable solid preview of dense CAD
  meshes. Keep both representations and distinguish presentation-only camera
  state from applied geometry and exports.
- The editable layout is the retained source. GLB-to-layout reimport can expand
  coordinates past the compact JSON limit even when the original layout and
  native GLB export fit; reopen the saved layout instead of routing it through
  GLB. Do not silently simplify the engineering/reference data.
- `/Users/kq/Workspace/moonmold` and the older MoonSuite source checkout are
  distinct repositories. This change is based on the newer workspace commit
  18e7686 in the MoonSuite worktree `moonmold-solid-preview`; preserve unrelated
  user files such as `adapter/operator-validation.test.mjs` in the original
  checkout.
- Reference forms may publish live results in following siblings, and native
  code can still use hidden help nodes by ID. Move each operation's result and
  downloads with it, and preserve identified nodes when removing legacy prose.
  In particular, removing `source-help` interrupts a successful mesh import
  before its downloads are regenerated.
- The model workspace is the operator server's default `/` route. The advanced
  semantic operator remains at `/operations`. Both use the same server and
  workspace; no new device or semantic execution endpoints were introduced.
- Local verification runs the updated source on port 4193 with the workspace
  `/Users/kq/moonsuite`. The old source checkout and its durable files remain
  intact. A temporary verification server may also be on port 4194.
