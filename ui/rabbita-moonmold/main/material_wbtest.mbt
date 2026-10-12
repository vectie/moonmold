///|
fn material_test_draft(id : String, material : String) -> Model {
  let selected = workflow_test_update(retained_test_loaded(), SelectObject(id))
  edit_primitive(
    workflow_test_update(selected, PrepareObject("material")),
    "materialId",
    material,
  )
}

///|
test "material preparation retains exact identity global parent and explicit execution boundary" {
  let dirty = edit_primitive(
    template(retained_test_loaded(), "box"),
    "width",
    "",
  )
  let selected = workflow_test_update(dirty, SelectObject("box-a"))
  assert_eq(selected.primitive_editor, dirty.primitive_editor)
  let prepared = workflow_test_update(selected, PrepareObject("material"))
  assert_eq(prepared.method_name, "scene.assign-material")
  assert_eq(primitive_test_params(prepared), {
    "objectId": "box-a",
    "materialId": "blue",
  })
  assert_eq(prepared.expected_parent_digest, "mm1-workspace-other-model")
  assert_eq(prepared.request_id, dirty.request_id)
  assert_eq(prepared.last_receipt, dirty.last_receipt)
  assert_false(prepared.busy)
  assert_true(prepared.last_flow_request is None)
  assert_true(prepared.draft_changed)
  assert_true(prepared.notice.contains("No operation has run"))
  let changed = edit_primitive(prepared, "materialId", "label-A_2:west.v1")
  let reselection = workflow_test_update(changed, SelectObject("cylinder-b"))
  assert_eq(reselection.primitive_editor, changed.primitive_editor)
  assert_eq(primitive_test_params(reselection), {
    "objectId": "box-a",
    "materialId": "label-A_2:west.v1",
  })
  let html = workflow_test_html(changed)
  assert_true(html.contains("Prepare material assignment"))
  assert_true(html.contains("Material ID (semantic identity only)"))
  assert_true(
    html.contains("no material properties or manufacturing suitability"),
  )
  assert_false(html.contains("X position (mm)"))
  assert_false(html.contains("Width (mm)"))
}

///|
test "unassigned and malformed material IDs stay visible but cannot save validate or execute" {
  let selected = workflow_test_update(
    retained_test_loaded(),
    SelectObject("cylinder-b"),
  )
  let prepared = workflow_test_update(selected, PrepareObject("material"))
  assert_eq(prepared.primitive_editor.unwrap().material_id, "")
  assert_true(spatial_request(prepared) is Err(_))
  for
    bad in [
      "",
      " leading",
      "trailing ",
      "two words",
      "../bad",
      "-bad",
      "a/b",
      "a\\b",
      "a\nb",
      "é",
      "a<script>",
      "a".repeat(129),
    ] {
    let draft = edit_primitive(
      material_test_draft("cylinder-b", "reference-b"),
      "materialId",
      bad,
    )
    assert_eq(draft.primitive_editor.unwrap().material_id, bad)
    assert_true(spatial_request(draft) is Err(_), msg=bad)
    for action in [SaveRequest, ValidateRequest, ExecuteRequest] {
      let stopped = workflow_test_update(draft, action)
      assert_false(stopped.busy)
      assert_true(stopped.last_flow_request is None)
      assert_eq(stopped.primitive_editor, draft.primitive_editor)
    }
  }
  for good in ["x", "A.0_:z-9", "a".repeat(128)] {
    assert_eq(
      primitive_test_params(edit_primitive(prepared, "materialId", good)),
      { "objectId": "cylinder-b", "materialId": good },
    )
  }
}

///|
test "material saved reload native recovery and copy hydrate exact schemas only" {
  let source = material_test_draft("box-a", "label-A_2:west.v1")
  let request = spatial_request(source).unwrap()
  let loaded = workflow_test_update(
    initial_model(),
    RequestLoaded(Ok({ reference: "saved.json", request, })),
  )
  assert_eq(loaded.primitive_editor, source.primitive_editor)
  assert_true(loaded.retained_scene is None)
  assert_eq(loaded.selected_object, "")
  let payload : RecoveryPayload = {
    recovered: true,
    attempt_id: Some("material-attempt"),
    next_revision: 7,
    next_request_id: "spatial-request-7",
    next_idempotency_key: "spatial-operation-7",
    run: Some(workflow_test_run(source, "execute")),
    delivery: None,
    physical_authority: false,
  }
  let recovered = workflow_test_update(
    initial_model(),
    RecoveryLoaded(Ok(payload)),
  )
  assert_eq(recovered.primitive_editor, source.primitive_editor)
  assert_eq(recovered.expected_parent_digest, "mm1-built")
  assert_eq(last_primitive(recovered), source.primitive_editor)
  let dirty = edit_primitive(source, "materialId", "")
  let late = workflow_test_update(dirty, RecoveryLoaded(Ok(payload)))
  assert_eq(late.primitive_editor, dirty.primitive_editor)
  assert_eq(late.params_json, dirty.params_json)
  assert_true(late.notice.contains("your draft was preserved"))
  let invalid : Array[Json] = [
    { "objectId": "box-a", "materialId": "blue", "density": 12 },
    { "objectId": "box-a", "materialId": "" },
    { "objectId": "box-a", "materialId": 7 },
  ]
  for params in invalid {
    assert_true(
      primitive_from_operation("scene.assign-material", params) is None,
    )
  }
}

///|
test "material model navigation late scene refresh busy preparation and missing selection refuse safely" {
  let source = material_test_draft("box-a", "blue")
  let pending = workflow_test_update(source, RefreshScene)
  assert_eq(
    workflow_test_update(pending, PrepareObject("material")).params_json,
    source.params_json,
  )
  let other = workflow_test_update(pending, SetModelId("another-model"))
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
  assert_eq(
    workflow_test_update(late, PrepareObject("material")).params_json,
    late.params_json,
  )
  let busy = { ..source, busy: true, }
  assert_eq(
    workflow_test_update(busy, PrepareObject("material")).primitive_editor,
    source.primitive_editor,
  )
  let missing = workflow_test_update(source, SelectObject("missing"))
  let refused = workflow_test_update(missing, PrepareObject("material"))
  assert_eq(refused.primitive_editor, source.primitive_editor)
  assert_true(refused.error.contains("select a supported retained object"))
  let refreshed = workflow_test_update(
    pending,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Ok(retained_test_scene()),
    ),
  )
  assert_eq(refreshed.primitive_editor, source.primitive_editor)
  assert_eq(refreshed.selected_object, "")
  let repeated = workflow_test_update(
    refreshed,
    SceneLoaded(
      pending.scene_generation,
      pending.project_id,
      pending.model_id,
      Ok(retained_test_scene()),
    ),
  )
  assert_eq(repeated.primitive_editor, source.primitive_editor)
}

///|
test "compiled typed material operations match the native host fixture" {
  let operations : Array[Json] = []
  for
    (id, material) in [
      ("box-a", "label-A_2:west.v1"),
      ("cylinder-b", "reference-cylinder"),
    ] {
    let source = material_test_draft(id, material)
    let source = if id == "box-a" {
      edit_primitive(source, "objectId", "primary-mass")
    } else {
      source
    }
    guard spatial_request(source) is Ok({ "operation": operation, .. }) else {
      fail("valid assignment")
    }
    operations.push(operation)
  }
  println(
    "MOONMOLD_TYPED_MATERIAL_OPERATIONS=" + operations.to_json().stringify(),
  )
}
