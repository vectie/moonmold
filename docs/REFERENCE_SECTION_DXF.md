# Reuse reference sections in CAD

Export the last applied reference geometry as a 2D ASCII DXF drawing, with actual
millimetre coordinates and one independently selectable layer per layout instance.
This helps a designer reuse a model's measured slice in another drawing editor
without tracing an auto-fitted SVG. The editable layout and section JSON remain
the source and full observation record; DXF is a derived digital sibling.

## Operator

Run `node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193`, open
`http://127.0.0.1:4193/reference-layout`, and load
`fixtures/reference-section-dxf.layout.json`.

1. Apply any placement edits first.
2. Under **Export a placed cross-section for CAD**, choose Z and 25 mm.
3. **Calculate section and DXF**. The example produces eleven independent line
   segments and one point contact. One coplanar sheet is omitted; the instance
   above the plane is empty. Both still have layers and metadata.
4. Save **Download section DXF** and **Download section JSON**. SVG previews the
   observation; CSV is useful for numeric inspection. Save editable layout to
   retain the original sources and placement recipes.
5. Open/import the DXF in a drawing editor. It declares millimetres, but confirm
   the destination editor's import scale. Hide/select an instance's `MM_01_...`
   layer to work on that reference separately.

At Z=25 the rotated cm box projects to X=70..100, Y=50..70 mm. Its eight emitted
segments sum to 100 mm. The translated binary STL tetrahedron projects to
X=150..160, Y=0..15 mm with three segments. The point contact is at (0,0).
These are synthetic observations, not engineering qualifications.

**Use layout midpoint** fills the selected world axis midpoint without running
an operation. Changing the plane preserves the last calculated downloads and
labels them as such. A successful layout change, pending placement edit, removal,
or reopen clears the old section. Failed section requests retain the previous
result. Repeated clicks while busy do not submit another request. Sections never
change placements or semantic scene state. The single-reference workbench at
`/reference-mesh` also includes a DXF download after **Calculate section**.

## CLI and HTTP

Output files must be new. Omit `--output` for stdout. Section JSON also includes
`exports.dxf` alongside the existing SVG and CSV. No external npm dependencies,
Blender, MoonBit build or network service is needed.

```sh
node bin/moonmold-reference-layout.mjs --input fixtures/reference-section-dxf.layout.json --section-axis z --section-position 25 --format dxf --output study-z25.dxf
node bin/moonmold-reference-layout.mjs --input fixtures/reference-section-dxf.layout.json --section-axis z --section-position 25 --format json --output study-z25.json
node bin/moonmold-reference-mesh.mjs --input fixtures/reference-section-cube.obj --units mm --section-axis y --section-position-mm 10 --format dxf --output cube-y10.dxf
```

`POST /api/reference-layout/section` accepts exactly `{layout, plane}`, where
`layout` is a portable `moonmold.reference-layout.v1` document and `plane` is
`{"axis":"z","position_mm":25}`. Axis must be lowercase x/y/z; position must be
finite and within ±1e9 mm. The response is the existing
`moonmold.reference-layout-section.v1`, with additional `exports.dxf` text.
The layout validates completely before computing observations. Request JSON is
limited to 3100000 bytes; existing layout/source/geometry limits still apply.
Invalid input returns HTTP 400 without changing any scene or file. The existing
single-mesh section endpoint likewise returns DXF in its exports.

## Format, coordinates and lineage

- ASCII DXF AutoCAD 2000 (`AC1015`), CRLF, explicit `$INSUNITS=4` (millimetres),
  decimal length display. Full JavaScript numeric precision is written; display
  precision does not round entity geometry.
- X-normal sections project world Y/Z to DXF X/Y. Y-normal sections use X/Z;
  Z-normal sections use X/Y. DXF Z is always zero. There is no auto-fit, translation
  to the page, axis reflection, scale conversion or unit guessing. The original
  plane coordinate is in metadata and section JSON, not the flattened Z values.
- Each finite section segment becomes one `LINE`; each contact becomes one
  `POINT`. There are no contours, closed polylines, dimensions, hatches or fills.
  Point appearance depends on the reader; point entities retain numeric positions.
- Layer names are `MM_<two-digit ordinal>_<instance ID>`, replacing non-ASCII
  letters/digits/underscore/dash with underscores and truncating the result to
  31 characters. Ordinals follow layout order and prevent collisions after
  truncation, punctuation conversion or case folding. A single reference uses
  `MM_01_reference`. Empty and coplanar-only instances still have layers.
- `999` comments beginning `MM_META ` concatenate to a JSON record with contract
  `moonmold.reference-section-dxf.v1`: full instance-to-layer mapping, original
  plane/projection, exact section/layout/geometry/source/transform hashes, statuses,
  counts, omissions and limitations. Each comment is at most 238 ASCII characters.
  They contain data only. CAD readers can discard comments on re-save, so keep
  the section JSON for triangle identities, placements, per-instance tolerances
  and source losses. The original section identity/hash definition is unchanged.
- Coincident instances remain separate entities and layers. Existing section
  tolerance, exact within-instance duplicate handling, point-contact and coplanar
  omission rules are unchanged. No endpoint welding, contour joining, gap closing,
  solid inference, validation certificate or manufacturing authority is added.

Implementation follows Autodesk's [group-code format](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-89CB823D-614D-4D1E-8204-568EC72DF869.htm),
[code reference](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-3F0380A5-1C15-464D-BC66-2C5F094BCFB9.htm),
[POINT](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-9C6AD32D-769D-4213-85A4-CA9CCB5C5317.htm),
[LAYER](https://help.autodesk.com/cloudhelp/2015/ENU/AutoCAD-DXF/files/GUID-D94802B0-8BE8-4AC9-8054-17197688AFDB.htm) and
[BLOCK_RECORD](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-A1FD1934-7EF5-4D35-A4B0-F8AE54A9A20A.htm) definitions.
The independent author check used installed ezdxf 1.4.4 to read and audit actual
CLI files and inspect their entities. This does not establish compatibility with
every CAD application. Graphical CAD/browser rendering was not exercised.

Focused checks: `node --test adapter/reference-section-dxf.test.mjs
adapter/reference-section.test.mjs adapter/reference-layout-section.test.mjs
adapter/reference-drawing.test.mjs`.
