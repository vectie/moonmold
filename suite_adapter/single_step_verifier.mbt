///|
/// Pack-owned acceptance policy for the selected native digital operation.
/// Hosts exchange the portable adapter request; no sibling source is imported.
pub fn single_step_request_supported(request : MoonflowAdapterRequest) -> Bool {
  request.product_id == "moonmold" &&
  request.operation == "moonmold/spatial.operation.execute@0.2.0" &&
  request.requested_authority == "workspace-mutation" &&
  request.required_claim == "digital-artifact" &&
  request.input_contracts == ["moonmold/spatial-operation-request@1.0.0"] &&
  request.output_contracts == ["moonmold/spatial-operation-receipt@1.0.0"]
}

///|
pub fn single_step_receipt_ref(
  request : MoonflowAdapterRequest,
) -> String raise {
  guard request.attempt_id.length() > 0 &&
    request.attempt_id.length() <= 160 &&
    !request.attempt_id.has_prefix("-") &&
    request.attempt_id.all(ch => {
      ch.is_ascii_alphabetic() || ch.is_ascii_digit() || ch == '-' || ch == '_'
    }) else {
    fail("single-step requires a bounded safe attempt identity")
  }
  ".moonsuite/products/moonmold/adapter-attempts/" +
  request.attempt_id +
  "/operation-receipt.json"
}

///|
/// Validate the pack's receipt and qualification. The generic host separately
/// validates adapter request/result shape, correlation and durable import.
pub fn single_step_validate_receipt(
  request : MoonflowAdapterRequest,
  result : AdapterResult,
  receipt : Json,
  receipt_digest : String,
  expected_artifacts : Array[String],
) -> Unit raise {
  guard single_step_request_supported(request) &&
    result.request_id == request.request_id &&
    result.attempt_id == request.attempt_id &&
    result.idempotency_key == request.idempotency_key &&
    result.product_id == request.product_id &&
    result.status == "succeeded" else {
    fail("Mold did not return a correlated successful terminal result")
  }
  guard result.output_digest == receipt_digest &&
    result.output_artifacts ==
    [single_step_receipt_ref(request), ..expected_artifacts] else {
    fail("Mold output receipt digest or declared artifact identity differs")
  }
  let fields = wire_object(receipt, "Mold operation receipt")
  guard wire_string(fields, "contract_id") ==
    "moonmold.spatial-operation-receipt.v1" &&
    wire_string(fields, "operation_ref") ==
    "moonmold/spatial.operation.execute@0.2.0" &&
    wire_string(fields, "request_id") == request.request_id &&
    wire_string(fields, "attempt_id") == request.attempt_id &&
    wire_string(fields, "idempotency_key") == request.idempotency_key &&
    wire_string(fields, "outcome") is ("applied" | "idempotent-no-op") &&
    wire_string(fields, "claim_ceiling") == "digital-artifact" &&
    fields.get("physical_authority") == Some(Json::boolean(false)) &&
    fields.get("review_required") == Some(Json::boolean(true)) &&
    wire_strings(fields, "artifacts", required=true) == expected_artifacts else {
    fail(
      "Mold operation receipt correlation, outcome or claim boundary differs",
    )
  }
  guard fields.get("backend_qualification") is Some(Object(qualification)) &&
    qualification.get("evidence_class") ==
    Some(Json::string("fixture-reference-only")) &&
    qualification.get("production_qualified") == Some(Json::boolean(false)) &&
    qualification.get("physical_authority") == Some(Json::boolean(false)) &&
    qualification.get("blender_evidence") == Some(Json::boolean(false)) else {
    fail("Mold native reference qualification must remain explicit")
  }
}

///|
/// The operation/health schema belongs to this pack. Digest verification and
/// generic timestamp freshness remain the orchestration host's responsibility.
pub fn single_step_validate_health(
  evidence : Json,
  checked_at : String,
  valid_until : String,
) -> Unit raise {
  let fields = wire_object(evidence, "Mold adapter health evidence")
  guard wire_string(fields, "contract_id") ==
    "moonmold.adapter-health-evidence.v1" &&
    wire_string(fields, "adapter_id") == adapter_id() &&
    wire_string(fields, "pack_version") == pack_version() &&
    wire_string(fields, "checked_at") == checked_at &&
    wire_string(fields, "valid_until") == valid_until &&
    fields.get("semantic_runtime") is Some(Object(runtime)) &&
    runtime.get("production_qualified") == Some(Json::boolean(false)) else {
    fail(
      "Mold health evidence does not bind the exact native reference capability",
    )
  }
}
