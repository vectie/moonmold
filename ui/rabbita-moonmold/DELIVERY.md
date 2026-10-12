# Digital model delivery

This UI preserves the existing governed semantic-operation and named-review
workflow. Digital delivery is an explicit additional workflow:

1. Set Project and Model, then choose **Use current project/model**. Edit the
   structured brief fields: commitment reference, revision, intended use,
   dimensions in mm, scene units, constraints and review criteria. Dimensions
   describe `primary-mass`: box width/depth/height or cylinder nominal
   diameter/diameter/height. Freeze before Create model and Add box/cylinder.
   For revisions, use **Start next revision from draft**, edit, and freeze
   before changed operations. Advanced JSON remains available losslessly.
2. Choose, validate, and execute model operations explicitly. The frozen brief
   reference is included in future `reference_artifacts` without removing the
   operator's other references.
3. Choose Presentation, validate, and explicitly execute the export. Only an
   actual successful presentation-export execution bound to the frozen brief
   supplies the package build target. Validation cannot create that target.
4. Build the delivery package. Download individual files or the portable JSON
   bundle, which contains file texts and is not a ZIP archive. Inspect editable
   source, presentation OBJ, SVG preview, validation, loss/change reports, and
   the exact frozen brief and manifest digest.
5. Enter a reviewer, decision, and notes. Use **Review this exact package** to
   bind the decision to its package ID, manifest digest, and original operation
   receipt. **Record named review** retains the original receipt-only behavior.

Every package is labeled deterministic mock reference / fixture evidence only.
It is not Blender evidence, fabrication authority, or human approval. The
host enforces bounded supported geometry and reports unsupported operations.

Draft changes and errors retain the selected package and its download links.
Changed drafts, different attempts/briefs, and host-reported stale packages
show a historical label. A historical package's review cannot approve a new
draft. Re-freezing a brief requires a new bound presentation export before
building another package.

Recovery accepts older responses without a delivery field and empty responses
with null optional fields. A recovered delivery restores its exact frozen
brief reference/digest; its brief bytes remain available in `brief.json`, while
the editable brief remains a separate draft. **Load selected package brief**
explicitly replaces that draft with host-verified package brief content, ready
for a next revision. Pending brief edits survive operation loads/completions;
stale, failed and interrupted brief responses preserve them. Unsaved brief
fields remain page-local and are not included in Save request.

See `../../docs/BRIEF_CONTROLS.md` for supported values and recovery limits.

## Focused validation

The package is JS-only. Run `moon check --target all`,
`moon test --target js --strip -j1`, `moon fmt`, and `moon info` using the
configured MoonBit toolchain. Delivery regressions live in
`main/delivery_wbtest.mbt`, `main/brief_wbtest.mbt` and
`main/brief_host_wbtest.mbt` and include model/update/SSR coverage. The optional
host-bridge test requires actual native response bytes in
`MOONMOLD_BRIEF_HOST_FIXTURE`; without them it explicitly reports not run.
