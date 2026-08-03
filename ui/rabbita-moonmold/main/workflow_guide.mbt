///|
fn workflow_stage(model : Model) -> Int {
  if model.last_receipt is None {
    1
  } else if model.representations.is_empty() {
    2
  } else if model.reviews.is_empty() {
    3
  } else {
    4
  }
}

///|
fn workflow_step(
  number : Int,
  label : String,
  icon_name : String,
  current : Int,
  blocked : Bool,
) -> @rabbita.Html {
  let state = if number < current {
    "complete"
  } else if number == current && blocked {
    "blocked"
  } else if number == current {
    "current"
  } else {
    "next"
  }
  let state_label = match state {
    "complete" => "Done"
    "blocked" => "Blocked"
    "current" => "Current"
    _ => "Next"
  }
  @html.div(class="workflow-step is-\{state}", [
    @html.span(
      class="workflow-glyph glyph-\{icon_name}",
      attrs=@html.Attrs::build().aria_hidden("true"),
      "",
    ),
    @html.div([@html.strong(label), @html.small(state_label)]),
  ])
}

///|
fn workflow_next_action(
  emit : @rabbita.Emit[Msg],
  model : Model,
  stage : Int,
) -> @rabbita.Html {
  if !model.error.is_empty() {
    action(
      if model.last_flow_request is Some(_) {
        "Reconcile"
      } else {
        "Retry validation"
      },
      if model.last_flow_request is Some(_) {
        emit(ReconcileRun)
      } else {
        emit(ValidateRequest)
      },
      primary=true,
      disabled=model.busy,
    )
  } else {
    match stage {
      1 =>
        action(
          "Validate request",
          emit(ValidateRequest),
          primary=true,
          disabled=model.busy,
        )
      2 =>
        action(
          "Build representation",
          emit(ExecuteRequest),
          primary=true,
          disabled=model.busy,
        )
      3 =>
        if model.reviewer.trim().is_empty() {
          @html.a(
            class="action primary",
            href="#named-review",
            attrs=@html.Attrs::build().aria_label("Add the named reviewer"),
            "Add reviewer",
          )
        } else {
          action(
            "Record review",
            emit(SubmitReview),
            primary=true,
            disabled=model.busy,
          )
        }
      _ =>
        action(
          "Start next change",
          emit(ApplyTemplate("model")),
          primary=true,
          disabled=model.busy,
        )
    }
  }
}

///|
fn workflow_next_copy(model : Model, stage : Int) -> String {
  if !model.error.is_empty() {
    "The operation stopped without widening authority. Reconcile the known attempt, or correct the request and validate again."
  } else {
    match stage {
      1 =>
        "Check the semantic request and workspace references before any model change."
      2 =>
        "Validation is durable. Build the selected digital representation next."
      3 =>
        "Inspect the derived sibling, then bind a named decision to its receipt."
      _ =>
        "The receipt and named review are durable. Begin a separately identified change when ready."
    }
  }
}

///|
fn workflow_guide(emit : @rabbita.Emit[Msg], model : Model) -> @rabbita.Html {
  let stage = workflow_stage(model)
  let blocked = !model.error.is_empty()
  @html.section(
    class=if blocked { "workflow-guide is-blocked" } else { "workflow-guide" },
    attrs=@html.Attrs::build().aria_label("MoonMold model workflow"),
    [
      @html.div(class="workflow-heading", [
        @html.div([
          @html.small(class="eyebrow", "YOUR OUTCOME"),
          @html.h2("Create one reviewable digital model"),
          @html.p(workflow_next_copy(model, stage)),
        ]),
        @html.div(class="workflow-action", [
          @html.small(
            if blocked {
              "SAFE RECOVERY"
            } else {
              "NEXT SAFE ACTION"
            },
          ),
          workflow_next_action(emit, model, stage),
        ]),
      ]),
      @html.div(class="workflow-rail", [
        workflow_step(1, "Define", "brief", stage, blocked),
        workflow_step(2, "Build", "build", stage, blocked),
        workflow_step(3, "Review", "review", stage, blocked),
        workflow_step(4, "Accepted", "check", stage, blocked),
      ]),
      @html.div(
        class=if blocked {
          "workflow-result is-denied"
        } else {
          "workflow-result"
        },
        attrs=@html.Attrs::build().role("status").aria_live("polite"),
        [
          @html.strong(
            if blocked {
              "Stopped safely"
            } else {
              "Current result"
            },
          ),
          @html.span(if blocked { model.error } else { model.notice }),
          @html.small(
            "Digital artifact only · no fabrication or physical authority",
          ),
        ],
      ),
    ],
  )
}
