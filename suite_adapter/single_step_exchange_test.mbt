///|
fn public_verifier_request() -> @suite_adapter.MoonflowAdapterRequest {
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
fn public_verification_exchange() -> Json {
  {
    "contract_id": "moonflow.single-step-verification-request.v1",
    "phase": "prepare",
    "adapter_request": ToJson::to_json(public_verifier_request()),
    "checked_at": "2026-10-07T07:00:00Z",
    "valid_until": "2026-10-07T08:00:00Z",
    "primary_input": {
      "contract_id": "moonmold.spatial-operation-request.v1",
      "authority": "WorkspaceMutation",
      "backend_preference": "mock-reference",
      "operation": { "method": "scene.create-model", "params": {} },
    },
    "health": {
      "contract_id": "moonmold.adapter-health-evidence.v1",
      "adapter_id": "moonmold-pack-local-v1",
      "pack_version": "0.2.0",
      "checked_at": "2026-10-07T07:00:00Z",
      "valid_until": "2026-10-07T08:00:00Z",
      "semantic_runtime": { "production_qualified": false },
    },
  }
}

///|
test "public owner verifier binds portable request health policy and exact qualification" {
  let exchange = public_verification_exchange()
  let digest = "sha256:" + "a".repeat(64)
  let proof = @suite_adapter.single_step_verify_exchange(exchange, digest)
  guard proof is Object(fields) else { fail("proof") }
  assert_eq(fields.get("exchange_sha256"), Some(Json::string(digest)))
  assert_eq(
    fields.get("receipt_ref"),
    Some(
      Json::string(
        @suite_adapter.single_step_receipt_ref(public_verifier_request()),
      ),
    ),
  )
  assert_eq(
    fields.get("qualification"),
    Some({
      "evidence_class": "fixture-reference-only",
      "production_qualified": false,
      "physical_authority": false,
      "blender_evidence": false,
    }),
  )
  for
    (field, value) in [
      ("phase", Json::string("invoke")),
      ("contract_id", Json::string("unknown")),
      ("checked_at", Json::string("2026-10-07T07:00:01Z")),
      (
        "adapter_request",
        ToJson::to_json({
          ..public_verifier_request(),
          requested_authority: "physical-effect",
        }),
      ),
    ] {
    guard public_verification_exchange() is Object(invalid) else {
      fail("fixture")
    }
    invalid[field] = value
    try
      @suite_adapter.single_step_verify_exchange(Json::object(invalid), digest)
    catch {
      _ => ()
    } noraise {
      _ => fail("tampered owner verification must fail")
    }
  }
}

///|
test "public owner capture declaration and export paths preserve the schema and workspace ceiling" {
  let operation = @suite_adapter.find_operation_contract(
    "spatial.operation.execute",
  ).unwrap()
  let policy = @suite_adapter.input_capture_policy_json(operation)
  guard policy is Object(fields) else { fail("policy") }
  assert_eq(
    fields.get("reference_array_field"),
    Some(Json::string("reference_artifacts")),
  )
  assert_eq(
    fields.get("payload_contract_id"),
    Some(Json::string("moonmold.spatial-operation-request.v1")),
  )
  for
    path in [
      "../escape", "/absolute", "a//b", "a/./b", "https://example.invalid/output",
      "a\\b",
    ] {
    let input : Json = {
      "contract_id": "moonmold.spatial-operation-request.v1",
      "authority": "WorkspaceMutation",
      "backend_preference": "mock-reference",
      "operation": {
        "method": "representation.export",
        "params": { "outputPath": path },
      },
    }
    try @suite_adapter.single_step_expected_artifacts(input) catch {
      _ => ()
    } noraise {
      _ => fail("unsafe export path must fail")
    }
  }
}

///|
test "legacy configuration migration preserves exact executable hashes and authority refs" {
  let legacy : Json = {
    "contract_id": "moonflow.single-step-config.v1",
    "capability_ref": "trusted/catalog.json",
    "envelope_ref": "trusted/envelope.json",
    "usage_ref": "trusted/usage.json",
    "gate_executable": "/native/gate",
    "gate_sha256": "sha256:gate",
    "mold_executable": "/native/adapter",
    "mold_sha256": "sha256:adapter",
  }
  guard @suite_adapter.migrate_single_step_config_v2(legacy) is Object(fields) else {
    fail("config")
  }
  assert_eq(
    fields.get("contract_id"),
    Some(Json::string("moonflow.single-step-config.v2")),
  )
  assert_eq(
    fields.get("adapter_executable"),
    Some(Json::string("/native/adapter")),
  )
  assert_eq(fields.get("adapter_sha256"), Some(Json::string("sha256:adapter")))
  assert_eq(
    fields.get("envelope_ref"),
    Some(Json::string("trusted/envelope.json")),
  )
}

///|
test "legacy actions are accepted only for exact original-attempt reconciliation" {
  let exchange = public_verification_exchange()
  guard exchange is Object(fields) else { fail("exchange") }
  fields["reconcile"] = true.to_json()
  let action : Json = {
    "contract_id": "moonflow.single-step-action.v1",
    "status": "reconcile-required",
    "run_id": "run-fixture",
    "work_item_id": "selected",
    "request_id": "original-ui-action",
    "adapter_request": ToJson::to_json(public_verifier_request()),
  }
  fields["legacy_action"] = action
  guard @suite_adapter.single_step_verify_exchange(exchange, "sha256:exchange")
    is Object(proof) else {
    fail("proof")
  }
  assert_eq(proof.get("legacy_reconciliation"), Some(Json::boolean(true)))
  for
    (field, value) in [
      ("status", Json::string("review")),
      ("run_id", Json::string("other-run")),
      (
        "adapter_request",
        ToJson::to_json({
          ..public_verifier_request(),
          attempt_id: "different-attempt",
        }),
      ),
    ] {
    guard @json.parse(action.stringify()) is Object(invalid) else {
      fail("action")
    }
    invalid[field] = value
    fields["legacy_action"] = Json::object(invalid)
    try
      @suite_adapter.single_step_verify_exchange(exchange, "sha256:exchange")
    catch {
      _ => ()
    } noraise {
      _ => fail("legacy correlation tamper must be refused")
    }
  }
  fields["legacy_action"] = action
  fields["reconcile"] = false.to_json()
  try
    @suite_adapter.single_step_verify_exchange(exchange, "sha256:exchange")
  catch {
    _ => ()
  } noraise {
    _ => fail("legacy action must never authorize an invocation")
  }
}
