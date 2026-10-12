# Named vertex dimension sheets

Collect up to 12 named vertex-to-vertex observations for one exact reference
layout revision. Export a three-view SVG with endpoint markers, dashed projected
lines, and a visible ledger of true 3D distances and signed XYZ deltas. Save the
small companion JSON with the editable layout to reopen the same collection.
This adds selected, named observations to the existing overall-bounds drawing;
it does not change geometry, constrain a design or certify a physical use.

## Operator workflow

Only Node 20+ is needed. Run:

```sh
node bin/moonmold-operator.mjs --workspace "$PWD" --port 4193
```

Open `http://127.0.0.1:4193/reference-layout`.

1. Open `fixtures/reference-drawing.layout.json` and inspect its applied geometry.
2. Under **Save named dimensions and an annotated drawing**, open
   `fixtures/reference-drawing.dimensions.json`. This example includes the base
   width, base diagonal and an offset between the base and raised block.
3. Click **Prepare named dimension sheet**. Download the SVG and drawing report.
4. To add another pair, use **Measure two placed vertices** above. Choose local
   zero-based vertex indices, measure, enter a unique name and click **Add
   measured pair**. Selecting another pair preserves the saved collection.
5. Remove selected pairs or clear the set as needed. Names are 1–60 characters,
   case-sensitive and unique, without outer whitespace or ASCII control characters.
   Names must be XML 1.0-compatible: lone UTF-16 surrogates and U+FFFE/U+FFFF
   reject explicitly before export. Valid supplementary characters, including
   emoji, are preserved; forbidden characters are never silently replaced.
6. Save the companion JSON and editable layout separately. Reopen the layout
   first and then its companion to reproduce identical sheet bytes.

The UI checks response identity against the applied layout and requested
collection. Repeated actions are ignored while busy. Failed or mismatched
exports preserve the last valid sheet. A newer collection or layout prevents
an older pending response from publishing download links. Malformed or stale
companion files leave the current collection unchanged.

Pending placement edits clear prepared sheet links and disable dimension
operations. The saved companion remains an observation of the previous applied
revision. Applying a changed layout clears the collection; selecting the current
placement to discard pending edits leaves its collection usable. An unchanged
save/reopen preserves the set. Source-only changes, including comments, require
fresh selections even when the geometry digest is unchanged. There is no silent
rebinding, automatic remeasurement of stale names or persistent constraint.

## CLI

```sh
node bin/moonmold-reference-dimensions.mjs --input fixtures/reference-drawing.layout.json --dimensions fixtures/reference-drawing.dimensions.json --output named-dimensions.svg
node bin/moonmold-reference-dimensions.mjs --input fixtures/reference-drawing.layout.json --dimensions fixtures/reference-drawing.dimensions.json --format json --output named-dimensions.report.json
```

The default format is SVG. Omit `--output` for stdout. Outputs must not already
exist. Inputs are strict UTF-8 JSON: the layout file is at most 3000000 bytes and
the companion at most 32000 bytes. Unsupported/duplicate flags, malformed
companions or stale identities fail before output creation.

## API and companion contract

`POST /api/reference-layout/dimension-drawing` accepts exactly `layout` and
`dimensions`. `layout` is an ordinary `moonmold.reference-layout.v1` document.
`dimensions` is the companion:

```json
{
  "contract_id": "moonmold.reference-dimensions.v1",
  "expected_layout_sha256": "64 lowercase hex characters from composition",
  "expected_geometry_sha256": "64 lowercase hex characters from composition",
  "dimensions": [
    {
      "name": "Support diagonal",
      "endpoint_a": { "instance_id": "support", "vertex_index": 0 },
      "endpoint_b": { "instance_id": "support", "vertex_index": 2 }
    }
  ]
}
```

Use actual identities and existing instances; the example is illustrative.
Both hashes are mandatory. There must be 1–12 pairs. Unknown fields reject,
including cached coordinates or user-supplied measured values. Names containing
XML-forbidden characters reject with `invalid-reference-dimensions`; the operator
applies the same rule before adding a pair. Coordinates are
always resolved afresh from the exact composed layout. The request body is
limited to 3100000 bytes; the existing layout/source/geometry bounds also apply.

The result is `moonmold.reference-dimension-drawing.v1` with:

- Existing drawing identity, bounds, view mappings, source provenance and losses
- `dimensions`: named, numbered pairs with exact placed endpoint coordinates,
  local/combined indices, source-byte digests, import selection, transforms,
  signed `delta_b_minus_a_mm` and `distance_mm`
- `dimension_set_sha256`: canonical companion identity; changing a name or pair
  order changes this digest without changing source or geometry
- `exports.svg`: self-contained SVG with the report embedded as XML metadata
- `exports.dimensions`: normalized reopenable companion JSON

The report format returned by the CLI omits `exports`; it equals the SVG's
metadata. Reopen the companion, not the report. The API does not accept computed
meshes, paths, URLs, scripts or fabrication targets. No semantic operation,
execution receipt, named client acceptance or server persistence is created.

## Reading the sheet and its limits

D1A/D1B, D2A/D2B and subsequent markers identify selected endpoints in each view.
The ledger shows each full name, endpoint IDs and local indices, true Euclidean
3D distance, signed world XYZ B-minus-A deltas, and coordinates in millimetres.
Zero length, repeated STL coordinates and cross-instance pairs are supported.
A vertical 12 mm pair has a zero-length line in top projection but still reads
12 mm in the ledger. Marker and line overlap is possible; these are not hidden
line removal or drafting-standard dimensions. Overall world-axis bound labels
retain their existing meaning.

All retained vertices remain selectable, including unreferenced OBJ vertices.
Local indices describe the current imported/part-selected vertex order. Source
precision and IEEE double precision apply. Labels use nine significant digits;
exact numeric values and full provenance remain in metadata and the report.
The sheet uses an auto-fitted scale, not a print-scale template. It is a
reference observation, not minimum separation, clearance, collision detection,
design tolerances, verified accuracy, engineering or manufacturing suitability.
The backend is deterministic reference projection with no Blender execution;
`physical_authority` remains false. Keep editable source and its loss report.

## Verification

```sh
node --test adapter/reference-dimensions.test.mjs adapter/reference-drawing.test.mjs adapter/reference-measurement.test.mjs
node --test adapter/reference-*.test.mjs
```

Tests cover literal geometry, mixed units/transforms, selected and binary source
provenance, zero projection versus 3D length, deterministic reopen, stale source
and layout identities, label escaping, strict input/resource bounds, real CLI
and loopback HTTP, and executed production UI handlers with DOM/canvas doubles.
The ordinary three-view fixture's pre-feature SVG SHA-256 is also fixed in a
regression assertion. These checks do not claim visual browser QA, MoonBit/native
qualification, live Blender execution, client acceptance or physical proof.
