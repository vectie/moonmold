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
      Ok(
        sync_primitive_editor({
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
          retained_scene: None,
          selected_object: "",
          scene_generation: model.scene_generation + 1,
          scene_loading: false,
          scene_error: "",
        }),
      )
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
// Validation receipts describe request bytes, not the scene's new parent.
// Idempotent receipts retain an old applied digest; replay never advances (or
// rewinds) the current workspace parent. Refresh retained objects for its head.
fn next_scene_parent(payload : RunPayload, previous : String) -> String {
  match (payload.receipt, payload.result) {
    (
      Some(
        {
          "contract_id": String("moonmold.spatial-operation-receipt.v1"),
          "operation_ref": String("moonmold/spatial.operation.execute@0.2.0"),
          "outcome": String("applied"),
          "physical_authority": False,
          ..
        }
      ),
      { "status": String("succeeded"), .. },
    ) =>
      match receipt_after_digest(payload.receipt) {
        Some(after) if !after.is_empty() => after
        _ => previous
      }
    _ => previous
  }
}

///|
// Keep a late result as evidence without changing another draft's scene base.
fn next_draft_scene_parent(payload : RunPayload, model : Model) -> String {
  match payload.request {
    {
      "project_id": String(project_id),
      "model_id": String(model_id),
      "expected_parent_digest": String(parent),
      ..
    } if project_id == model.project_id &&
      model_id == model.model_id &&
      parent == model.expected_parent_digest =>
      next_scene_parent(payload, model.expected_parent_digest)
    _ => model.expected_parent_digest
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
  sync_primitive_editor(
    match name {
      "model" =>
        {
          ..model,
          method_name: "scene.create-model",
          params_json: Json::object({
            "name": Json::string(model.model_id),
            "units": "mm",
            "coordinateFrame": "z-up-right-handed",
          }).stringify(indent=2),
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
      "cylinder" =>
        {
          ..model,
          method_name: "scene.create-cylinder",
          params_json: (
            #|{
            #|  "objectId": "support-cylinder",
            #|  "radiusMm": 200,
            #|  "heightMm": 600,
            #|  "sides": 32
            #|}
          ),
        }
      "move" => {
        let object_id = match model.primitive_editor {
          Some(editor) if editor.method_name != "scene.create-model" =>
            editor.object_id
          _ =>
            last_primitive(model)
            .map(editor => editor.object_id)
            .unwrap_or("primary-mass")
        }
        {
          ..model,
          method_name: "scene.set-transform",
          params_json: Json::object({
            "objectId": Json::string(object_id),
            "xMm": 0,
            "yMm": 0,
            "zMm": 0,
          }).stringify(indent=2),
        }
      }
      representation =>
        {
          ..model,
          method_name: "representation.export",
          params_json: (
            $|{
            $|  "representation": "\{representation}",
            $|  "outputPath": ".moonsuite/products/moonmold/projects/\{model.project_id}/\{model.model_id}/representations/\{representation}-\{model.revision}.json"
            $|}
          ),
        }
    },
  )
}

///|
fn update(
  emit : @rabbita.Emit[Msg],
  msg : Msg,
  model : Model,
) -> (@rabbita.Cmd, Model) {
  // A queued second click cannot dispatch another operation while one is in
  // flight. Typed fields remain visibly disabled until the response arrives.
  if model.busy {
    match msg {
      SaveRequest
      | LoadRequest
      | ValidateRequest
      | ExecuteRequest
      | ReconcileRun
      | SubmitReview
      | FreezeBrief
      | BuildDelivery
      | RefreshDelivery
      | OpenDelivery
      | SetDeliverySelection(_)
      | SubmitDeliveryReview
      | ApplyTemplate(_)
      | SetPrimitiveField(_, _)
      | SetBrief(_)
      | SetBriefField(_, _)
      | PrepareBrief
      | ReviseBrief
      | LoadPackageBrief
      | CopyLastPrimitive => return (@rabbita.none, model)
      _ => ()
    }
  }
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
    StatusLoaded(Err(error)) =>
      (@rabbita.none, { ..model, error, busy: false, })
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
      } else if model.draft_changed {
        // Preserve unfinished operation fields, but do not reuse the startup
        // default identity when durable recovery has already reserved it.
        let model = if model.revision == 1 &&
          model.request_id == "spatial-request-1" &&
          model.idempotency_key == "spatial-operation-1" {
          {
            ..model,
            revision: payload.next_revision,
            request_id: payload.next_request_id,
            idempotency_key: payload.next_idempotency_key,
          }
        } else {
          model
        }
        (
          @rabbita.none,
          {
            ..model,
            busy: false,
            notice: "Recovery arrived after unsaved edits; your draft was preserved. Refresh retained objects to inspect the durable scene.",
          },
        )
      } else {
        match payload.run {
          None =>
            (
              @rabbita.none,
              {
                ..restore_delivery(model, payload.delivery),
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
              Err(error) => (@rabbita.none, { ..model, busy: false, error, })
              Ok(loaded) =>
                (
                  @rabbita.none,
                  {
                    ..restore_delivery(loaded, payload.delivery),
                    revision: payload.next_revision,
                    request_id: payload.next_request_id,
                    idempotency_key: payload.next_idempotency_key,
                    expected_parent_digest: next_scene_parent(
                      run,
                      loaded.expected_parent_digest,
                    ),
                    last_flow_request: Some(run.flow_request),
                    last_spatial_request: Some(run.request),
                    last_receipt: run.receipt,
                    last_result: Some(run.result),
                    representations: run.representations,
                    reviews: run.reviews,
                    draft_changed: false,
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
    SetRequestId(value) =>
      (@rabbita.none, { ..model, request_id: value, draft_changed: true, })
    SetIdempotencyKey(value) =>
      (@rabbita.none, { ..model, idempotency_key: value, draft_changed: true, })
    SetProjectId(value) =>
      (
        @rabbita.none,
        {
          ..model,
          project_id: value,
          draft_changed: true,
          retained_scene: None,
          selected_object: "",
          scene_generation: model.scene_generation + 1,
          scene_loading: false,
          scene_error: "",
        },
      )
    SetModelId(value) =>
      (
        @rabbita.none,
        {
          ..model,
          model_id: value,
          draft_changed: true,
          retained_scene: None,
          selected_object: "",
          scene_generation: model.scene_generation + 1,
          scene_loading: false,
          scene_error: "",
        },
      )
    SetExpectedParent(value) =>
      (
        @rabbita.none,
        { ..model, expected_parent_digest: value, draft_changed: true, },
      )
    SetIntent(value) =>
      (@rabbita.none, { ..model, intent: value, draft_changed: true, })
    SetReferences(value) =>
      (@rabbita.none, { ..model, references: value, draft_changed: true, })
    SetConstraints(value) =>
      (@rabbita.none, { ..model, constraints: value, draft_changed: true, })
    SetBackend(value) =>
      (
        @rabbita.none,
        { ..model, backend_preference: value, draft_changed: true, },
      )
    SetMethod(value) =>
      (
        @rabbita.none,
        sync_primitive_editor({
          ..model,
          method_name: value,
          draft_changed: true,
          error: "",
        }),
      )
    SetParams(value) =>
      (
        @rabbita.none,
        sync_primitive_editor({
          ..model,
          params_json: value,
          draft_changed: true,
          error: "",
        }),
      )
    SetPrimitiveField(name, value) =>
      (@rabbita.none, edit_primitive(model, name, value))
    RefreshScene
    | SceneLoaded(_, _, _, _)
    | SelectObject(_)
    | PrepareObject(_) => update_retained_scene(emit, msg, model)
    CopyLastPrimitive =>
      match last_primitive(model) {
        Some(editor) =>
          match primitive_params(editor) {
            Ok(params) =>
              (
                @rabbita.none,
                {
                  ..model,
                  method_name: editor.method_name,
                  primitive_editor: Some(editor),
                  params_json: params.stringify(indent=2),
                  draft_changed: true,
                  error: "",
                  notice: "Copied the last applied object operation into a new draft. Existing IDs replace primitives and reset their position/material; move sets an absolute position. No operation has run.",
                },
              )
            Err(error) => (@rabbita.none, { ..model, error, })
          }
        None =>
          (
            @rabbita.none,
            {
              ..model,
              error: "No supported applied object operation for this project/model is available to copy.",
            },
          )
      }
    SetLoadRef(value) => (@rabbita.none, { ..model, load_ref: value, })
    SetReviewer(value) => (@rabbita.none, { ..model, reviewer: value, })
    SetDecision(value) => (@rabbita.none, { ..model, decision: value, })
    SetReviewNotes(value) => (@rabbita.none, { ..model, review_notes: value, })
    ApplyTemplate(name) =>
      (
        @rabbita.none,
        {
          ..template(model, name),
          draft_changed: true,
          error: "",
          notice: "Operation draft selected. Fill in its fields, then validate and execute. This replaces unsaved parameters; no operation has run.",
        },
      )
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
    RequestSaved(Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error, })
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
              draft_changed: true,
              busy: false,
              load_ref: payload.reference,
              notice: "Loaded " + payload.reference,
              error: "",
            },
          )
        Err(error) => (@rabbita.none, { ..model, busy: false, error, })
      }
    RequestLoaded(Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error, })
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
          expected_parent_digest: next_draft_scene_parent(payload, model),
          last_flow_request: Some(payload.flow_request),
          last_spatial_request: Some(payload.request),
          last_receipt: payload.receipt,
          last_result: Some(payload.result),
          representations: payload.representations,
          reviews: payload.reviews,
          delivery_export: next_delivery_export(model, payload),
          draft_changed: match spatial_request(model) {
            Ok(request) => request != payload.request
            Err(_) => true
          },
          busy: false,
          notice: "Terminal receipt is durable. Named review remains separate.",
          error: "",
        },
      )
    }
    RunCompleted(Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error, })
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
          expected_parent_digest: next_draft_scene_parent(payload, model),
          last_flow_request: Some(payload.flow_request),
          last_spatial_request: Some(payload.request),
          last_receipt: payload.receipt,
          last_result: Some(payload.result),
          representations: payload.representations,
          reviews: payload.reviews,
          delivery_export: next_delivery_export(model, payload),
          busy: false,
          notice: "Reconciliation completed without replaying a new attempt.",
          error: "",
        },
      )
    Reconciled(Err(error)) => (@rabbita.none, { ..model, busy: false, error, })
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
            { ..model, error: "Execute or validate before recording review.", },
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
      (@rabbita.none, { ..model, busy: false, error, })
    _ => update_delivery(emit, msg, model)
  }
}
