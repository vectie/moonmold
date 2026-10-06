///|
using @html {
  article,
  button,
  code,
  details,
  div,
  h1,
  h2,
  h3,
  header,
  input,
  label,
  main_,
  p,
  pre,
  section,
  small,
  span,
  summary,
  textarea,
}

///|
fn field(
  title : String,
  value : String,
  on_input : @rabbita.Emit[String],
) -> @rabbita.Html {
  label(class="field", [span(title), input(input_type=Text, value~, on_input~)])
}

///|
fn area(
  title : String,
  value : String,
  on_input : @rabbita.Emit[String],
  rows? : Int = 4,
) -> @rabbita.Html {
  label(class="field", [span(title), textarea(value~, on_input~, rows~, "")])
}

///|
fn action(
  title : String,
  command : @rabbita.Cmd,
  primary? : Bool = false,
  disabled? : Bool = false,
) -> @rabbita.Html {
  button(
    class=if primary { "action primary" } else { "action" },
    on_click=command,
    disabled~,
    title~,
    attrs=@html.Attrs::build().aria_label(title),
    title,
  )
}

///|
fn json_panel(title : String, value : Json?) -> @rabbita.Html {
  details(class="card json-card", [
    summary([h3(title), span("Inspect evidence")]),
    pre(value.map(item => item.stringify(indent=2)).unwrap_or("Not available")),
  ])
}

///|
fn representation_cards(values : Array[Json]) -> @rabbita.Html {
  let cards : Array[@rabbita.Html] = []
  for value in values {
    let title = match value {
      { "representation": String(name), .. } => name
      _ => "unknown representation"
    }
    cards.push(
      article(class="card representation", [
        small("DERIVED SIBLING"),
        h3(title),
        details([summary("Inspect lineage"), pre(value.stringify(indent=2))]),
      ]),
    )
  }
  if cards.is_empty() {
    cards.push(
      article(class="card empty", [
        h3("No representation artifacts yet"),
        p(
          "Export editable, engineering, presentation, simulation, or manufacturing-candidate siblings.",
        ),
      ]),
    )
  }
  div(class="representation-grid", cards)
}

///|
fn view(emit : @rabbita.Emit[Msg], model : Model) -> @rabbita.Html {
  main_(class="shell", [
    header(class="hero", [
      div([
        small(class="eyebrow", "MOONMOLD · FIRST-CLASS DOMAIN PACK"),
        h1("Governed spatial operator"),
        p(
          "Create or load exact semantic requests, inspect authority and provider qualification, execute through the durable MoonBit adapter, and review every derived sibling without granting physical authority.",
        ),
      ]),
      div(class="truth", [
        span("moonflow.adapter.v2"),
        code("moonmold/spatial.operation.execute@0.2.0"),
        strong_truth(),
      ]),
    ]),
    workflow_guide(emit, model),
    div(class="workspace", [
      section(id="spatial-request", class="panel request-panel", [
        delivery_brief_panel(emit, model),
        div(class="panel-title", [
          div([
            small(class="eyebrow", "REQUEST"),
            h2("Intent and semantic operation"),
          ]),
          span(class="badge", if model.busy { "WORKING" } else { "READY" }),
        ]),
        div(class="load-row", [
          field(
            "Workspace-relative request",
            model.load_ref,
            emit.map(value => SetLoadRef(value)),
          ),
          action("Load", emit(LoadRequest), disabled=model.busy),
          action("Save", emit(SaveRequest), disabled=model.busy),
        ]),
        div(class="two", [
          field(
            "Request ID",
            model.request_id,
            emit.map(value => SetRequestId(value)),
          ),
          field(
            "Idempotency key",
            model.idempotency_key,
            emit.map(value => SetIdempotencyKey(value)),
          ),
          field(
            "Project",
            model.project_id,
            emit.map(value => SetProjectId(value)),
          ),
          field("Model", model.model_id, emit.map(value => SetModelId(value))),
        ]),
        field(
          "Expected parent digest",
          model.expected_parent_digest,
          emit.map(value => SetExpectedParent(value)),
        ),
        area(
          "Spatial intent",
          model.intent,
          emit.map(value => SetIntent(value)),
          rows=3,
        ),
        div(class="two", [
          area(
            "Reference artifacts · one workspace-relative path per line",
            model.references,
            emit.map(value => SetReferences(value)),
            rows=4,
          ),
          area(
            "Constraints · one per line",
            model.constraints,
            emit.map(value => SetConstraints(value)),
            rows=4,
          ),
        ]),
        field(
          "Backend preference",
          model.backend_preference,
          emit.map(value => SetBackend(value)),
        ),
        div(id="representation-templates", class="templates", [
          action("Create model", emit(ApplyTemplate("model"))),
          action("Add box", emit(ApplyTemplate("box"))),
          action("Editable", emit(ApplyTemplate("editable-source"))),
          action("Engineering", emit(ApplyTemplate("engineering"))),
          action("Presentation", emit(ApplyTemplate("presentation"))),
          action("Simulation", emit(ApplyTemplate("simulation"))),
          action(
            "Manufacturing candidate",
            emit(ApplyTemplate("manufacturing-candidate")),
          ),
        ]),
        field(
          "Semantic method",
          model.method_name,
          emit.map(value => SetMethod(value)),
        ),
        area(
          "Exact parameter object",
          model.params_json,
          emit.map(value => SetParams(value)),
          rows=8,
        ),
        div(class="actions", [
          action("Validate", emit(ValidateRequest), disabled=model.busy),
          action(
            "Execute reference path",
            emit(ExecuteRequest),
            primary=true,
            disabled=model.busy,
          ),
          action(
            "Reconcile same attempt",
            emit(ReconcileRun),
            disabled=model.busy,
          ),
        ]),
      ]),
      section(class="right-column", [
        delivery_panel(emit, model),
        json_panel("Backend qualification", model.status),
        json_panel("Latest operation receipt", model.last_receipt),
        section(class="panel", [
          small(class="eyebrow", "REPRESENTATION LINEAGE"),
          h2("Editable and derived siblings"),
          representation_cards(model.representations),
        ]),
        section(id="named-review", class="panel review", [
          small(class="eyebrow", "NAMED HUMAN REVIEW"),
          h2("Accept, reject, or request changes"),
          p(
            "Technical validation never self-approves a model. Review binds a named person to the exact durable receipt digest.",
          ),
          div(class="two", [
            field(
              "Reviewer name",
              model.reviewer,
              emit.map(value => SetReviewer(value)),
            ),
            field(
              "Decision · approve / request-changes / reject",
              model.decision,
              emit.map(value => SetDecision(value)),
            ),
          ]),
          area(
            "Review notes",
            model.review_notes,
            emit.map(value => SetReviewNotes(value)),
            rows=4,
          ),
          action(
            "Record named review",
            emit(SubmitReview),
            primary=true,
            disabled=model.busy || model.reviewer.trim().is_empty(),
          ),
          details(class="review-ledger", [
            summary("\{model.reviews.length()} durable review receipt(s)"),
            pre(
              model.reviews.map(item => item.stringify(indent=2)).join("\n\n"),
            ),
          ]),
        ]),
      ]),
    ]),
  ])
}

///|
fn strong_truth() -> @rabbita.Html {
  span(class="no-physical", "NO FABRICATION · NO PHYSICAL AUTHORITY")
}
