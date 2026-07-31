///|
struct RequestPayload {
  reference : String
  request : Json
} derive(Debug, FromJson)

///|
struct RunPayload {
  request : Json
  flow_request : Json
  result : Json
  receipt : Json?
  representations : Array[Json]
  reviews : Array[Json]
} derive(Debug, FromJson)

///|
struct ReviewPayload {
  reference : String
  review : Json
} derive(Debug, FromJson)

///|
struct Model {
  revision : Int
  request_id : String
  idempotency_key : String
  project_id : String
  model_id : String
  expected_parent_digest : String
  intent : String
  references : String
  constraints : String
  backend_preference : String
  method_name : String
  params_json : String
  load_ref : String
  reviewer : String
  decision : String
  review_notes : String
  status : Json?
  last_flow_request : Json?
  last_spatial_request : Json?
  last_receipt : Json?
  representations : Array[Json]
  reviews : Array[Json]
  busy : Bool
  notice : String
  error : String
}

///|
enum Msg {
  StatusLoaded(Result[Json, String])
  SetRequestId(String)
  SetIdempotencyKey(String)
  SetProjectId(String)
  SetModelId(String)
  SetExpectedParent(String)
  SetIntent(String)
  SetReferences(String)
  SetConstraints(String)
  SetBackend(String)
  SetMethod(String)
  SetParams(String)
  SetLoadRef(String)
  SetReviewer(String)
  SetDecision(String)
  SetReviewNotes(String)
  ApplyTemplate(String)
  SaveRequest
  RequestSaved(Result[RequestPayload, String])
  LoadRequest
  RequestLoaded(Result[RequestPayload, String])
  ValidateRequest
  ExecuteRequest
  RunCompleted(Result[RunPayload, String])
  ReconcileRun
  Reconciled(Result[RunPayload, String])
  SubmitReview
  ReviewSubmitted(Result[ReviewPayload, String])
}

///|
fn initial_model() -> Model {
  {
    revision: 1,
    request_id: "spatial-request-1",
    idempotency_key: "spatial-operation-1",
    project_id: "example-project",
    model_id: "example-model",
    expected_parent_digest: "mm1-empty-scene",
    intent: "Create a reviewable digital model while preserving representation boundaries.",
    references: "references/approved-spatial-brief.json",
    constraints: "No physical authority\nPreserve units and coordinate frame",
    backend_preference: "mock-reference",
    method_name: "scene.create-model",
    params_json: (
      #|{
      #|  "name": "example-model",
      #|  "units": "mm",
      #|  "coordinateFrame": "z-up-right-handed"
      #|}
    ),
    load_ref: ".moonsuite/products/moonmold/requests/spatial-request-1.json",
    reviewer: "",
    decision: "approve",
    review_notes: "",
    status: None,
    last_flow_request: None,
    last_spatial_request: None,
    last_receipt: None,
    representations: [],
    reviews: [],
    busy: false,
    notice: "Load or create a governed spatial operation.",
    error: "",
  }
}

///|
fn lines(value : String) -> Array[String] {
  value
  .split("\n")
  .map(item => item.trim().to_owned())
  .filter(item => !item.is_empty())
  .to_array()
}

///|
fn spatial_request(model : Model) -> Result[Json, String] {
  let params = @json.parse(model.params_json) catch {
    error => return Err("Operation parameters are invalid JSON: \{error}")
  }
  Ok({
    "contract_id": "moonmold.spatial-operation-request.v1",
    "request_id": model.request_id,
    "idempotency_key": model.idempotency_key,
    "project_id": model.project_id,
    "model_id": model.model_id,
    "expected_parent_digest": model.expected_parent_digest,
    "authority": "WorkspaceMutation",
    "intent": model.intent,
    "reference_artifacts": lines(model.references),
    "constraints": lines(model.constraints),
    "backend_preference": model.backend_preference,
    "operation": {
      "method": model.method_name,
      "params": params,
    },
  })
}

///|
fn next_identity(model : Model) -> (Int, String, String) {
  let revision = model.revision + 1
  (
    revision,
    "spatial-request-\{revision}",
    "spatial-operation-\{revision}",
  )
}
