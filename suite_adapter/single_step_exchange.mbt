///|
fn verification_value(fields : Map[String, Json], name : String) -> Json raise {
  guard fields.get(name) is Some(value) else {
    fail("verification requires " + name)
  }
  value
}

///|
fn verification_relative_path(path : String) -> Bool {
  !path.is_empty() &&
  !path.has_prefix("/") &&
  !path.contains(":") &&
  !path.contains("\\") &&
  !path.contains("\u0000") &&
  !path.split("/").any(part => part == "" || part == "." || part == "..")
}

///|
pub fn single_step_expected_artifacts(input : Json) -> Array[String] raise {
  let fields = wire_object(input, "single-step primary input")
  guard wire_string(fields, "contract_id") ==
    "moonmold.spatial-operation-request.v1" &&
    wire_string(fields, "authority") == "WorkspaceMutation" &&
    wire_string(fields, "backend_preference") == "mock-reference" else {
    fail("single-step only supports the native digital reference input")
  }
  let operation = wire_object(
    verification_value(fields, "operation"),
    "semantic operation",
  )
  if wire_string(operation, "method") == "representation.export" {
    let params = wire_object(
      verification_value(operation, "params"),
      "export parameters",
    )
    let path = wire_string(params, "outputPath")
    guard verification_relative_path(path) else {
      fail("export requires a canonical relative artifact")
    }
    [path]
  } else {
    []
  }
}

///|
/// A fixed read-only exchange: the host binds the exact exchange bytes to its
/// pinned native verifier. The pack owns operation, health and receipt policy.
pub fn single_step_verify_exchange(
  value : Json,
  exchange_sha256 : String,
) -> Json raise {
  let fields = wire_object(value, "single-step verification")
  guard wire_string(fields, "contract_id") ==
    "moonflow.single-step-verification-request.v1" else {
    fail("verification request contract differs")
  }
  let phase = wire_string(fields, "phase")
  guard phase is ("prepare" | "result") else {
    fail("unsupported read-only verification phase")
  }
  let request = decode_moonflow_adapter_request(
    verification_value(fields, "adapter_request"),
  )
  guard single_step_request_supported(request) else {
    fail("unsupported exact native operation")
  }
  let legacy_reconciliation = if fields.get("legacy_action") is Some(action) {
    let legacy = wire_object(action, "legacy single-step action")
    guard fields.get("reconcile") == Some(Json::boolean(true)) &&
      wire_string(legacy, "contract_id") == "moonflow.single-step-action.v1" &&
      wire_string(legacy, "status") == "reconcile-required" &&
      wire_string(legacy, "run_id") == request.run_id &&
      wire_string(legacy, "work_item_id") == request.work_item_id &&
      !wire_string(legacy, "request_id").is_empty() &&
      decode_moonflow_adapter_request(
        verification_value(legacy, "adapter_request"),
      ) ==
      request else {
      fail("legacy action may only reconcile the exact original native attempt")
    }
    true
  } else {
    false
  }
  single_step_validate_health(
    verification_value(fields, "health"),
    wire_string(fields, "checked_at"),
    wire_string(fields, "valid_until"),
  )
  let expected = single_step_expected_artifacts(
    verification_value(fields, "primary_input"),
  )
  let receipt_ref = single_step_receipt_ref(request)
  if phase == "result" {
    let result : AdapterResult = @json.from_json(
      verification_value(fields, "result"),
    )
    single_step_validate_receipt(
      request,
      result,
      verification_value(fields, "receipt"),
      wire_string(fields, "receipt_digest"),
      expected,
    )
  }
  let artifact_paths : Array[String] = [
    ".moonsuite/products/moonmold/adapter-attempts/" + request.attempt_id,
    ".moonsuite/products/moonmold/runtime/semantic-journal.json",
    ..expected,
  ]
  {
    "contract_id": "moonflow.single-step-verification.v1",
    "accepted": true,
    "phase": phase,
    "exchange_sha256": exchange_sha256,
    "legacy_reconciliation": legacy_reconciliation,
    "request_id": request.request_id,
    "attempt_id": request.attempt_id,
    "input_digest": request.input_digest,
    "product_id": request.product_id,
    "operation": request.operation,
    "requested_authority": request.requested_authority,
    "required_claim": request.required_claim,
    "adapter_id": adapter_id(),
    "pack_version": pack_version(),
    "receipt_ref": receipt_ref,
    "expected_artifacts": expected,
    "artifact_paths": artifact_paths,
    "qualification": {
      "evidence_class": "fixture-reference-only",
      "production_qualified": false,
      "physical_authority": false,
      "blender_evidence": false,
    },
  }
}
