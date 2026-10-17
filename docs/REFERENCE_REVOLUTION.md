# Revolve an editable collar

Start the existing operator host and follow **Revolve a radius–height profile**
from `/reference-profile`, or open `/reference-revolution` on that same host.
The example makes a stepped collar with a central opening.

1. Enter a name, source units, and radius–height boundary points in order.
2. Choose 8–64 angular segments for a full 360° sweep around +Z.
3. Build and inspect the isometric wireframe, bounds and radial chord deviation.
4. Save the editable revolution recipe, derived layout, OBJ/STL and loss report.
5. Reopen the recipe to revise dimensions. Open the derived layout in the existing
   layout workbench for placement, combination and other supported exports.

Recipe contract: `moonmold.reference-revolution.v1`, with exactly `name`, `units`
(`mm`, `cm`, `m`, `in`), `coordinate_frame: "radius-z"`, `vertices` and `segments`
besides `contract_id`. `vertices` is one simple closed boundary, written as
3–32 radius,height pairs without a repeated closing point. Both windings work.
The boundary may be concave. Every radius is at least 0.001 mm after conversion;
both coordinate magnitudes are at most 100000 mm. Changing units reinterprets
numbers rather than converting the fields. The editable file limit is 16000 bytes.

The API is `POST /api/reference-profile/revolve`. It returns the existing
reference-layout result plus a revolution report and editable recipe export.
The report binds recipe, layout and mesh digests, retains explicit units and
segment count, and declares losses. A shared angular seam produces a closed
mesh without duplicate seam vertices. The maximum possible mesh has 2048
vertices and 4096 triangles. Existing reference parser/layout bounds also apply.

Axis-touching/crossing profiles, radial holes, partial sweeps, curved input,
crossing/touching edges, repeated points, collinear or numerically ambiguous
corners are unsupported. Retain the recipe: a derived mesh does not retain
editable radial dimensions. The chord-deviation number describes the selected
angular faceting, not a certified tolerance or overall numerical accuracy.

The UI leaves the previous build/downloads usable during unbuilt edits or a
failed request, offers Restore last built fields, and ignores stale responses.
It does not autosave; save before closing. Wireframe includes hidden edges.

This is bounded digital reference geometry, not live Blender, parametric CAD,
engineering fitness, manufacturing qualification or physical authority.

Verification: `node --test adapter/reference-revolution.test.mjs` runs geometry
and production UI handlers over actual loopback HTTP. Its DOM/canvas shim is
not graphical-browser or accessibility qualification. No MoonBit code or native
build is involved in this feature.
