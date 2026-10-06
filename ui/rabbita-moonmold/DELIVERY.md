# Digital model delivery

This UI preserves the existing governed semantic-operation and named-review
workflow. Digital delivery is an explicit additional workflow:

1. Set Project and Model. Prepare and inspect the digital brief JSON. Its
   dimensions describe the single `primary-mass` box. Freeze the brief before
   Create model and Add box. For revisions, freeze a revised brief before the
   changed box operation.
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
the editable brief textarea remains a separate draft.

## Focused validation

The package is JS-only. Run `moon check --target all`,
`moon test --target js --strip -j1`, `moon fmt`, and `moon info` using the
configured MoonBit toolchain. Delivery regressions live in
`main/delivery_wbtest.mbt` and include model/update/SSR coverage.
