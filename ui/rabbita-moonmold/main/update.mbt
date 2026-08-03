///|
fn request_from_json(model : Model, request : Json) -> Result[Model, String] {
  match request {
    {
      "request_id": String(request_id),
      "idempotency_key": String(idempotency_key),
      "project_id": String(project_id),
      "model_id": String(model_id),
      "expected_parent_digest": String(expected_parent_digest),
      "intent": String(intent),
      "reference_artifacts": Array(reference_values),
      "constraints": Array(constraint_values),
      "backend_preference": String(backend_preference),
      "operation": { "method": String(method_name), "params": params, .. },
      ..
    } => {
      let references = reference_values.filter_map(value => {
        match value {
          String(text) => Some(text)
          _ => None
        }
      })
      let constraints = constraint_values.filter_map(value => {
        match value {
          String(text) => Some(text)
          _ => None
        }
      })
      Ok({
        ..model,
        request_id,
        idempotency_key,
        project_id,
        model_id,
        expected_parent_digest,
        intent,
        references: references.join("\n"),
        constraints: constraints.join("\n"),
        backend_preference,
        method_name,
        params_json: params.stringify(indent=2),
      })
    }
    _ => Err("Loaded request does not match the MoonMold operator contract.")
  }
}

///|
fn receipt_after_digest(receipt : Json?) -> String? {
  match receipt {
    Some({ "after_digest": String(value), .. }) => Some(value)
    _ => None
  }
}

///|
fn flow_attempt_id(flow : Json?) -> String? {
  match flow {
    Some({ "attempt_id": String(value), .. }) => Some(value)
    _ => None
  }
}

///|
fn template(model : Model, name : String) -> Model {
  match name {
    "model" =>
      {
        ..model,
        method_name: "scene.create-model",
        params_json: (
          $|{
          $|  "name": "\{model.model_id}",
          $|  "units": "mm",
          $|  "coordinateFrame": "z-up-right-handed"
          $|}
        ),
      }
    "box" =>
      {
        ..model,
        method_name: "scene.create-box",
        params_json: (
          #|{
          #|  "objectId": "primary-mass",
          #|  "widthMm": 1200,
          #|  "depthMm": 800,
          #|  "heightMm": 600
          #|}
        ),
      }
    representation =>
      {
        ..model,
        method_name: "representation.export",
        params_json: (
          $|{
          $|  "representation": "\{representation}",
          $|  "outputPath": ".moonsuite/products/moonmold/projects/\{model.project_id}/\{model.model_id}/representations/\{representation}.json"
          $|}
        ),
      }
  }
}

///|
fn update(
  emit : @rabbita.Emit[Msg],
  msg : Msg,
  model : Model,
) -> (@rabbita.Cmd, Model) {
  match msg {
    StatusLoaded(Ok(status)) =>
      (
        recovery_request(emit),
        {
          ..model,
          status: Some(status),
          notice: "Adapter qualification loaded; recovering durable state…",
          error: "",
        },
      )
    StatusLoaded(Err(error)) => (@rabbita.none, { ..model, error, busy: false })
    RecoveryLoaded(Ok(payload)) =>
      if payload.physical_authority {
        (
          @rabbita.none,
          {
            ..model,
            busy: false,
            error: "Recovery projection exceeded MoonMold’s digital-only authority.",
          },
        )
      } else {
        match payload.run {
          None =>
            (
              @rabbita.none,
              {
                ..model,
                revision: payload.next_revision,
                request_id: payload.next_request_id,
                idempotency_key: payload.next_idempotency_key,
                busy: false,
                notice: "No terminal MoonMold attempt is available to recover.",
                error: "",
              },
            )
          Some(run) =>
            match request_from_json(model, run.request) {
              Err(error) => (@rabbita.none, { ..model, busy: false, error })
              Ok(loaded) =>
                (
                  @rabbita.none,
                  {
                    ..loaded,
                    revision: payload.next_revision,
                    request_id: payload.next_request_id,
                    idempotency_key: payload.next_idempotency_key,
                    expected_parent_digest: receipt_after_digest(run.receipt).unwrap_or(
                      loaded.expected_parent_digest,
                    ),
                    last_flow_request: Some(run.flow_request),
                    last_spatial_request: Some(run.request),
                    last_receipt: run.receipt,
                    representations: run.representations,
                    reviews: run.reviews,
                    busy: false,
                    notice: "Recovered the latest exact durable receipt and named reviews.",
                    error: "",
                  },
                )
            }
        }
      }
    RecoveryLoaded(Err(error)) =>
      (
        @rabbita.none,
        {
          ..model,
          busy: false,
          error: "Durable recovery failed closed: " + error,
        },
      )
    SetRequestId(value) => (@rabbita.none, { ..model, request_id: value })
    SetIdempotencyKey(value) =>
      (@rabbita.none, { ..model, idempotency_key: value })
    SetProjectId(value) => (@rabbita.none, { ..model, project_id: value })
    SetModelId(value) => (@rabbita.none, { ..model, model_id: value })
    SetExpectedParent(value) =>
      (@rabbita.none, { ..model, expected_parent_digest: value })
    SetIntent(value) => (@rabbita.none, { ..model, intent: value })
    SetReferences(value) => (@rabbita.none, { ..model, references: value })
    SetConstraints(value) => (@rabbita.none, { ..model, constraints: value })
    SetBackend(value) => (@rabbita.none, { ..model, backend_preference: value })
    SetMethod(value) => (@rabbita.none, { ..model, method_name: value })
    SetParams(value) => (@rabbita.none, { ..model, params_json: value })
    SetLoadRef(value) => (@rabbita.none, { ..model, load_ref: value })
    SetReviewer(value) => (@rabbita.none, { ..model, reviewer: value })
    SetDecision(value) => (@rabbita.none, { ..model, decision: value })
    SetReviewNotes(value) => (@rabbita.none, { ..model, review_notes: value })
    ApplyTemplate(name) =>
      (@rabbita.none, { ..template(model, name), error: "" })
    SaveRequest =>
      match spatial_request(model) {
        Err(error) => (@rabbita.none, { ..model, error, })
        Ok(request) =>
          (
            save_request(emit, request),
            {
              ..model,
              busy: true,
              notice: "Saving governed request…",
              error: "",
            },
          )
      }
    RequestSaved(Ok(payload)) =>
      (
        @rabbita.none,
        {
          ..model,
          busy: false,
          load_ref: payload.reference,
          notice: "Saved " + payload.reference,
          error: "",
        },
      )
    RequestSaved(Err(error)) => (@rabbita.none, { ..model, busy: false, error })
    LoadRequest =>
      (
        load_request(emit, model.load_ref),
        {
          ..model,
          busy: true,
          notice: "Loading governed request…",
          error: "",
        },
      )
    RequestLoaded(Ok(payload)) =>
      match request_from_json(model, payload.request) {
        Ok(loaded) =>
          (
            @rabbita.none,
            {
              ..loaded,
              busy: false,
              load_ref: payload.reference,
              notice: "Loaded " + payload.reference,
              error: "",
            },
          )
        Err(error) => (@rabbita.none, { ..model, busy: false, error })
      }
    RequestLoaded(Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error })
    ValidateRequest =>
      match spatial_request(model) {
        Err(error) => (@rabbita.none, { ..model, error, })
        Ok(request) =>
          (
            run_request(emit, "validate", request),
            {
              ..model,
              busy: true,
              notice: "Validating through MoonMold’s exact pack adapter…",
              error: "",
            },
          )
      }
    ExecuteRequest =>
      match spatial_request(model) {
        Err(error) => (@rabbita.none, { ..model, error, })
        Ok(request) =>
          (
            run_request(emit, "execute", request),
            {
              ..model,
              busy: true,
              notice: "Executing through the durable MoonBit adapter…",
              error: "",
            },
          )
      }
    RunCompleted(Ok(payload)) => {
      let (revision, request_id, idempotency_key) = next_identity(model)
      (
        @rabbita.none,
        {
          ..model,
          revision,
          request_id,
          idempotency_key,
          expected_parent_digest: receipt_after_digest(payload.receipt).unwrap_or(
            model.expected_parent_digest,
          ),
          last_flow_request: Some(payload.flow_request),
          last_spatial_request: Some(payload.request),
          last_receipt: payload.receipt,
          representations: payload.representations,
          reviews: payload.reviews,
          busy: false,
          notice: "Terminal receipt is durable. Named review remains separate.",
          error: "",
        },
      )
    }
    RunCompleted(Err(error)) => (@rabbita.none, { ..model, busy: false, error })
    ReconcileRun =>
      match (model.last_flow_request, model.last_spatial_request) {
        (Some(flow), Some(request)) =>
          (
            reconcile_request(emit, flow, request),
            {
              ..model,
              busy: true,
              notice: "Reconciling durable evidence…",
              error: "",
            },
          )
        _ =>
          (
            @rabbita.none,
            {
              ..model,
              error: "A prior flow request is required for reconciliation.",
            },
          )
      }
    Reconciled(Ok(payload)) =>
      (
        @rabbita.none,
        {
          ..model,
          last_flow_request: Some(payload.flow_request),
          last_spatial_request: Some(payload.request),
          last_receipt: payload.receipt,
          representations: payload.representations,
          reviews: payload.reviews,
          busy: false,
          notice: "Reconciliation completed without replaying a new attempt.",
          error: "",
        },
      )
    Reconciled(Err(error)) => (@rabbita.none, { ..model, busy: false, error })
    SubmitReview =>
      match flow_attempt_id(model.last_flow_request) {
        Some(attempt_id) =>
          (
            submit_review(
              emit,
              attempt_id,
              model.reviewer,
              model.decision,
              model.review_notes,
            ),
            {
              ..model,
              busy: true,
              notice: "Recording named review…",
              error: "",
            },
          )
        None =>
          (
            @rabbita.none,
            { ..model, error: "Execute or validate before recording review." },
          )
      }
    ReviewSubmitted(Ok(payload)) =>
      (
        @rabbita.none,
        {
          ..model,
          reviews: [..model.reviews, payload.review],
          busy: false,
          notice: "Named review recorded at " + payload.reference,
          error: "",
        },
      )
    ReviewSubmitted(Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error })
  }
}
