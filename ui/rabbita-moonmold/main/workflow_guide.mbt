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
          if model.method_name == "representation.export" {
            "Validate representation"
          } else {
            "Validate request"
          },
          emit(ValidateRequest),
          primary=true,
          disabled=model.busy,
        )
      2 => {
        let title = workflow_build_action(model)
        if title == "Choose representation" {
          @html.a(
            class="action primary",
            href="#representation-templates",
            title,
          )
        } else {
          action(
            title,
            if title == "Execute request" || title == "Build representation" {
              emit(ExecuteRequest)
            } else if title == "Reconcile representation" {
              emit(ReconcileRun)
            } else {
              emit(ValidateRequest)
            },
            primary=true,
            disabled=model.busy,
          )
        }
      }
      3 =>
        if workflow_review_decision(model) is ("request-changes" | "reject") {
          @html.a(
            class="action primary",
            href="#spatial-request",
            "Revise request",
          )
        } else if workflow_review_decision(model) == "unverified" {
          action(
            "Reconcile reviews",
            emit(ReconcileRun),
            primary=true,
            disabled=model.busy,
          )
        } else if model.reviewer.trim().is_empty() {
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
        if model.draft_changed {
          "This draft has changed. Validate it before the next operation. Retained receipts and reviews describe the previous result."
        } else if model.last_receipt
          is Some({ "outcome": String("rejected"), .. }) {
          "The operation was rejected. Inspect the receipt findings, correct the request, and validate again."
        } else {
          "Check the semantic request and workspace references before any model change."
        }
      2 =>
        match workflow_build_action(model) {
          "Execute request" =>
            "Validation is durable. Execute the selected semantic request next."
          "Build representation" =>
            "Export validation is durable. Build the selected digital representation next."
          "Choose representation" =>
            "The semantic operation is durable. Choose an editable or derived sibling, then validate its export request."
          "Reconcile representation" =>
            "The export receipt is available, but its current representation is missing or has different lineage. Reconcile the exact attempt before continuing."
          _ =>
            "Validate the selected request before executing it. Choosing a representation only prepares the export parameters."
        }
      3 =>
        match workflow_review_decision(model) {
          "request-changes" =>
            "Changes requested. Read the named review notes, revise the request, and validate a separately identified change."
          "reject" =>
            "Rejected by the named reviewer. Read the review notes and revise the request before seeking a new decision."
          "unverified" =>
            "The available reviews do not establish a current decision. Inspect the review ledger and reconcile the exact receipt."
          _ =>
            "Inspect the derived sibling, then bind a named decision to its receipt."
        }
      _ =>
        "The latest receipt-bound named review approves this digital result. Begin a separately identified change when ready."
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
        workflow_step(
          3,
          match
            (if model.draft_changed {
              ""
            } else {
              workflow_review_decision(model)
            }) {
            "request-changes" => "Changes requested"
            "reject" => "Rejected"
            _ => "Review"
          },
          "review",
          stage,
          blocked,
        ),
        workflow_step(
          4,
          if stage == 4 {
            "Accepted"
          } else {
            "Acceptance"
          },
          "check",
          stage,
          blocked,
        ),
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
            } else if model.draft_changed {
              "Previous result"
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
