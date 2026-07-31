///|
pub(all) struct AdapterOperationContract {
  operation_id : String
  authority_class : String
  input_schema : String
  output_schema : String
  claim_ceiling : String
  review_required : Bool
} derive(Debug, Eq, ToJson)

///|
pub(all) struct MoonflowAdapterRequest {
  request_id : String
  run_id : String
  book_id : String
  work_item_id : String
  declaration_id : String
  attempt_id : String
  idempotency_key : String
  product_id : String
  operation : String
  requested_authority : String
  acceptance_criteria : Array[String]
  input_contracts : Array[String]
  output_contracts : Array[String]
  required_claim : String
  input_digest : String
  input_artifacts : Array[String]
  timeout_ms : Int
  created_at : String
} derive(Debug, Eq, ToJson, FromJson)

///|
pub(all) struct SpatialOperationRequest {
  contract_id : String
  request_id : String
  idempotency_key : String
  project_id : String
  model_id : String
  expected_parent_digest : String
  authority : String
  operation : Json
  intent : String
  reference_artifacts : Array[String]
  constraints : Array[String]
  backend_preference : String
} derive(Debug, Eq, ToJson)

///|
pub(all) struct AdapterResult {
  result_id : String
  request_id : String
  attempt_id : String
  idempotency_key : String
  product_id : String
  external_job_id : String
  status : String
  output_digest : String
  output_artifacts : Array[String]
  error_kind : String
  compensable : Bool
  recorded_at : String
} derive(Debug, Eq, ToJson, FromJson)

///|
pub(all) struct AttemptRecord {
  contract_id : String
  adapter_id : String
  request_id : String
  attempt_id : String
  idempotency_key : String
  operation_id : String
  status : String
  request_ref : String
  input_ref : String
  receipt_ref : String
  result_ref : String
  started_at : String
  updated_at : String
} derive(Debug, Eq, ToJson, FromJson)

///|
pub(all) struct ReconciliationReport {
  contract_id : String
  adapter_id : String
  request_id : String
  attempt_id : String
  decision : String
  retry_allowed : Bool
  evidence_refs : Array[String]
  result : AdapterResult
  message : String
  recorded_at : String
} derive(Debug, Eq, ToJson, FromJson)

///|
pub(all) struct AdapterHealthAttestation {
  contract_id : String
  adapter_id : String
  product_id : String
  pack_id : String
  pack_version : String
  protocol : String
  status : String
  checked_at : String
  valid_until : String
  operation_refs : Array[String]
  evidence_ref : String
  evidence_digest : String
} derive(Debug, Eq, ToJson, FromJson)

///|
fn wire_object(value : Json, label : String) -> Map[String, Json] raise {
  match value {
    Object(fields) => fields
    _ => fail("\{label} must be a JSON object")
  }
}

///|
fn wire_string(
  fields : Map[String, Json],
  name : String,
  required? : Bool = true,
) -> String raise {
  match fields.get(name) {
    Some(String(value)) => value
    None if !required => ""
    _ => fail("\{name} must be a string")
  }
}

///|
fn wire_strings(
  fields : Map[String, Json],
  name : String,
  required? : Bool = false,
) -> Array[String] raise {
  match fields.get(name) {
    None if !required => []
    Some(Array(values)) =>
      values.map(value => {
        match value {
          String(text) => text
          _ => fail("\{name} must contain only strings")
        }
      })
    _ => fail("\{name} must be an array")
  }
}

///|
fn wire_int(fields : Map[String, Json], name : String) -> Int raise {
  match fields.get(name) {
    Some(value) => @json.from_json(value)
    None => fail("\{name} is required")
  }
}

///|
pub fn decode_moonflow_adapter_request(
  value : Json,
) -> MoonflowAdapterRequest raise {
  let fields = wire_object(value, "MoonFlow adapter request")
  {
    request_id: wire_string(fields, "request_id"),
    run_id: wire_string(fields, "run_id"),
    book_id: wire_string(fields, "book_id"),
    work_item_id: wire_string(fields, "work_item_id"),
    declaration_id: wire_string(fields, "declaration_id"),
    attempt_id: wire_string(fields, "attempt_id"),
    idempotency_key: wire_string(fields, "idempotency_key"),
    product_id: wire_string(fields, "product_id"),
    operation: wire_string(fields, "operation"),
    requested_authority: wire_string(fields, "requested_authority"),
    acceptance_criteria: wire_strings(fields, "acceptance_criteria"),
    input_contracts: wire_strings(fields, "input_contracts"),
    output_contracts: wire_strings(fields, "output_contracts"),
    required_claim: wire_string(fields, "required_claim", required=false),
    input_digest: wire_string(fields, "input_digest"),
    input_artifacts: wire_strings(fields, "input_artifacts"),
    timeout_ms: wire_int(fields, "timeout_ms"),
    created_at: wire_string(fields, "created_at"),
  }
}

///|
pub fn decode_spatial_operation_request(
  value : Json,
) -> SpatialOperationRequest raise {
  let fields = wire_object(value, "MoonMold spatial operation request")
  let operation = match fields.get("operation") {
    Some(value) => value
    None => fail("operation is required")
  }
  {
    contract_id: wire_string(fields, "contract_id"),
    request_id: wire_string(fields, "request_id"),
    idempotency_key: wire_string(fields, "idempotency_key"),
    project_id: wire_string(fields, "project_id"),
    model_id: wire_string(fields, "model_id"),
    expected_parent_digest: wire_string(fields, "expected_parent_digest"),
    authority: wire_string(fields, "authority"),
    operation,
    intent: wire_string(fields, "intent", required=false),
    reference_artifacts: wire_strings(fields, "reference_artifacts"),
    constraints: wire_strings(fields, "constraints"),
    backend_preference: wire_string(
      fields,
      "backend_preference",
      required=false,
    ),
  }
}
