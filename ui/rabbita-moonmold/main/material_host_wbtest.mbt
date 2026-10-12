///|
extern "js" fn material_host_fixture() -> String =
  #| () => process.env.MOONMOLD_MATERIAL_HOST_FIXTURE || ""

///|
test "actual native material assignments hydrate compiled retained UI recovery and exact editable source" {
  let text = material_host_fixture()
  if text.is_empty() {
    println("MOONMOLD_MATERIAL_HOST_BRIDGE=not-run-without-host-fixture")
    return
  }
  let fixture = @json.parse(text)
  guard fixture
    is {
      "scene": scene_json,
      "globalScene": global_json,
      "recovery": recovery_json,
      "replacement": replacement_json,
      "source": {
        "model": { "objects": source_objects, .. },
        "operations": Array(operations),
        ..
      },
      ..
    } else {
    fail("Expected actual native material fixture")
  }
  let scene = parse_retained_scene(scene_json).unwrap()
  let global_scene = parse_retained_scene(global_json).unwrap()
  assert_eq(scene.objects, global_scene.objects)
  assert_true(
    scene.workspace_parent_digest != global_scene.workspace_parent_digest,
  )
  assert_eq(scene.objects.to_json(), source_objects)
  let model = {
    ..initial_model(),
    project_id: scene.project_id,
    model_id: scene.model_id,
    retained_scene: Some(global_scene),
    selected_object: "primary-mass",
  }
  let box = workflow_test_update(model, PrepareObject("material"))
  assert_eq(primitive_test_params(box), {
    "objectId": "primary-mass",
    "materialId": "label-A_2:west.v1",
  })
  assert_eq(box.expected_parent_digest, global_scene.workspace_parent_digest)
  let cylinder = workflow_test_update(
    workflow_test_update(model, SelectObject("cylinder-b")),
    PrepareObject("material"),
  )
  assert_eq(primitive_test_params(cylinder), {
    "objectId": "cylinder-b",
    "materialId": "reference-cylinder",
  })
  assert_false(cylinder.busy)
  for draft in [box, cylinder] {
    guard spatial_request(draft) is Ok({ "operation": operation, .. }) else {
      fail("valid material draft")
    }
    assert_true(operations.contains(operation))
  }
  let html = workflow_test_html(box)
  assert_true(
    html.contains("position (-12, 22, 33) mm · material label-A_2:west.v1"),
  )
  assert_true(html.contains("material reference-cylinder"))
  assert_true(html.contains("value=\"label-A_2:west.v1\""))
  let recovered = workflow_test_update(
    initial_model(),
    RecoveryLoaded(parse_recovery_payload(recovery_json)),
  )
  assert_eq(recovered.primitive_editor, cylinder.primitive_editor)
  assert_true(recovered.error.is_empty())
  let replacement = parse_retained_scene(replacement_json).unwrap()
  let reset = workflow_test_update(
    { ..model, retained_scene: Some(replacement), },
    PrepareObject("material"),
  )
  assert_eq(reset.primitive_editor.unwrap().material_id, "")
  assert_true(spatial_request(reset) is Err(_))
  assert_true(workflow_test_html(reset).contains("material none"))
  println("MOONMOLD_MATERIAL_HOST_BRIDGE=PASS")
  println("MOONMOLD_MATERIAL_RENDER=" + html)
}
