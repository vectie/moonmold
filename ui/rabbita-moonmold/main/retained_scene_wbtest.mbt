///|
fn retained_test_scene() -> RetainedScene {
  {
    project_id: "example-project",
    model_id: "example-model",
    workspace_parent_digest: "mm1-workspace-other-model",
    journal_digest: "sha256:fixture",
    status: "ready",
    message: "Verified retained primitives",
    preview_data_url: Some("data:image/svg+xml;base64,PHN2Zy8+"),
    objects: [
      {
        "object_id": "box-a",
        "kind": "box",
        "dimensions_mm": { "width": 10, "depth": 20, "height": 30 },
        "translation_mm": { "x": -100, "y": 200, "z": 300 },
        "material_id": "blue",
      },
      {
        "object_id": "cylinder-b",
        "kind": "cylinder",
        "dimensions_mm": { "radius": 15, "height": 45 },
        "sides": 9,
        "translation_mm": { "x": 12, "y": -22, "z": 33 },
        "material_id": null,
      },
      {
        "object_id": "box-a-copy-1",
        "kind": "box",
        "dimensions_mm": { "width": 1, "depth": 2, "height": 3 },
        "translation_mm": { "x": 0, "y": 0, "z": 0 },
        "material_id": null,
      },
    ],
  }
}

///|
fn retained_test_loaded() -> Model {
  let initial = workflow_test_update(initial_model(), RefreshScene)
  workflow_test_update(
    initial,
    SceneLoaded(
      initial.scene_generation,
      initial.project_id,
      initial.model_id,
      Ok(retained_test_scene()),
    ),
  )
}

///|
test "retained selection and refresh preserve unsaved fields while preparation uses snapshot global parent" {
  let loaded = retained_test_loaded()
  let edited = edit_primitive(template(loaded, "box"), "width", "")
  let selected = workflow_test_update(edited, SelectObject("box-a"))
  assert_eq(selected.primitive_editor, edited.primitive_editor)
  assert_eq(selected.params_json, edited.params_json)
  assert_eq(selected.expected_parent_digest, edited.expected_parent_digest)
  let pending = workflow_test_update(selected, RefreshScene)
  let refreshed = workflow_test_update(
    pending,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Ok(retained_test_scene()),
    ),
  )
  assert_eq(refreshed.primitive_editor, edited.primitive_editor)
  assert_eq(refreshed.params_json, edited.params_json)
  assert_eq(refreshed.selected_object, "")
  assert_eq(refreshed.expected_parent_digest, edited.expected_parent_digest)
  let selected = workflow_test_update(refreshed, SelectObject("box-a"))
  let repeated_response = workflow_test_update(
    selected,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Ok(retained_test_scene()),
    ),
  )
  assert_eq(repeated_response.selected_object, "box-a")
  let moved = workflow_test_update(selected, PrepareObject("move"))
  assert_eq(primitive_test_params(moved), {
    "objectId": "box-a",
    "xMm": -100,
    "yMm": 200,
    "zMm": 300,
  })
  assert_eq(moved.expected_parent_digest, "mm1-workspace-other-model")
  assert_eq(moved.request_id, selected.request_id)
  assert_eq(moved.last_receipt, selected.last_receipt)
  assert_false(moved.busy)
  assert_true(moved.draft_changed)
  assert_true(moved.notice.contains("No operation has run"))
}

///|
test "retained replacement and duplicate emit exact supported creates with explicit reset semantics" {
  let selected = workflow_test_update(
    retained_test_loaded(),
    SelectObject("box-a"),
  )
  let replaced = workflow_test_update(selected, PrepareObject("replace"))
  assert_eq(primitive_test_params(replaced), {
    "objectId": "box-a",
    "widthMm": 10,
    "depthMm": 20,
    "heightMm": 30,
  })
  let duplicate = workflow_test_update(selected, PrepareObject("duplicate"))
  assert_eq(primitive_test_params(duplicate), {
    "objectId": "box-a-copy-2",
    "widthMm": 10,
    "depthMm": 20,
    "heightMm": 30,
  })
  assert_true(duplicate.notice.contains("reset position and material"))
  let selected = workflow_test_update(duplicate, SelectObject("cylinder-b"))
  let replaced = workflow_test_update(selected, PrepareObject("replace"))
  assert_eq(primitive_test_params(replaced), {
    "objectId": "cylinder-b",
    "radiusMm": 15,
    "heightMm": 45,
    "sides": 9,
  })
  let html = workflow_test_html(selected)
  assert_true(html.contains("Retained model objects"))
  assert_true(html.contains("radius 15 × H 45 mm · 9 sides"))
  assert_true(html.contains("position (-100, 200, 300) mm · material blue"))
  assert_true(
    html.contains("Prepare replaces unsaved operation fields, never executes"),
  )
}

///|
test "retained model navigation late refresh and failed refresh never display foreign selection" {
  let selected = workflow_test_update(
    retained_test_loaded(),
    SelectObject("box-a"),
  )
  let pending = workflow_test_update(selected, RefreshScene)
  let other = workflow_test_update(pending, SetModelId("another-model"))
  assert_true(current_retained_scene(other) is None)
  assert_eq(other.selected_object, "")
  assert_false(other.scene_loading)
  let late = workflow_test_update(
    other,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Ok(retained_test_scene()),
    ),
  )
  assert_true(late.retained_scene is None)
  let blocked = workflow_test_update(late, PrepareObject("replace"))
  assert_eq(blocked.params_json, late.params_json)
  assert_false(blocked.busy)
  let pending = workflow_test_update(selected, RefreshScene)
  let failed = workflow_test_update(
    pending,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Err("integrity failed"),
    ),
  )
  assert_true(failed.retained_scene is None)
  assert_eq(failed.selected_object, "")
  assert_eq(failed.scene_error, "integrity failed")
  let pending = workflow_test_update(other, RefreshScene)
  let wrong = workflow_test_update(
    pending,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Ok(retained_test_scene()),
    ),
  )
  assert_true(wrong.retained_scene is None)
  assert_true(wrong.scene_error.contains("another model"))
}

///|
test "retained stale preparation does not dispatch busy controls and duplicate refresh are inert" {
  let selected = workflow_test_update(
    retained_test_loaded(),
    SelectObject("box-a"),
  )
  let newer = { ..selected, expected_parent_digest: "mm1-newer", }
  let stale = workflow_test_update(newer, PrepareObject("replace"))
  assert_eq(stale.expected_parent_digest, "mm1-workspace-other-model")
  assert_false(stale.busy)
  assert_true(stale.notice.contains("stale workspace parent is rejected"))
  let busy = { ..selected, busy: true, }
  for msg in [PrepareObject("move"), SelectObject("cylinder-b"), RefreshScene] {
    let unchanged = workflow_test_update(busy, msg)
    assert_eq(unchanged.params_json, busy.params_json)
    assert_eq(unchanged.selected_object, busy.selected_object)
    assert_eq(unchanged.scene_generation, busy.scene_generation)
  }
  let pending = workflow_test_update(selected, RefreshScene)
  let repeated = workflow_test_update(pending, RefreshScene)
  assert_eq(repeated.scene_generation, pending.scene_generation)
  let no_prepare = workflow_test_update(pending, PrepareObject("move"))
  assert_eq(no_prepare.params_json, pending.params_json)
  let no_op = workflow_test_run(newer, "execute", outcome="idempotent-no-op")
  assert_eq(next_scene_parent(no_op, newer.expected_parent_digest), "mm1-newer")
}

///|
test "recovery and saved load clear selections while late startup recovery preserves unsaved draft" {
  let selected = workflow_test_update(
    retained_test_loaded(),
    SelectObject("box-a"),
  )
  let source = template(initial_model(), "cylinder")
  guard spatial_request(source) is Ok(request) else { fail("valid fixture") }
  let loaded = workflow_test_update(
    selected,
    RequestLoaded(Ok({ reference: "saved.json", request, })),
  )
  assert_true(loaded.retained_scene is None)
  assert_eq(loaded.selected_object, "")
  let payload : RecoveryPayload = {
    recovered: true,
    attempt_id: Some("attempt-test"),
    next_revision: 7,
    next_request_id: "spatial-request-7",
    next_idempotency_key: "spatial-operation-7",
    run: Some(workflow_test_run(source, "execute")),
    delivery: None,
    physical_authority: false,
  }
  let recovered = workflow_test_update(selected, RecoveryLoaded(Ok(payload)))
  assert_true(recovered.retained_scene is None)
  let edited = edit_primitive(template(selected, "box"), "width", "")
  let late = workflow_test_update(edited, RecoveryLoaded(Ok(payload)))
  assert_eq(late.primitive_editor, edited.primitive_editor)
  assert_eq(late.params_json, edited.params_json)
  assert_true(late.notice.contains("your draft was preserved"))
  assert_eq(late.request_id, "spatial-request-7")
  let custom = workflow_test_update(edited, SetRequestId("custom-request"))
  let custom = workflow_test_update(custom, RecoveryLoaded(Ok(payload)))
  assert_eq(custom.request_id, "custom-request")
  let denied = workflow_test_update(
    edited,
    RecoveryLoaded(Ok({ ..payload, physical_authority: true, })),
  )
  assert_true(denied.error.contains("digital-only authority"))
  assert_eq(denied.primitive_editor, edited.primitive_editor)
}

///|
test "retained parser rejects unsafe preview invalid primitives and foreign authority" {
  let base : Json = {
    "contract_id": "moonmold.retained-scene.v1",
    "physical_authority": false,
    "dimension_units": "mm",
    "translation_units": "mm",
    "backend": {
      "mode": "deterministic-mock-reference",
      "blender_evidence": false,
    },
    "project_id": "example-project",
    "model_id": "example-model",
    "workspace_parent_digest": "mm1-global",
    "journal_digest": "sha256:fixture",
    "status": "ready",
    "message": "fixture",
    "objects": [],
    "preview_data_url": null,
  }
  match parse_retained_scene(base) {
    Err(error) => fail(error)
    Ok(_) => ()
  }
  guard base is Object(fields) else { fail("fixture") }
  fields["preview_data_url"] = "https://external.invalid/preview.svg"
  assert_true(parse_retained_scene(Json::object(fields)) is Err(_))
  fields["preview_data_url"] = Json::null()
  fields["objects"] = [{ "object_id": "bad", "kind": "boolean" }]
  assert_true(parse_retained_scene(Json::object(fields)) is Err(_))
  fields["objects"] = []
  fields["physical_authority"] = true
  assert_true(parse_retained_scene(Json::object(fields)) is Err(_))
}
