///|
test "run payload accepts older execution response without reviews" {
  let payload : RunPayload = @json.from_json({
    "request": { "request_id": "spatial-request-1" },
    "flow_request": { "attempt_id": "attempt-spatial-request-1-exec" },
    "result": { "outcome": "applied" },
    "receipt": {
      "contract_id": "moonmold.spatial-operation-receipt.v1",
      "after_digest": "mm1-example",
    },
    "representations": [],
  })
  inspect(payload.reviews.length(), content="0")
  inspect(receipt_after_digest(payload.receipt), content="Some(mm1-example)")
  inspect(
    flow_attempt_id(Some(payload.flow_request)),
    content="Some(attempt-spatial-request-1-exec)",
  )
}

///|
test "run payload preserves reviews from newer execution response" {
  let payload : RunPayload = @json.from_json({
    "request": { "request_id": "spatial-request-1" },
    "flow_request": { "attempt_id": "attempt-spatial-request-1-exec" },
    "result": { "outcome": "applied" },
    "receipt": {
      "contract_id": "moonmold.spatial-operation-receipt.v1",
      "after_digest": "mm1-example",
    },
    "representations": [],
    "reviews": [
      { "contract_id": "moonmold.named-review.v1", "reviewer": "UI Qualifier" },
    ],
  })
  inspect(payload.reviews.length(), content="1")
}

///|
test "governed operator denial remains visible instead of becoming a payload decode error" {
  let result = parse_run_payload({
    "contract_id": "moonmold.operator-error.v1",
    "code": "workspace-boundary",
    "message": "operator references must be workspace-relative without traversal or URL syntax",
  })
  match result {
    Err(error) =>
      inspect(
        error,
        content=(
          #|workspace-boundary: operator references must be workspace-relative without traversal or URL syntax
        ),
      )
    Ok(_) => fail("expected the governed denial")
  }
}

///|
test "review denial uses the same governed error projection" {
  let result = parse_review_payload({
    "contract_id": "moonmold.operator-error.v1",
    "code": "named-review-required",
    "message": "a named human reviewer is required",
  })
  match result {
    Err(error) =>
      inspect(
        error,
        content="named-review-required: a named human reviewer is required",
      )
    Ok(_) => fail("expected the governed denial")
  }
}

///|
test "recovery payload preserves the exact terminal run and next identity" {
  let payload : RecoveryPayload = @json.from_json({
    "recovered": true,
    "attempt_id": "attempt-spatial-request-1-exec",
    "next_revision": 2,
    "next_request_id": "spatial-request-2",
    "next_idempotency_key": "spatial-operation-2",
    "run": {
      "request": { "request_id": "spatial-request-1" },
      "flow_request": { "attempt_id": "attempt-spatial-request-1-exec" },
      "result": { "status": "succeeded" },
      "receipt": {
        "contract_id": "moonmold.spatial-operation-receipt.v1",
        "after_digest": "mm1-recovered",
      },
      "representations": [],
      "reviews": [
        {
          "contract_id": "moonmold.named-review.v1",
          "reviewer": "UI Qualifier",
        },
      ],
    },
    "physical_authority": false,
  })
  inspect(payload.next_revision, content="2")
  inspect(payload.next_request_id, content="spatial-request-2")
  guard payload.run is Some(run) else { fail("expected recovered run") }
  inspect(receipt_after_digest(run.receipt), content="Some(mm1-recovered)")
  inspect(run.reviews.length(), content="1")
}

///|
test "workflow guide exposes progress without crossing physical authority" {
  let blank = initial_model()
  inspect(workflow_stage(blank), content="1")
  let built = workflow_test_built([])
  inspect(workflow_stage(built), content="3")
  let accepted = { ..built, reviews: [workflow_test_review("approve")], }
  inspect(workflow_stage(accepted), content="4")
  inspect(
    workflow_next_copy(blank, 1).contains("before any model change"),
    content="true",
  )
}
