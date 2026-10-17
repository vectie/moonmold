///|
fn verifier_request() -> MoonflowAdapterRequest {
  {
    request_id: "request-fixture",
    run_id: "run-fixture",
    book_id: "book-fixture",
    work_item_id: "selected",
    declaration_id: "selected",
    attempt_id: "attempt-fixture",
    idempotency_key: "key-fixture",
    product_id: "moonmold",
    operation: "moonmold/spatial.operation.execute@0.2.0",
    requested_authority: "workspace-mutation",
    acceptance_criteria: ["Explicit review"],
    input_contracts: ["moonmold/spatial-operation-request@1.0.0"],
    output_contracts: ["moonmold/spatial-operation-receipt@1.0.0"],
    required_claim: "digital-artifact",
    input_digest: "sha256:fixture",
    input_artifacts: ["requests/selected.json"],
    timeout_ms: 60000,
    created_at: "2026-10-07T07:00:00Z",
  }
}

///|
fn verifier_receipt(request : MoonflowAdapterRequest) -> Json {
  {
    "contract_id": "moonmold.spatial-operation-receipt.v1",
    "operation_ref": request.operation,
    "request_id": request.request_id,
    "attempt_id": request.attempt_id,
    "idempotency_key": request.idempotency_key,
    "outcome": "applied",
    "claim_ceiling": "digital-artifact",
    "physical_authority": false,
    "review_required": true,
    "artifacts": [],
    "backend_qualification": {
      "evidence_class": "fixture-reference-only",
      "production_qualified": false,
      "physical_authority": false,
      "blender_evidence": false,
    },
  }
}

///|
fn verifier_result(request : MoonflowAdapterRequest) -> AdapterResult raise {
  {
    result_id: "result-fixture",
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    idempotency_key: request.idempotency_key,
    product_id: request.product_id,
    external_job_id: "",
    status: "succeeded",
    output_digest: "sha256:receipt",
    output_artifacts: [single_step_receipt_ref(request)],
    error_kind: "",
    compensable: false,
    recorded_at: request.created_at,
  }
}

///|
test "pack verifier retains exact operation authority and claim boundaries" {
  let request = verifier_request()
  assert_true(single_step_request_supported(request))
  for
    invalid in [
      { ..request, product_id: "other", },
      { ..request, operation: "spatial.operation.execute", },
      { ..request, operation: "moonmold/spatial.operation.execute@0.3.0", },
      { ..request, requested_authority: "physical-effect", },
      { ..request, required_claim: "physical-readiness", },
      { ..request, input_contracts: [], },
      { ..request, output_contracts: [], },
    ] {
    assert_false(single_step_request_supported(invalid))
  }
}

///|
test "pack receipt verifier accepts exact native evidence and refuses tampering" {
  let request = verifier_request()
  let result = verifier_result(request)
  single_step_validate_receipt(
    request,
    result,
    verifier_receipt(request),
    "sha256:receipt",
    [],
  )
  for
    invalid in [
      { ..result, request_id: "other", },
      { ..result, attempt_id: "other", },
      { ..result, idempotency_key: "other", },
      { ..result, product_id: "other", },
      { ..result, status: "failed", },
      { ..result, output_digest: "sha256:wrong", },
      { ..result, output_artifacts: ["unapproved/output"], },
    ] {
    try
      single_step_validate_receipt(
        request,
        invalid,
        verifier_receipt(request),
        "sha256:receipt",
        [],
      )
    catch {
      _ => ()
    } noraise {
      _ => fail("expected correlated evidence refusal")
    }
  }
  for
    (field, value) in [
      ("outcome", Json::string("rejected")),
      ("claim_ceiling", Json::string("physical-readiness")),
      ("physical_authority", Json::boolean(true)),
      ("review_required", Json::boolean(false)),
      (
        "backend_qualification",
        Json::object({
          "evidence_class": Json::string("blender"),
          "production_qualified": Json::boolean(true),
          "physical_authority": Json::boolean(true),
          "blender_evidence": Json::boolean(true),
        }),
      ),
    ] {
    guard verifier_receipt(request) is Object(fields) else { fail("fixture") }
    fields[field] = value
    try
      single_step_validate_receipt(
        request,
        result,
        Json::object(fields),
        "sha256:receipt",
        [],
      )
    catch {
      _ => ()
    } noraise {
      _ => fail("expected pack qualification refusal")
    }
  }
  try single_step_receipt_ref({ ..request, attempt_id: "../escape", }) catch {
    _ => ()
  } noraise {
    _ => fail("unsafe receipt path must be refused")
  }
}
