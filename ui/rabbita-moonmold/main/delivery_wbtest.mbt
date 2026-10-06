///|
fn delivery_test_frozen(model : Model) -> Model {
  workflow_test_update(
    model,
    BriefFrozen(
      Ok({
        reference: "briefs/client-demo-1-r1.json",
        digest: "sha256:brief-exact",
        brief: default_delivery_brief(model.project_id, model.model_id),
      }),
    ),
  )
}

///|
fn delivery_test_payload_json() -> Json {
  let names = [
    "editable-source.json", "presentation.obj", "preview.svg", "loss-report.json",
    "change-report.json", "validation.json", "brief.json", "README.txt",
  ]
  {
    "contract_id": "moonmold.operator-delivery.v1",
    "manifest": {
      "contract_id": "moonmold.digital-delivery.v1",
      "package_id": "delivery-test",
      "brief_ref": "briefs/client-demo-1-r1.json",
      "brief_digest": "sha256:brief-exact",
      "attempt_id": "attempt-test",
      "receipt_digest": "sha256:receipt-test",
      "source_digest": "sha256:source-exact",
      "backend": {
        "mode": "deterministic-mock-reference",
        "evidence_class": "fixture-reference-only",
        "blender_evidence": false,
      },
      "files": names.map(name => {
        (
          {
            "name": name,
            "sha256": "sha256:file-exact",
            "bytes": 100,
            "media_type": "text/plain",
          } : Json)
      }),
      "physical_authority": false,
    },
    "manifest_digest": "sha256:manifest-exact",
    "download_url": "/api/delivery/delivery-test/bundle",
    "files": names.map(name => {
      (
        { "name": name, "url": "/api/delivery/delivery-test/files/" + name } :
        Json)
    }),
    "review_status": "pending",
    "reviews": [],
    "stale": false,
  }
}

///|
fn delivery_test_payload() -> DeliveryPayload {
  match parse_delivery_payload(delivery_test_payload_json()) {
    Ok(delivery) => delivery
    Err(error) => abort(error)
  }
}

///|
fn delivery_test_exported() -> Model {
  let model = template(delivery_test_frozen(initial_model()), "presentation")
  workflow_test_update(
    model,
    RunCompleted(Ok(workflow_test_run(model, "execute"))),
  )
}

///|
test "brief draft uses current identity and freezes without executing or erasing references" {
  let model = {
    ..initial_model(),
    project_id: "project-new",
    model_id: "model-new",
  }
  assert_true(delivery_brief_body(model) is Err(_))
  let prepared = workflow_test_update(model, PrepareBrief)
  guard delivery_brief_body(prepared) is Ok(body) else {
    fail("expected brief body")
  }
  guard body
    is {
      "brief": {
        "project_id": String("project-new"),
        "model_id": String("model-new"),
        "physical_authority": False,
        ..
      },
      ..
    } else {
    fail("wrong brief identity")
  }
  let frozen = delivery_test_frozen(prepared)
  assert_eq(frozen.last_flow_request, None)
  assert_eq(frozen.last_receipt, None)
  assert_eq(frozen.method_name, "scene.create-model")
  assert_true(frozen.draft_changed)
  let refs = delivery_references(frozen)
  assert_true(refs.contains("references/approved-spatial-brief.json"))
  assert_true(refs.contains("briefs/client-demo-1-r1.json"))
  let edited_refs = workflow_test_update(
    frozen,
    SetReferences("another-reference.json"),
  )
  assert_eq(delivery_references(edited_refs), [
    "another-reference.json", "briefs/client-demo-1-r1.json",
  ])
  let edited_brief = workflow_test_update(frozen, SetBrief("{}"))
  assert_eq(
    edited_brief.frozen_brief.map(brief => brief.digest),
    Some("sha256:brief-exact"),
  )
  assert_true(delivery_brief_body(edited_brief) is Err(_))
}

///|
test "delivery builds only a real successful brief-bound presentation export" {
  let frozen = delivery_test_frozen(initial_model())
  assert_true(delivery_build_body(frozen) is Err(_))
  for
    representation in [
      "model", "box", "editable-source", "engineering", "presentation",
    ] {
    let selected = template(frozen, representation)
    for mode in ["validate", "execute"] {
      let run = workflow_test_run(selected, mode)
      let target = delivery_export_target(selected, run)
      assert_eq(
        target is Some(_),
        representation == "presentation" && mode == "execute",
      )
    }
  }
  let unbound = template(initial_model(), "presentation")
  assert_eq(
    delivery_export_target(frozen, workflow_test_run(unbound, "execute")),
    None,
  )
  let exported = delivery_test_exported()
  assert_eq(
    delivery_build_body(exported),
    Ok({
      "attempt_id": "attempt-test",
      "brief_ref": "briefs/client-demo-1-r1.json",
    }),
  )
  let changed = workflow_test_update(exported, ApplyTemplate("box"))
  let validated = workflow_test_update(
    changed,
    RunCompleted(Ok(workflow_test_run(changed, "validate"))),
  )
  assert_eq(validated.delivery_export, exported.delivery_export)
  let failed = workflow_test_update(
    changed,
    RunCompleted(Ok(workflow_test_run(changed, "execute", outcome="rejected"))),
  )
  assert_eq(failed.delivery_export, exported.delivery_export)
}

///|
test "package review targets selected package and manifest even after another attempt" {
  let model = {
    ..delivery_test_exported(),
    delivery: Some(delivery_test_payload()),
    last_flow_request: Some({ "attempt_id": "attempt-new-draft" }),
    reviewer: "Named reviewer",
    decision: "request-changes",
    review_notes: "Inspect exact dimensions",
  }
  assert_eq(
    delivery_review_body(model),
    Ok({
      "attempt_id": "attempt-test",
      "delivery_id": "delivery-test",
      "delivery_digest": "sha256:manifest-exact",
      "reviewer": "Named reviewer",
      "decision": "request-changes",
      "notes": "Inspect exact dimensions",
    }),
  )
  assert_true(delivery_is_historical(model, delivery_test_payload()))
  let submitted = workflow_test_update(
    model,
    DeliveryReviewSubmitted(
      "delivery-test",
      "sha256:manifest-exact",
      Ok({ reference: "review.json", review: workflow_test_review("approve"), }),
    ),
  )
  assert_true(submitted.busy)
  assert_eq(
    submitted.delivery.map(value => value.review_status),
    Some("pending"),
  )
  assert_eq(submitted.reviews, model.reviews)
}

///|
test "delivery SSR shows exact bindings mock limits and all native downloads" {
  let model = {
    ..delivery_test_exported(),
    delivery: Some(delivery_test_payload()),
  }
  let html = workflow_test_html(model)
  for
    text in [
      "Freeze brief", "before Create model and Add box", "Build delivery from export",
      "DETERMINISTIC MOCK REFERENCE", "FIXTURE EVIDENCE ONLY", "NOT BLENDER EVIDENCE",
      "sha256:manifest-exact", "sha256:brief-exact", "sha256:file-exact", "Package review: pending",
      "not human approval", "Download portable JSON bundle", "JSON, not a ZIP archive",
      "Review this exact package",
    ] {
    assert_true(html.contains(text))
  }
  assert_true(html.contains("href=\"/api/delivery/delivery-test/bundle\""))
  assert_true(html.contains("download=\"delivery-test.json\""))
  for file in delivery_test_payload().files {
    assert_true(html.contains("href=\"" + file.url + "\""))
    assert_true(html.contains("download=\"" + file.name + "\""))
  }
  assert_false(html.contains("Historical package"))
}

///|
test "package errors and draft edits retain downloads and never approve the new draft" {
  let model = {
    ..delivery_test_exported(),
    delivery: Some(delivery_test_payload()),
  }
  for
    msg in [
      SetIntent("Changed design"),
      SetProjectId("new-project"),
      SetParams("{}"),
      SetBrief("{}"),
      ApplyTemplate("box"),
    ] {
    let changed = workflow_test_update(model, msg)
    assert_eq(
      changed.delivery.map(value => value.manifest_digest),
      Some("sha256:manifest-exact"),
    )
    let html = workflow_test_html(changed)
    assert_true(html.contains("Historical package · original revision only"))
    assert_true(
      html.contains("current draft has no inherited package approval"),
    )
    assert_true(html.contains("href=\"/api/delivery/delivery-test/bundle\""))
    assert_false(html.contains("<strong>Accepted</strong>"))
  }
  for
    msg in [
      DeliveryLoaded(Err("package build failed")),
      BriefFrozen(Err("brief failed")),
      DeliveryReviewSubmitted(
        "delivery-test",
        "sha256:manifest-exact",
        Err("review failed"),
      ),
      RecoveryLoaded(Err("recovery failed")),
      RunCompleted(Err("run failed")),
    ] {
    let failed = workflow_test_update(model, msg)
    assert_false(failed.busy)
    assert_false(failed.error.is_empty())
    assert_eq(
      failed.delivery.map(value => value.manifest_digest),
      Some("sha256:manifest-exact"),
    )
    assert_eq(failed.delivery_export, model.delivery_export)
    assert_true(
      workflow_test_html(failed).contains(
        "href=\"/api/delivery/delivery-test/bundle\"",
      ),
    )
  }
  let stale = { ..delivery_test_payload(), stale: Some(true), }
  assert_true(delivery_is_historical(model, stale))
}

///|
test "recovery accepts old responses and restores delivery digest and frozen reference" {
  let old : Json = {
    "recovered": false,
    "attempt_id": null,
    "next_revision": 1,
    "next_request_id": "spatial-request-1",
    "next_idempotency_key": "spatial-operation-1",
    "run": null,
    "physical_authority": false,
  }
  let old_payload = match parse_recovery_payload(old) {
    Ok(value) => value
    Err(error) => fail(error)
  }
  assert_true(old_payload.delivery is None)
  guard old is Object(fields) else { fail("expected object") }
  let with_delivery = fields.copy()
  with_delivery["delivery"] = delivery_test_payload_json()
  guard parse_recovery_payload(Json::object(with_delivery)) is Ok(payload) else {
    fail("expected new recovery")
  }
  let recovered = workflow_test_update(
    initial_model(),
    RecoveryLoaded(Ok(payload)),
  )
  assert_eq(
    recovered.delivery.map(value => value.manifest_digest),
    Some("sha256:manifest-exact"),
  )
  assert_eq(
    recovered.frozen_brief.map(value => value.reference),
    Some("briefs/client-demo-1-r1.json"),
  )
  assert_true(
    delivery_references(recovered).contains("briefs/client-demo-1-r1.json"),
  )
  assert_true(workflow_test_html(recovered).contains("Recovered binding only"))
  assert_true(workflow_test_html(recovered).contains("Historical package"))
  let frozen = template(delivery_test_frozen(initial_model()), "presentation")
  let run = workflow_test_run(frozen, "execute")
  let exact = workflow_test_update(
    initial_model(),
    RecoveryLoaded(
      Ok({
        ..payload,
        recovered: true,
        attempt_id: Some("attempt-test"),
        run: Some(run),
      }),
    ),
  )
  assert_eq(exact.last_receipt, run.receipt)
  assert_eq(exact.last_flow_request, Some(run.flow_request))
  assert_false(delivery_is_historical(exact, delivery_test_payload()))
  assert_eq(
    delivery_build_body(exact),
    Ok({
      "attempt_id": "attempt-test",
      "brief_ref": "briefs/client-demo-1-r1.json",
    }),
  )
}

///|
test "a new frozen brief cannot reuse an export bound to the old brief" {
  let model = {
    ..delivery_test_exported(),
    delivery: Some(delivery_test_payload()),
  }
  let revised = workflow_test_update(
    model,
    BriefFrozen(
      Ok({
        reference: "briefs/client-demo-1-r2.json",
        digest: "sha256:brief-revision-two",
        brief: default_delivery_brief(model.project_id, model.model_id),
      }),
    ),
  )
  assert_true(delivery_build_body(revised) is Err(_))
  assert_eq(revised.delivery_export, model.delivery_export)
  assert_eq(
    revised.delivery.map(value => value.manifest_digest),
    Some("sha256:manifest-exact"),
  )
  assert_true(workflow_test_html(revised).contains("Historical package"))
}

///|
test "delivery parser preserves governed denial and rejects authority widening" {
  assert_eq(
    parse_delivery_payload({
      "code": "unsupported-shape",
      "message": "Boxes only",
    }).map(value => value.manifest_digest),
    Err("unsupported-shape: Boxes only"),
  )
  guard delivery_test_payload_json() is Object(fields) else {
    fail("expected delivery")
  }
  let invalid = fields.copy()
  invalid["manifest"] = { "physical_authority": true }
  assert_true(parse_delivery_payload(Json::object(invalid)) is Err(_))
}

///|
test "a new no-op export cannot replace the retained applied delivery target" {
  let exported = delivery_test_exported()
  let selected = template(exported, "presentation")
  let no_op = workflow_test_run(selected, "execute", outcome="idempotent-no-op")
  guard no_op.receipt is Some(Object(receipt_fields)) &&
    no_op.result is Object(result_fields) else {
    fail("expected execution fixture")
  }
  let receipt = receipt_fields.copy()
  receipt["attempt_id"] = "attempt-new-no-op"
  let result = result_fields.copy()
  result["attempt_id"] = "attempt-new-no-op"
  result["output_digest"] = "sha256:no-op-receipt"
  let new_no_op = {
    ..no_op,
    flow_request: {
      "attempt_id": "attempt-new-no-op",
      "operation": "spatial.operation.execute",
    },
    receipt: Some(Json::object(receipt)),
    result: Json::object(result),
  }
  assert_eq(delivery_export_target(selected, new_no_op), None)
  for completion in [RunCompleted(Ok(new_no_op)), Reconciled(Ok(new_no_op))] {
    let received = workflow_test_update(selected, completion)
    assert_eq(received.delivery_export, exported.delivery_export)
    assert_eq(delivery_build_body(received), delivery_build_body(exported))
    assert_eq(
      flow_attempt_id(received.last_flow_request),
      Some("attempt-new-no-op"),
    )
  }
  let retry = workflow_test_run(selected, "execute", outcome="applied")
  assert_eq(delivery_export_target(selected, retry), exported.delivery_export)
}
