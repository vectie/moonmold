# Edit several placements in a CSV table

Use a placement table when you want to change different offsets, angles or scales
for several references in one pass. Export from an applied layout, edit its numeric
columns in a spreadsheet/text editor, inspect the changes, then apply the batch.
The result is an ordinary editable layout, usable by all existing mesh, section,
drawing and GLB exports. Each source stays embedded with its original units and
OBJ-part/GLB-node selection. This is an absolute placement edit, not an arrangement
move, relative increment, source replacement or live spreadsheet connection.

## Operator: export, edit, preview, apply, save

Only Node 20+ is required:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`:

1. Open `fixtures/reference-layout.json` using **Open layout**. Apply or discard
   any pending individual placement fields first.
2. In **Edit several placements with a CSV table**, select **Prepare placement
   CSV**, then download it. Also save the editable layout; CSV contains no meshes.
3. In your editor, import comma-delimited UTF-8 and treat the first six identity
   columns as text. Keep every identity cell unchanged. Edit columns from `scale`
   onward. Preserve full numeric precision when saving as CSV. Do not save a
   workbook (`.xlsx`), semicolon-delimited file, local decimal commas or formulas.
4. Choose the edited CSV and click **Preview CSV changes**. The page lists the
   before/after scale, XYZ degrees, center/ground and XYZ mm for each changed
   instance. The current wireframe and downloads stay unchanged during preview.
   **Discard CSV preview** abandons the candidate. A failed preview cannot apply.
5. Click **Apply previewed placements** to update the layout. All rows are applied
   together; one **Undo layout change** reverses the entire batch. Redo restores it.
6. Download **Save editable layout** and **Inspection report**. The report records
   the exact parent revision, CSV text digest and before/after transformations and
   bounds. Download combined OBJ/STL or prepare a fresh drawing/GLB as usual.

Try `fixtures/reference-placement-edits.csv` with the supplied layout: it changes
`base-triangle` to scale 2, Z rotation 90° and translation [50,60,7] mm; it resets
`scaled-copy` to scale 1, no rotation/grounding and translation [-30,4,8] mm. The
inch-source instance is unchanged. Rows are deliberately reordered to demonstrate
ID-based matching without changing the layout's instance order.

Opening another layout, applying any layout change, or editing individual placement
fields clears a prepared CSV preview and download link. Selecting another CSV
clears the preview. Repeated preview clicks while busy are ignored. If the selected
file changes during a pending response, that response cannot publish an applicable
preview. Named dimensions and derived drawings follow existing revision rules
when the batch is applied. History and previews are session-only; save your files.

## Existing layout CLI

Run from the repository root. Each output filename must be new.

```sh
# Export original placements, then edit placement columns in the new CSV.
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --format placements-csv --output placements.csv

# Exercise the supplied edited table and save the reusable layout and report.
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --placements fixtures/reference-placement-edits.csv --format layout --output edited.layout.json
node bin/moonmold-reference-layout.mjs --input fixtures/reference-layout.json --placements fixtures/reference-placement-edits.csv --format json --output edited.report.json

# Reopen the saved layout using existing exports, without the CSV or old sources.
node bin/moonmold-reference-layout.mjs --input edited.layout.json --format obj --output edited.obj
node bin/moonmold-reference-layout.mjs --input edited.layout.json --format glb --output edited.glb
```

`--placements edited.csv` also supports direct `obj`, `stl` and `glb` output. Save
layout/report separately if you need continued editing or the batch change record.
The CLI applies the requested file directly; inspect default JSON/report output
before choosing a saved model if you need review. No interactive confirmation is
provided. No source input is overwritten, and existing outputs are never replaced.

Placement application cannot combine with section flags or `placements-csv` export;
first save the revised layout, then section it or export its next placement table.
Default output remains JSON. Omitting `--output` writes stdout, as before.

## Table contract

The exact header is:

```text
contract_id,base_layout_sha256,instance_id,source_sha256,source_format,source_units,scale,rotation_x_deg,rotation_y_deg,rotation_z_deg,center_and_ground,translation_x_mm,translation_y_mm,translation_z_mm
```

- The first six columns are fixed identity data. `contract_id` is
  `moonmold.reference-placements.v1`. Every row repeats the exact normalized
  source layout SHA-256, instance ID, original source-byte SHA-256, format and units.
- Include exactly one row per instance. Rows may be reordered; instances, names,
  sources and selectors are not added, deleted, renamed or reordered by this edit.
- All tables are bound to one exact applied revision, including source comments,
  name, source selectors, units and transforms. A changed layout rejects the table
  instead of rebinding it. After applying a changed table, export a new table to
  edit that new revision. Applying an unchanged table preserves layout identity.
- `scale` is dimensionless, from 0.000001 through 1000000. XYZ rotations are degrees
  about the original source origin. `center_and_ground` is true/false, case
  insensitive. XYZ translations are absolute millimetres, regardless of source
  units, applied after scale, X/Y/Z rotation and optional centering/grounding.
- All numbers must be finite decimal text; scientific notation and surrounding
  numeric/boolean whitespace are accepted. Blank cells, formulas, percentage
  formatting, thousands separators, nonfinite values and hex numbers reject.
  Identity cells do not trim whitespace or change case.
- Standard quoted cells, UTF-8 BOM, LF/CRLF, and an optional final newline are
  supported. The header and column order must remain exact. Blank rows, missing or
  extra columns, duplicate IDs and bare-CR records reject. Limits: 16000 UTF-8 bytes,
  one header and 1–16 rows. No content or macros are executed. Exported identity
  cells are fixed schema strings, validated alphanumeric-leading IDs and hashes;
  arbitrary source labels are not inserted into spreadsheet cells.

The table alone is insufficient to reconstruct the model. It cannot change source
units or selections. Use the existing source-replacement/import workflows for that.
Spreadsheet applications can automatically change IDs or round numbers: configure
text/number import deliberately and inspect the preview. No particular spreadsheet
application has been run or qualified here.

## API and lineage

- `POST /api/reference-layout/placements/export`: ordinary layout JSON body;
  returns contract, layout/geometry identities, instance count and `csv` text.
- `POST /api/reference-layout/placements/apply`: exactly `{ "layout": ..., "csv":
  "..." }`; returns the ordinary layout composition plus `placement_table`.
  This endpoint computes a candidate without persisting server/session state. The
  operator uses it for preview and applies the candidate only after the second click.

`placement_table` contains parent/result layout and geometry hashes, a SHA-256 of
exact supplied UTF-8 CSV text (including BOM/line endings if supplied), and
`changed_instances` in original layout order. Each entry carries source identity,
original units, before/after transforms and bounds in mm. Unchanged rows are omitted
from this change list but remain in the saved layout. Known losses and
`physical_authority: false` remain explicit. Save the report for this edit's lineage;
the ordinary layout schema is unchanged and stores current editable state only.

The apply body is limited to 3032000 bytes, export to 3000000. Existing 2000000
compact-JSON layout limit, 400000-byte per-source limit, 16 instances, 40000 combined
vertices/triangles and ±1e9 mm represented-coordinate bounds remain enforced by
existing composition. Invalid table/geometry fails as one batch with HTTP 400;
there is no partial edit, output write or model-store mutation.

## Verification and limits

```sh
node --test adapter/reference-placements.test.mjs
node --test adapter/reference-*.test.mjs
```

Focused tests exercise source-bound round trips (including selected OBJ, binary PLY
and selected GLB), literal changed coordinates, row reordering, mixed source units,
standard CSV interchange, stale revisions, a real CLI file edit/save/reopen/export
journey, loopback HTTP, and executed production UI handlers for preview/apply,
cancellation, retained output after failure, busy/stale-file handling, dirty fields,
and one-step Undo/Redo. UI tests use DOM/canvas doubles, not a real browser.

No MoonBit/native build, real spreadsheet/browser, live Blender, provider recovery,
client acceptance or fabrication was executed or qualified. This is a one-time
reference-placement workflow, with IEEE-double/source precision and the existing
import/export losses. It provides no persistent constraint, nonuniform scale,
topology repair, collision/clearance check, dimensional certification, engineering
fitness or physical authority. It supports PRD MM-W01/B02/N01's inspectable editable
source and explicit representation/units; it does not complete the broader client
brief, validated delivery or live-backend roadmap.
