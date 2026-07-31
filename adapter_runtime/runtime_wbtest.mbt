///|
fn test_workspace() -> String {
  "/Users/kq/moonsuite/.tmp/moonmold-adapter-v2-20260731-v2"
}

///|
fn test_spatial_request() -> Json {
  {
    "contract_id": "moonmold.spatial-operation-request.v1",
    "request_id": "spatial-runtime-test-1",
    "idempotency_key": "spatial-runtime-test-key-1",
    "project_id": "runtime-test-project",
    "model_id": "runtime-test-model",
    "expected_parent_digest": "mm1-empty-scene",
    "authority": "WorkspaceMutation",
    "intent": "Prove durable semantic execution and restart reconciliation.",
    "reference_artifacts": [],
    "constraints": ["no physical authority"],
    "backend_preference": "mock-reference",
    "operation": {
      "method": "scene.create-model",
      "params": {
        "name": "runtime-test-model",
        "units": "mm",
        "coordinateFrame": "z-up-right-handed",
      },
    },
  }
}

///|
fn test_flow_request(
  input_digest : String,
) -> @suite_adapter.MoonflowAdapterRequest {
  {
    request_id: "flow-spatial-runtime-test-1",
    run_id: "runtime-test-run",
    book_id: "runtime-test-book",
    work_item_id: "runtime-test-model-create",
    declaration_id: "moonmold-pack-local-v1/spatial.operation.execute",
    attempt_id: "attempt-spatial-runtime-test-1",
    idempotency_key: "flow-spatial-runtime-test-key-1",
    product_id: "moonmold",
    operation: "spatial.operation.execute",
    requested_authority: "workspace-mutation",
    acceptance_criteria: ["physical_authority=false"],
    input_contracts: ["moonmold/spatial-operation-request@1.0.0"],
    output_contracts: ["moonmold/spatial-operation-receipt@1.0.0"],
    required_claim: "digital-artifact",
    input_digest,
    input_artifacts: [
      ".moonsuite/products/moonmold/test-inputs/spatial-runtime-test-1.json", ".moonsuite/products/moonmold/test-inputs/dependency-evidence.json",
    ],
    timeout_ms: 120000,
    created_at: "2026-07-31T00:00:00Z",
  }
}

///|
test "durable v2 adapter executes once and reconciles from evidence" {
  let workspace = test_workspace()
  let input_refs = [
    ".moonsuite/products/moonmold/test-inputs/spatial-runtime-test-1.json", ".moonsuite/products/moonmold/test-inputs/dependency-evidence.json",
  ]
  let input_path = resolve_ref(workspace, input_refs[0]).unwrap()
  write_json(input_path, test_spatial_request()) |> ignore
  let evidence_path = resolve_ref(workspace, input_refs[1]).unwrap()
  write_json(evidence_path, {
    "contract_id": "moonsuite.immutable-dependency-evidence.v1",
    "source": "moonflow",
  })
  |> ignore
  let aggregate_digest = input_artifact_set_digest(workspace, input_refs).unwrap()
  let request = test_flow_request(aggregate_digest)
  let (primary_ref, _, primary) = load_input(workspace, request).unwrap()
  assert_eq(primary_ref, input_refs[0])
  guard primary is { "contract_id": String(contract_id), .. } else {
    fail("typed primary input must remain first")
  }
  assert_eq(contract_id, "moonmold.spatial-operation-request.v1")
  let first = invoke(workspace, request).unwrap()
  let repeated = invoke(workspace, request).unwrap()
  assert_eq(first.output_digest, repeated.output_digest)
  assert_eq(first.status, "succeeded")
  assert_true(first.output_artifacts.contains(receipt_ref(request.attempt_id)))
  let recovery = reconcile(workspace, request).unwrap()
  assert_eq(recovery.decision, "recovered-succeeded")
  assert_false(recovery.retry_allowed)
  assert_true(recovery.evidence_refs.contains(result_ref(request.attempt_id)))
}

///|
test "health binds all exact operation refs to expiring SHA evidence" {
  let health = health_attestation(
    test_workspace(),
    "2026-07-31T00:00:00Z",
    "2026-07-31T00:15:00Z",
  ).unwrap()
  assert_eq(health.contract_id, "moonflow.adapter-health.v1")
  assert_eq(health.protocol, "moonflow.adapter.v2")
  assert_eq(health.operation_refs, @suite_adapter.operation_refs())
  assert_true(health.evidence_digest.has_prefix("sha256:"))
  assert_eq(health.evidence_digest.length(), 71)
}
