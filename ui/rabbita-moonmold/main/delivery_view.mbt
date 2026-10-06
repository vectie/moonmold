///|
fn delivery_brief_panel(
  emit : @rabbita.Emit[Msg],
  model : Model,
) -> @rabbita.Html {
  let frozen = match model.frozen_brief {
    None => @html.p("No frozen delivery brief yet.")
    Some(brief) =>
      @html.div(class="delivery-binding", [
        @html.strong("Frozen brief reference"),
        @html.code(brief.reference),
        @html.small("Exact brief digest"),
        @html.code(brief.digest),
        @html.p(
          "This frozen reference stays bound to future requests. Editing the brief draft does not replace the frozen version until you freeze again.",
        ),
        if brief.brief is Null {
          @html.p(
            "Recovered binding only. Download brief.json from the package to inspect the frozen content; the text below is a separate draft.",
          )
        } else {
          @html.details([
            @html.summary("Inspect frozen brief"),
            @html.pre(brief.brief.stringify(indent=2)),
          ])
        },
      ])
  }
  @html.section(id="delivery-brief", class="delivery-brief", [
    @html.small(class="eyebrow", "1 · FREEZE THE DIGITAL BRIEF"),
    @html.h2("A usable digital model delivery"),
    @html.p(
      "Freeze before Create model and Add box for your first delivery. For a revision, freeze a revised brief before the changed box operation. Dimensions describe the single primary-mass box; inspect constraints, units, losses, and review criteria.",
    ),
    @html.p(
      "Then explicitly execute the model operations, choose Presentation, validate and execute its export, and build the package. No step silently runs the next one.",
    ),
    @html.details([
      @html.summary("Edit the brief draft · JSON"),
      area(
        "Digital brief draft",
        model.brief_json,
        emit.map(value => SetBrief(value)),
        rows=15,
      ),
      action(
        "Prepare brief for current model",
        emit(PrepareBrief),
        disabled=model.busy,
      ),
      @html.small(
        "Uses the current Project and Model fields below. Review the default dimensions and increment revision for a new commitment.",
      ),
    ]),
    action("Freeze brief", emit(FreezeBrief), primary=true, disabled=model.busy),
    frozen,
  ])
}

///|
fn delivery_file_digest(delivery : DeliveryPayload, name : String) -> String {
  match delivery.manifest {
    { "files": Array(files), .. } => {
      for file in files {
        match file {
          { "name": String(file_name), "sha256": String(digest), .. } if file_name ==
            name => return digest
          _ => ()
        }
      }
      "Digest unavailable"
    }
    _ => "Digest unavailable"
  }
}

///|
fn delivery_downloads(delivery : DeliveryPayload) -> @rabbita.Html {
  @html.div(class="delivery-downloads", [
    @html.a(
      class="action primary",
      href=delivery.download_url,
      download=delivery_id(delivery) + ".json",
      escape=true,
      "Download portable JSON bundle",
    ),
    @html.p(
      "The portable bundle contains all file texts. It is JSON, not a ZIP archive.",
    ),
    @html.div(
      class="delivery-files",
      delivery.files.map(file => {
        @html.div(class="delivery-file", [
          @html.a(href=file.url, download=file.name, escape=true, file.name),
          @html.small("SHA-256"),
          @html.code(delivery_file_digest(delivery, file.name)),
        ])
      }),
    ),
  ])
}

///|
fn delivery_panel(emit : @rabbita.Emit[Msg], model : Model) -> @rabbita.Html {
  let selected = match model.delivery {
    None =>
      @html.p(
        "No delivery package selected. Freeze the brief before modeling, then explicitly execute a presentation export.",
      )
    Some(delivery) =>
      @html.div([
        @html.div(class="delivery-binding", [
          @html.strong(
            if delivery_is_historical(model, delivery) {
              "Historical package · original revision only"
            } else {
              "Selected export package"
            },
          ),
          @html.code(delivery_id(delivery)),
          @html.small("Exact manifest digest"),
          @html.code(delivery.manifest_digest),
          @html.p(
            if delivery_is_historical(model, delivery) {
              "Downloads and reviews describe this original package. The current draft has no inherited package approval. Build a new export for a changed model."
            } else {
              "Inspect the editable source, OBJ, preview, validation, loss report, and change report before the named review."
            },
          ),
        ]),
        @html.p(
          "Package review: " +
          delivery.review_status +
          ". Building or downloading a package is not human approval.",
        ),
        delivery_downloads(delivery),
        @html.div(class="actions", [
          action(
            "Refresh selected package",
            emit(RefreshDelivery),
            disabled=model.busy,
          ),
          @html.a(
            class="action",
            href="#named-review",
            "Enter reviewer and decision",
          ),
          action(
            "Review this exact package",
            emit(SubmitDeliveryReview),
            primary=true,
            disabled=model.busy || model.reviewer.trim().is_empty(),
          ),
        ]),
        @html.p(
          "Package review uses the named reviewer, decision, and notes below and binds both this package ID and exact manifest digest, alongside its original operation receipt.",
        ),
        @html.details(class="review-ledger", [
          @html.summary("Package manifest and exact review history"),
          @html.pre(delivery.manifest.stringify(indent=2)),
          @html.pre(
            delivery.reviews.map(item => item.stringify(indent=2)).join("\n\n"),
          ),
        ]),
      ])
  }
  @html.section(id="digital-delivery", class="panel delivery-panel", [
    @html.small(class="eyebrow", "2 · BUILD AND DOWNLOAD"),
    @html.h2("Digital delivery package"),
    @html.strong(
      class="no-physical",
      "DETERMINISTIC MOCK REFERENCE · FIXTURE EVIDENCE ONLY · NOT BLENDER EVIDENCE",
    ),
    @html.p(
      "Digital box visualization only. No fabrication or physical authority. OBJ is a presentation sibling; editable-source.json remains the editable source.",
    ),
    match model.delivery_export {
      Some(target) =>
        @html.div(class="delivery-binding", [
          @html.small("Last actual presentation-export attempt"),
          @html.code(target.attempt_id),
          @html.small("Bound brief"),
          @html.code(target.brief_ref),
        ])
      None =>
        @html.p(
          "No successful brief-bound presentation export is available yet.",
        )
    },
    action(
      "Build delivery from export",
      emit(BuildDelivery),
      primary=true,
      disabled=model.busy || delivery_build_body(model) is Err(_),
    ),
    selected,
  ])
}
