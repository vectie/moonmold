# Structured digital brief

The Digital delivery panel now exposes the existing
`moonmold.digital-brief.v1` contract as labeled fields. No new contract,
geometry operation, backend or authority is introduced.

## First delivery

1. Set the operation editor's Project and Model. Choose **Use current
   project/model** to copy those identities into the brief without resetting
   its dimensions, intent or criteria
2. Enter the stable commitment reference, positive revision, intended use,
   primary-object width/depth/height, scene units, optional constraints and
   review criteria. Constraints and criteria use one entry per line; do not
   leave empty lines inside an entry list
3. Dimensions always use positive whole millimetres, maximum 2147483647.
   A cylinder's width and depth are its nominal diameter, and height is its
   nominal height. These are independent of its faceted mesh bounds
4. Scene units are mm, cm or m. Selecting cm or m does not reinterpret entered
   dimensions or change the operation editor. Explicitly select matching units
   in **Create model**. The renderer converts OBJ coordinates later
5. The supported offer remains editable source + presentation, the frame is
   z-up-right-handed, and physical authority is false. These fixed contract
   fields are displayed, not silently broadened. There is no title field in
   this schema. Constraints and criteria remain human review items
6. **Freeze brief**, then choose, validate and execute model operations,
   presentation export and package build through the existing workflow

## Revisions and recovery

**Start next revision from draft** copies all current brief values and
increments the revision. Edit the changed dimensions or criteria, then freeze
before executing changed operations. It does not freeze, model, export or
review anything automatically. Existing frozen brief bytes, package files and
named reviews are not rewritten. A frozen revision conflict requires a new
revision; prior approval never transfers to a changed package.

After recovery, **Load selected package brief** fetches the exact `brief.json`
through the existing host-verified package-file route. This explicitly replaces
the brief draft only. It does not switch the frozen binding or inherit package
approval. The response must match the selected package digest and the current
project/model. Changed selections, newer draft generations and failed or late
responses preserve the current draft. Start the next revision after loading.

Brief edits remain separate from operation edits: loading or completing an
operation cannot clear pending brief changes or make old package approval
current. Old downloads and review history remain available and are labeled
historical when a draft has changed.

## Draft and advanced JSON behavior

Incomplete input stays visible. Invalid typed fields block freeze and next
revision; the advanced JSON panel clearly shows the last complete values.
Correct the field or explicitly replace the draft by editing advanced JSON.
During a pending freeze/load, brief inputs and repeat actions are disabled.

Structured hydration requires an exact semantic round-trip. Extra keys,
unsupported units/frames, larger numbers, multiline list entries and malformed
JSON remain in advanced JSON without silently dropping, trimming, coercing or
reordering values. Advanced text stays exact until an explicit edit/identity
copy/revision action reformats it. Preserving unsupported data is not host
acceptance: the existing strict brief validator still decides whether it can
be frozen.

Unsaved brief fields live only in this page. Saving an operation does not save
the brief draft. A page reload recovers durable operations/package bindings;
load the retained package brief explicitly to revise its content. Recovering an
unpackaged frozen brief remains outside this small editor change.

## Evidence limits

Whitebox/SSR tests cover the form, JSON transitions, invalid inputs, race/error
handling and retained history. Three generated form fixtures pass through the
actual native adapter without a network listener: freeze, validate/execute,
build, named fixture review, revision, download and recovery in mm/cm/m.
The retained package brief and recovery responses are then supplied back to
the compiled MoonBit UI loader/revision tests.

This is synthetic deterministic-mock evidence, not live browser interaction,
Blender output, real client acceptance, engineering certification or physical
authority. The existing primitive editor and renderer remain unchanged.
