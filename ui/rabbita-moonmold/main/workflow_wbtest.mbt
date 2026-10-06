///|
fn workflow_test_run(
  model : Model,
  mode : String,
  outcome? : String = "applied",
  after? : String = "mm1-built",
  representations? : Array[Json] = [],
  reviews? : Array[Json] = [],
) -> RunPayload {
  let request = match spatial_request(model) {
    Ok(value) => value
    Err(error) => abort(error)
  }
  let artifacts : Array[Json] = if mode == "execute" {
    match request {
      {
        "operation": {
          "method": String("representation.export"),
          "params": { "outputPath": String(output), .. },
          ..
        },
        ..
      } => [Json::string(output)]
      _ => []
    }
  } else {
    []
  }
  {
    request,
    flow_request: {
      "attempt_id": "attempt-test",
      "operation": "spatial.operation.\{mode}",
    },
    result: {
      "status": "succeeded",
      "attempt_id": "attempt-test",
      "output_digest": "sha256:receipt-test",
      "output_artifacts": [
        ".moonsuite/products/moonmold/adapter-attempts/attempt-test/operation-receipt.json",
        ..artifacts,
      ],
    },
    receipt: Some({
      "contract_id": "moonmold.spatial-operation-receipt.v1",
      "attempt_id": "attempt-test",
      "operation_ref": "moonmold/spatial.operation.\{mode}@0.2.0",
      "outcome": outcome,
      "after_digest": after,
      "artifacts": artifacts,
      "physical_authority": false,
    }),
    representations,
    reviews,
  }
}

///|
fn workflow_test_review(
  decision : String,
  at? : String = "2026-10-04T08:00:00.000Z",
  attempt? : String = "attempt-test",
  digest? : String = "sha256:receipt-test",
  reference? : String = ".moonsuite/products/moonmold/adapter-attempts/attempt-test/operation-receipt.json",
) -> Json {
  {
    "contract_id": "moonmold.named-review.v1",
    "attempt_id": attempt,
    "reviewer": "Named reviewer",
    "decision": decision,
    "notes": "Review only this exact digital result.",
    "receipt_ref": reference,
    "receipt_digest": digest,
    "reviewed_at": at,
    "self_approved": false,
    "physical_authority": false,
  }
}

///|
#warnings("-alert_unstable")
fn workflow_test_update(model : Model, msg : Msg) -> Model {
  let (emit, _) = @rabbita.cell_with_emit(model~, update~, view~)
  let (_, next) = update(emit, msg, model)
  next
}

///|
#warnings("-alert_unstable")
fn workflow_test_html(model : Model) -> String {
  let (_, cell) = @rabbita.cell_with_emit(model~, update~, view~)
  @rabbita.render_to_string(cell)
}

///|
fn workflow_test_built(reviews : Array[Json]) -> Model {
  let blank = template(initial_model(), "editable-source")
  workflow_test_update(
    blank,
    RunCompleted(
      Ok(
        workflow_test_run(
          blank,
          "execute",
          representations=[workflow_test_artifact(blank)],
          reviews~,
        ),
      ),
    ),
  )
}

///|
fn workflow_test_artifact(
  model : Model,
  parent? : String = "mm1-built",
) -> Json {
  {
    "contract_id": "moonmold.spatial-artifact.v1",
    "project_id": model.project_id,
    "model_id": model.model_id,
    "representation": "editable-source",
    "parent_digest": parent,
    "physical_authority": false,
  }
}

///|
test "receipt-bound approve alone reaches accepted and negative decisions retain revision action" {
  for decision in ["approve", "request-changes", "reject"] {
    let model = workflow_test_built([workflow_test_review(decision)])
    assert_eq(workflow_review_decision(model), decision)
    let html = workflow_test_html(model)
    if decision == "approve" {
      assert_eq(workflow_stage(model), 4)
      assert_true(html.contains("<strong>Accepted</strong>"))
      assert_true(html.contains("Start next change"))
    } else {
      assert_eq(workflow_stage(model), 3)
      assert_false(html.contains("<strong>Accepted</strong>"))
      assert_false(html.contains("Start next change"))
      assert_true(html.contains("href=\"#spatial-request\""))
      assert_true(html.contains("Revise request"))
      assert_true(
        html.contains(
          if decision == "reject" {
            "Rejected"
          } else {
            "Changes requested"
          },
        ),
      )
    }
    assert_true(html.contains("no fabrication or physical authority"))
  }
}

///|
test "latest timestamp controls mixed review history regardless of input order" {
  for decision in ["request-changes", "reject"] {
    let old = workflow_test_review("approve")
    let newer = workflow_test_review(decision, at="2026-10-04T09:00:00.000Z")
    for reviews in [[old, newer], [newer, old]] {
      let model = workflow_test_built(reviews)
      assert_eq(workflow_review_decision(model), decision)
      assert_eq(workflow_stage(model), 3)
    }
    let newest = workflow_test_review("approve", at="2026-10-04T10:00:00.000Z")
    assert_eq(workflow_stage(workflow_test_built([newest, newer, old])), 4)
  }
}

///|
test "reviews for other receipt digest reference or attempt cannot approve current result" {
  for
    review in [
      workflow_test_review("approve", attempt="attempt-other"),
      workflow_test_review("approve", digest="sha256:other-receipt"),
      workflow_test_review("approve", reference="other/operation-receipt.json"),
      { "reviewer": "Unbound reviewer", "decision": "approve" },
    ] {
    let model = workflow_test_built([review])
    assert_eq(workflow_review_decision(model), "")
    assert_eq(workflow_stage(model), 3)
    assert_false(
      workflow_test_html(model).contains("<strong>Accepted</strong>"),
    )
  }
  let model = workflow_test_built([
    workflow_test_review("reject"),
    workflow_test_review(
      "approve",
      digest="sha256:other-receipt",
      at="2026-10-05T08:00:00.000Z",
    ),
  ])
  assert_eq(workflow_review_decision(model), "reject")
  assert_eq(workflow_stage({ ..model, last_result: None, }), 1)
}

///|
test "malformed unknown and simultaneous conflicting reviews never fabricate acceptance" {
  for
    review in [
      workflow_test_review("unknown", at="2026-10-04T09:00:00.000Z"),
      workflow_test_review("approve", at="not-a-date"),
      {
        "attempt_id": "attempt-test",
        "receipt_ref": ".moonsuite/products/moonmold/adapter-attempts/attempt-test/operation-receipt.json",
        "receipt_digest": "sha256:receipt-test",
        "decision": "approve",
      },
    ] {
    let model = workflow_test_built([workflow_test_review("approve"), review])
    assert_eq(workflow_stage(model), 3)
    assert_eq(workflow_review_decision(model), "unverified")
    assert_true(workflow_test_html(model).contains("Reconcile reviews"))
  }
  for
    reviews in [
      [workflow_test_review("approve"), workflow_test_review("reject")],
      [workflow_test_review("reject"), workflow_test_review("approve")],
    ] {
    assert_eq(workflow_stage(workflow_test_built(reviews)), 3)
  }
}

///|
test "submitted and recovered negative reviews replace previous approval without accepting" {
  let approved = workflow_test_built([workflow_test_review("approve")])
  for decision in ["request-changes", "reject"] {
    let review = workflow_test_review(decision, at="2026-10-04T09:00:00.000Z")
    let submitted = workflow_test_update(
      approved,
      ReviewSubmitted(Ok({ reference: "review.json", review, })),
    )
    assert_eq(workflow_stage(submitted), 3)
    let blank = template(initial_model(), "editable-source")
    let run = workflow_test_run(
      blank,
      "execute",
      representations=submitted.representations,
      reviews=submitted.reviews,
    )
    let recovered = workflow_test_update(
      blank,
      RecoveryLoaded(
        Ok({
          recovered: true,
          attempt_id: Some("attempt-test"),
          next_revision: 2,
          next_request_id: "spatial-request-2",
          next_idempotency_key: "spatial-operation-2",
          run: Some(run),
          delivery: None,
          physical_authority: false,
        }),
      ),
    )
    assert_eq(recovered.last_result, Some(run.result))
    assert_eq(workflow_review_decision(recovered), decision)
    assert_eq(workflow_stage(recovered), 3)
    assert_false(
      workflow_test_html(recovered).contains("<strong>Accepted</strong>"),
    )
  }
}

///|
test "validation preserves fresh and existing scene parents before execute and on recovery" {
  for parent in ["mm1-empty-scene", "mm1-existing-scene"] {
    let model = { ..initial_model(), expected_parent_digest: parent, }
    let payload = workflow_test_run(
      model,
      "validate",
      after="sha256:request-bytes",
    )
    let validated = workflow_test_update(model, RunCompleted(Ok(payload)))
    assert_eq(validated.expected_parent_digest, parent)
    assert_eq(workflow_stage(validated), 2)
    assert_eq(workflow_build_action(validated), "Execute request")
    let executed = workflow_test_update(
      validated,
      RunCompleted(
        Ok(workflow_test_run(validated, "execute", after="mm1-new-scene")),
      ),
    )
    assert_eq(executed.expected_parent_digest, "mm1-new-scene")
    let recovered = workflow_test_update(
      initial_model(),
      RecoveryLoaded(
        Ok({
          recovered: true,
          attempt_id: Some("attempt-test"),
          next_revision: 2,
          next_request_id: "spatial-request-2",
          next_idempotency_key: "spatial-operation-2",
          run: Some(payload),
          delivery: None,
          physical_authority: false,
        }),
      ),
    )
    assert_eq(recovered.expected_parent_digest, parent)
    assert_eq(workflow_build_action(recovered), "Execute request")
  }
}

///|
test "rejected or unidentified receipts never advance scene parent or advertise readiness" {
  let model = initial_model()
  for mode in ["validate", "execute", "unknown"] {
    let payload = workflow_test_run(
      model,
      mode,
      outcome="rejected",
      after="sha256:not-a-scene",
    )
    let rejected = workflow_test_update(model, RunCompleted(Ok(payload)))
    assert_eq(rejected.expected_parent_digest, model.expected_parent_digest)
    assert_eq(workflow_stage(rejected), 1)
    let html = workflow_test_html(rejected)
    assert_false(html.contains("Build representation"))
    assert_false(html.contains("Validation is durable"))
  }
  assert_eq(
    next_scene_parent(
      workflow_test_run(model, "unknown"),
      model.expected_parent_digest,
    ),
    model.expected_parent_digest,
  )
  assert_eq(
    next_scene_parent(
      workflow_test_run(model, "execute", outcome="idempotent-no-op"),
      model.expected_parent_digest,
    ),
    "mm1-built",
  )
}

///|
test "building explicitly selects and validates export instead of repeating create model" {
  let blank = initial_model()
  let built = workflow_test_update(
    blank,
    RunCompleted(Ok(workflow_test_run(blank, "execute"))),
  )
  assert_eq(workflow_stage(built), 2)
  assert_eq(workflow_build_action(built), "Choose representation")
  assert_true(
    workflow_test_html(built).contains("href=\"#representation-templates\""),
  )
  let selected = workflow_test_update(built, ApplyTemplate("editable-source"))
  assert_eq(selected.method_name, "representation.export")
  assert_eq(selected.last_receipt, built.last_receipt)
  assert_eq(workflow_build_action(selected), "Validate representation")
  let validated = workflow_test_update(
    selected,
    RunCompleted(
      Ok(workflow_test_run(selected, "validate", after="sha256:export-request")),
    ),
  )
  assert_eq(validated.expected_parent_digest, built.expected_parent_digest)
  assert_eq(workflow_build_action(validated), "Build representation")
  let exported = workflow_test_update(
    validated,
    RunCompleted(
      Ok(
        workflow_test_run(validated, "execute", representations=[
          workflow_test_artifact(validated),
        ]),
      ),
    ),
  )
  assert_eq(workflow_stage(exported), 3)
  assert_true(workflow_test_html(exported).contains("Add reviewer"))
  let edited = workflow_test_update(
    validated,
    SetIntent("A changed request needs its own validation"),
  )
  assert_eq(workflow_build_action(edited), "Validate representation")
}

///|
test "transport errors keep safe recovery and never promote review authority" {
  let model = {
    ..workflow_test_built([workflow_test_review("reject")]),
    error: "recovery-integrity: review receipt mismatch",
  }
  let html = workflow_test_html(model)
  assert_true(html.contains("Stopped safely"))
  assert_true(html.contains("Reconcile"))
  assert_false(html.contains("<strong>Accepted</strong>"))
}

///|
test "next change and semantic edits return to validation while retaining previous evidence" {
  let approved = workflow_test_built([workflow_test_review("approve")])
  for
    msg in [
      ApplyTemplate("model"),
      SetIntent("Revise the accepted design"),
      SetParams("{}"),
      SetProjectId("another-project"),
    ] {
    let changed = workflow_test_update(approved, msg)
    assert_eq(workflow_stage(changed), 1)
    assert_eq(changed.last_receipt, approved.last_receipt)
    assert_eq(changed.reviews, approved.reviews)
    let html = workflow_test_html(changed)
    assert_false(html.contains("<strong>Accepted</strong>"))
    assert_false(html.contains("Start next change"))
    assert_true(html.contains("Previous result"))
    assert_true(html.contains("This draft has changed"))
    assert_true(
      html.contains(
        if changed.method_name == "representation.export" {
          "Validate representation"
        } else {
          "Validate request"
        },
      ),
    )
  }
  let rejected = workflow_test_built([workflow_test_review("request-changes")])
  let revised = workflow_test_update(
    rejected,
    SetIntent("Address the review notes"),
  )
  assert_eq(workflow_stage(revised), 1)
  assert_false(workflow_test_html(revised).contains("Revise request"))
}

///|
test "a late run response does not validate edits made while it was running" {
  let original = initial_model()
  let pending = workflow_test_run(
    original,
    "validate",
    after="sha256:old-request",
  )
  let edited = workflow_test_update(original, SetIntent("An updated intent"))
  let received = workflow_test_update(edited, RunCompleted(Ok(pending)))
  assert_true(received.draft_changed)
  assert_eq(workflow_stage(received), 1)
  assert_eq(received.intent, "An updated intent")
  assert_false(workflow_test_html(received).contains("Validation is durable"))
}

///|
test "late execution and reconciliation keep the chosen parent of another draft" {
  let original = initial_model()
  let pending = workflow_test_run(original, "execute", after="mm1-scene-a")
  for
    edit in [
      SetProjectId("project-b"),
      SetModelId("model-b"),
      SetExpectedParent("mm1-chosen-parent"),
    ] {
    let edited = workflow_test_update(original, edit)
    for completion in [RunCompleted(Ok(pending)), Reconciled(Ok(pending))] {
      let received = workflow_test_update(edited, completion)
      assert_eq(received.expected_parent_digest, edited.expected_parent_digest)
      assert_eq(received.project_id, edited.project_id)
      assert_eq(received.model_id, edited.model_id)
      assert_eq(received.last_receipt, pending.receipt)
      assert_true(received.draft_changed)
      assert_eq(workflow_stage(received), 1)
      assert_true(workflow_test_html(received).contains("Previous result"))
    }
  }
}

///|
test "approved review survives exact recovery and reconciliation preserves decision and scene parent" {
  let blank = template(initial_model(), "editable-source")
  let run = workflow_test_run(
    blank,
    "execute",
    representations=[workflow_test_artifact(blank)],
    reviews=[workflow_test_review("approve")],
  )
  let recovered = workflow_test_update(
    blank,
    RecoveryLoaded(
      Ok({
        recovered: true,
        attempt_id: Some("attempt-test"),
        next_revision: 2,
        next_request_id: "spatial-request-2",
        next_idempotency_key: "spatial-operation-2",
        run: Some(run),
        delivery: None,
        physical_authority: false,
      }),
    ),
  )
  assert_eq(workflow_stage(recovered), 4)
  assert_eq(recovered.expected_parent_digest, "mm1-built")
  let reconciled = workflow_test_update(blank, Reconciled(Ok(run)))
  assert_eq(workflow_stage(reconciled), 4)
  assert_eq(reconciled.expected_parent_digest, "mm1-built")
  let validation = workflow_test_run(
    blank,
    "validate",
    after="sha256:request-bytes",
  )
  let reconciled_validation = workflow_test_update(
    blank,
    Reconciled(Ok(validation)),
  )
  assert_eq(reconciled_validation.expected_parent_digest, "mm1-empty-scene")
}

///|
test "older project representations never complete a later model change" {
  let previous = workflow_test_built([workflow_test_review("approve")])
  let changed = workflow_test_update(previous, ApplyTemplate("box"))
  let executed = workflow_test_update(
    changed,
    RunCompleted(
      Ok(
        workflow_test_run(
          changed,
          "execute",
          after="mm1-new-scene",
          representations=previous.representations,
        ),
      ),
    ),
  )
  assert_eq(workflow_stage(executed), 2)
  assert_false(has_current_representation(executed))
  assert_eq(workflow_build_action(executed), "Choose representation")
  assert_false(workflow_test_html(executed).contains("Add reviewer"))
  let selected = workflow_test_update(
    executed,
    ApplyTemplate("editable-source"),
  )
  assert_false(selected.params_json == previous.params_json)
  assert_true(selected.params_json.contains("editable-source-3.json"))
  let exported = workflow_test_update(
    selected,
    RunCompleted(
      Ok(
        workflow_test_run(
          selected,
          "execute",
          after="mm1-new-scene",
          representations=[
            ..previous.representations,
            workflow_test_artifact(selected, parent="mm1-new-scene"),
          ],
        ),
      ),
    ),
  )
  assert_true(has_current_representation(exported))
  assert_eq(workflow_stage(exported), 3)
}

///|
test "export review requires current lineage and an artifact bound to the result" {
  let model = workflow_test_built([workflow_test_review("approve")])
  for
    representations in [
      [],
      [workflow_test_artifact(model, parent="mm1-old-scene")],
      [{ "representation": "editable-source" }],
    ] {
    let mismatched = { ..model, representations, }
    assert_eq(workflow_stage(mismatched), 2)
    assert_eq(workflow_build_action(mismatched), "Reconcile representation")
    assert_false(
      workflow_test_html(mismatched).contains("<strong>Accepted</strong>"),
    )
  }
  let missing_artifact = {
    ..model,
    last_result: Some({
      "status": "succeeded",
      "attempt_id": "attempt-test",
      "output_digest": "sha256:receipt-test",
      "output_artifacts": [
        ".moonsuite/products/moonmold/adapter-attempts/attempt-test/operation-receipt.json",
      ],
    }),
  }
  assert_eq(workflow_stage(missing_artifact), 2)
  assert_false(has_current_representation(missing_artifact))
}

///|
test "a shared unrelated artifact cannot replace the selected export output" {
  let model = workflow_test_built([workflow_test_review("approve")])
  let mismatched = {
    ..model,
    last_receipt: Some({
      "contract_id": "moonmold.spatial-operation-receipt.v1",
      "attempt_id": "attempt-test",
      "operation_ref": "moonmold/spatial.operation.execute@0.2.0",
      "outcome": "applied",
      "after_digest": "mm1-built",
      "artifacts": ["unrelated.json"],
      "physical_authority": false,
    }),
    last_result: Some({
      "status": "succeeded",
      "attempt_id": "attempt-test",
      "output_digest": "sha256:receipt-test",
      "output_artifacts": [
        ".moonsuite/products/moonmold/adapter-attempts/attempt-test/operation-receipt.json",
        "unrelated.json",
      ],
    }),
  }
  assert_false(has_current_representation(mismatched))
  assert_eq(workflow_stage(mismatched), 2)
  assert_eq(workflow_build_action(mismatched), "Reconcile representation")
  assert_false(
    workflow_test_html(mismatched).contains("<strong>Accepted</strong>"),
  )
}

///|
test "absolute in-workspace export paths match the published relative artifact reference" {
  let model = workflow_test_built([workflow_test_review("approve")])
  guard model.last_spatial_request is Some(Object(fields)) else {
    fail("expected request")
  }
  let request = fields.copy()
  let output = ".moonsuite/products/moonmold/projects/example-project/example-model/representations/editable-source-1.json"
  request["operation"] = {
    "method": "representation.export",
    "params": {
      "representation": "editable-source",
      "outputPath": "/workspace/model/./unused/../" + output,
    },
  }
  let absolute = {
    ..model,
    last_spatial_request: Some(Json::object(request)),
    status: Some({ "workspace_root": "/workspace/model" }),
  }
  assert_true(has_current_representation(absolute))
  assert_eq(workflow_stage(absolute), 4)
  assert_eq(
    representation_output_ref(absolute, "relative/file.json"),
    Some("relative/file.json"),
  )
  assert_eq(
    representation_output_ref(absolute, "/workspace/other/file.json"),
    None,
  )
  assert_eq(
    representation_output_ref(absolute, "/workspace/model/../other/file.json"),
    None,
  )
  assert_false(has_current_representation({ ..absolute, status: None, }))
}
