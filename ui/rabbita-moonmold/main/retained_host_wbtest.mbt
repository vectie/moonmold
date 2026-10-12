///|
extern "js" fn retained_host_fixture() -> String =
  #| () => process.env.MOONMOLD_RETAINED_HOST_FIXTURE || ""

///|
test "actual native retained snapshot hydrates selected move replacement and duplicate drafts" {
  let text = retained_host_fixture()
  if text.is_empty() {
    println("MOONMOLD_RETAINED_HOST_BRIDGE=not-run-without-host-fixture")
    return
  }
  let fixture = @json.parse(text)
  guard fixture
    is {
      "scene": scene_json,
      "replayed": replayed_json,
      "replacement": replacement_json,
      "unsupported": unsupported_json,
      ..
    } else {
    fail("Expected native snapshots")
  }
  let scene = parse_retained_scene(scene_json).unwrap()
  let replayed = parse_retained_scene(replayed_json).unwrap()
  assert_eq(scene.objects, replayed.objects)
  assert_eq(scene.workspace_parent_digest, replayed.workspace_parent_digest)
  let model = {
    ..initial_model(),
    project_id: scene.project_id,
    model_id: scene.model_id,
    retained_scene: Some(scene),
    selected_object: "shared",
  }
  let moved = workflow_test_update(model, PrepareObject("move"))
  assert_eq(primitive_test_params(moved), {
    "objectId": "shared",
    "xMm": -12,
    "yMm": 22,
    "zMm": 33,
  })
  assert_eq(moved.expected_parent_digest, scene.workspace_parent_digest)
  assert_false(moved.busy)
  let duplicated = workflow_test_update(model, PrepareObject("duplicate"))
  assert_eq(primitive_test_params(duplicated), {
    "objectId": "shared-copy-1",
    "widthMm": 10,
    "depthMm": 20,
    "heightMm": 30,
  })
  let replacement = parse_retained_scene(replacement_json).unwrap()
  let model = { ..model, retained_scene: Some(replacement), }
  let replaced = workflow_test_update(model, PrepareObject("replace"))
  assert_eq(primitive_test_params(replaced), {
    "objectId": "shared",
    "radiusMm": 5,
    "heightMm": 25,
    "sides": 9,
  })
  let unsupported = parse_retained_scene(unsupported_json).unwrap()
  assert_eq(unsupported.status, "unsupported")
  assert_true(unsupported.objects.is_empty())
  assert_true(
    workflow_test_html(model).contains("radius 5 × H 25 mm · 9 sides"),
  )
  println("MOONMOLD_RETAINED_HOST_BRIDGE=PASS")
}
