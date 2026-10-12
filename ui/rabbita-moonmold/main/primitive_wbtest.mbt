///|
fn primitive_test_params(model : Model) -> Json {
  guard spatial_request(model)
    is Ok({ "operation": { "params": params, .. }, .. }) else {
    abort("Expected valid operation")
  }
  params
}

///|
test "typed box cylinder and absolute move produce only exact semantic fields" {
  let box = template(initial_model(), "box")
  let box = edit_primitive(box, "objectId", "box-A_2:west")
  let box = edit_primitive(box, "width", "1500")
  assert_eq(primitive_test_params(box), {
    "objectId": "box-A_2:west",
    "widthMm": 1500,
    "depthMm": 800,
    "heightMm": 600,
  })
  let cylinder = template(box, "cylinder")
  let cylinder = edit_primitive(cylinder, "objectId", "support-2")
  let cylinder = edit_primitive(cylinder, "radius", "350")
  let cylinder = edit_primitive(cylinder, "height", "1600")
  let cylinder = edit_primitive(cylinder, "sides", "16")
  assert_eq(primitive_test_params(cylinder), {
    "objectId": "support-2",
    "radiusMm": 350,
    "heightMm": 1600,
    "sides": 16,
  })
  let moved = template(cylinder, "move")
  let moved = edit_primitive(moved, "x", "-450")
  let moved = edit_primitive(moved, "y", "200")
  let moved = edit_primitive(moved, "z", "800")
  assert_eq(primitive_test_params(moved), {
    "objectId": "support-2",
    "xMm": -450,
    "yMm": 200,
    "zMm": 800,
  })
  assert_eq(
    primitive_test_params(edit_primitive(moved, "x", "-450")),
    primitive_test_params(moved),
  )
  assert_true(moved.draft_changed)
}

///|
test "typed units do not reinterpret millimetre object inputs" {
  for units in ["mm", "cm", "m"] {
    let model = edit_primitive(initial_model(), "units", units)
    assert_eq(primitive_test_params(model), {
      "name": "example-model",
      "units": units,
      "coordinateFrame": "z-up-right-handed",
    })
    assert_eq(primitive_test_params(template(model, "box")), {
      "objectId": "primary-mass",
      "widthMm": 1200,
      "depthMm": 800,
      "heightMm": 600,
    })
    let html = workflow_test_html(model)
    assert_true(
      html.contains(
        "Object dimensions and positions below are always entered in mm",
      ),
    )
    assert_true(html.contains("value=\"" + units + "\" selected"))
  }
  assert_true(
    spatial_request(edit_primitive(initial_model(), "units", "inch")) is Err(_),
  )
}

///|
test "typed incomplete malformed and overflow values retain input but send no request" {
  for
    (kind, name, bad) in [
      ("box", "width", ""),
      ("box", "depth", "0"),
      ("box", "height", "-1"),
      ("box", "width", "1.5"),
      ("box", "width", "1e3"),
      ("box", "width", "0x10"),
      ("box", "width", "NaN"),
      ("box", "width", "Infinity"),
      ("box", "width", "2147483648"),
      ("box", "objectId", "bad id"),
      ("box", "objectId", "../bad"),
      ("box", "objectId", ""),
      ("cylinder", "radius", "0"),
      ("cylinder", "height", "-600"),
      ("cylinder", "sides", "7"),
      ("cylinder", "sides", "257"),
      ("cylinder", "sides", "8.5"),
      ("move", "x", "-"),
      ("move", "y", "-2147483649"),
      ("move", "z", "2147483648"),
    ] {
    let initial = template(initial_model(), kind)
    let edited = workflow_test_update(initial, SetPrimitiveField(name, bad))
    assert_true(
      spatial_request(edited) is Err(_),
      msg=kind + "/" + name + "/" + bad,
    )
    assert_eq(edited.params_json, initial.params_json)
    assert_true(edited.primitive_editor != initial.primitive_editor)
    for action in [SaveRequest, ValidateRequest, ExecuteRequest] {
      let blocked = workflow_test_update(edited, action)
      assert_false(blocked.busy)
      assert_true(!blocked.error.is_empty())
      assert_eq(blocked.primitive_editor, edited.primitive_editor)
      assert_true(blocked.last_flow_request is None)
    }
    assert_true(workflow_test_html(edited).contains("Complete object fields"))
  }
}

///|
test "typed native integer boundaries and cylinder tessellation limits are inclusive" {
  for
    (kind, name, good) in [
      ("box", "width", "1"),
      ("box", "width", "2147483647"),
      ("cylinder", "radius", "2147483647"),
      ("cylinder", "sides", "8"),
      ("cylinder", "sides", "256"),
      ("move", "x", "-2147483648"),
      ("move", "y", "2147483647"),
      ("move", "z", "0"),
    ] {
    let model = edit_primitive(template(initial_model(), kind), name, good)
    assert_true(
      spatial_request(model) is Ok(_),
      msg=kind + "/" + name + "/" + good,
    )
  }
  let corrected = edit_primitive(
    edit_primitive(template(initial_model(), "box"), "width", ""),
    "width",
    "250",
  )
  assert_eq(corrected.error, "")
  assert_eq(primitive_test_params(corrected), {
    "objectId": "primary-mass",
    "widthMm": 250,
    "depthMm": 800,
    "heightMm": 600,
  })
}

///|
test "known saved and recovered operations hydrate exact fields and next identities" {
  for kind in ["model", "box", "cylinder", "move"] {
    let source = template(initial_model(), kind)
    let source = if kind == "move" {
      edit_primitive(source, "x", "-250")
    } else {
      source
    }
    guard spatial_request(source) is Ok(request) else { fail("valid draft") }
    let loaded = workflow_test_update(
      initial_model(),
      RequestLoaded(Ok({ reference: "saved.json", request, })),
    )
    assert_eq(loaded.primitive_editor, source.primitive_editor)
    assert_eq(primitive_test_params(loaded), primitive_test_params(source))
    let recovered = workflow_test_update(
      initial_model(),
      RecoveryLoaded(
        Ok({
          recovered: true,
          attempt_id: Some("attempt-test"),
          next_revision: 7,
          next_request_id: "spatial-request-7",
          next_idempotency_key: "spatial-operation-7",
          run: Some(workflow_test_run(source, "execute")),
          delivery: None,
          physical_authority: false,
        }),
      ),
    )
    assert_eq(recovered.primitive_editor, source.primitive_editor)
    assert_eq(recovered.request_id, "spatial-request-7")
    assert_eq(recovered.expected_parent_digest, "mm1-built")
    assert_false(recovered.draft_changed)
  }
}

///|
test "advanced parameters preserve unknown keys methods and frames without typed coercion" {
  let initial = template(initial_model(), "box")
  for
    text in [
      " { \"objectId\" : \"box\", \"widthMm\":1, \"depthMm\":2, \"heightMm\":3, \"future\":{\"keep\":[true,4]} } ",
      "{\"objectId\":\"box\",\"widthMm\":1.5,\"depthMm\":2,\"heightMm\":3}",
    ] {
    let advanced = workflow_test_update(initial, SetParams(text))
    assert_true(advanced.primitive_editor is None)
    assert_eq(advanced.params_json, text)
    let request = match spatial_request(advanced) {
      Ok(value) => value
      Err(error) => fail(error)
    }
    let loaded = match request_from_json(initial, request) {
      Ok(value) => value
      Err(error) => fail(error)
    }
    assert_true(loaded.primitive_editor is None)
    assert_eq(primitive_test_params(loaded), @json.parse(text))
    let recovered = workflow_test_update(
      initial_model(),
      RecoveryLoaded(
        Ok({
          recovered: true,
          attempt_id: Some("attempt-test"),
          next_revision: 2,
          next_request_id: "spatial-request-2",
          next_idempotency_key: "spatial-operation-2",
          run: Some(workflow_test_run(advanced, "validate")),
          delivery: None,
          physical_authority: false,
        }),
      ),
    )
    assert_true(recovered.primitive_editor is None)
    assert_eq(primitive_test_params(recovered), @json.parse(text))
  }
  let changed = workflow_test_update(
    initial,
    SetMethod("scene.future-operation"),
  )
  assert_true(changed.primitive_editor is None)
  assert_eq(changed.params_json, initial.params_json)
  let changed = workflow_test_update(
    changed,
    SetParams("{\"retain\": [1,2,3]}"),
  )
  assert_eq(changed.params_json, "{\"retain\": [1,2,3]}")
  let frame = workflow_test_update(
    initial_model(),
    SetParams(
      "{\"name\":\"other\",\"units\":\"mm\",\"coordinateFrame\":\"y-up-right-handed\"}",
    ),
  )
  assert_true(frame.primitive_editor is None)
  for value in ["2147483648", "-2147483649", "1.9"] {
    let raw = "{\"objectId\":\"box\",\"widthMm\":" +
      value +
      ",\"depthMm\":2,\"heightMm\":3}"
    let out_of_range = workflow_test_update(initial, SetParams(raw))
    assert_true(out_of_range.primitive_editor is None)
    assert_eq(out_of_range.params_json, raw)
  }
}

///|
test "method changes never reinterpret stale box fields as a cylinder" {
  let box = template(initial_model(), "box")
  let changed = workflow_test_update(box, SetMethod("scene.create-cylinder"))
  assert_true(changed.primitive_editor is None)
  assert_eq(changed.params_json, box.params_json)
  let typed = workflow_test_update(
    changed,
    SetParams(
      "{\"objectId\":\"cyl\",\"radiusMm\":10,\"heightMm\":20,\"sides\":8}",
    ),
  )
  guard typed.primitive_editor is Some(editor) else {
    fail("exact cylinder should hydrate")
  }
  assert_eq(editor.radius, "10")
  assert_eq(editor.object_id, "cyl")
  let switched = workflow_test_update(typed, ApplyTemplate("presentation"))
  assert_true(switched.primitive_editor is None)
  assert_eq(switched.method_name, "representation.export")
}

///|
test "busy typed controls and repeated dispatches cannot overwrite or dispatch another draft" {
  let source = template(initial_model(), "cylinder")
  let pending = workflow_test_update(source, ValidateRequest)
  assert_true(pending.busy)
  for
    msg in [
      SetPrimitiveField("radius", "999"),
      ApplyTemplate("box"),
      CopyLastPrimitive,
      SaveRequest,
      LoadRequest,
      ValidateRequest,
      ExecuteRequest,
      ReconcileRun,
      BuildDelivery,
    ] {
    let repeated = workflow_test_update(pending, msg)
    assert_eq(repeated.primitive_editor, pending.primitive_editor)
    assert_eq(repeated.params_json, pending.params_json)
    assert_eq(repeated.notice, pending.notice)
    assert_true(repeated.busy)
  }
  let interrupted = workflow_test_update(
    pending,
    RunCompleted(Err("interrupted transport; reconcile required")),
  )
  assert_false(interrupted.busy)
  assert_eq(interrupted.primitive_editor, source.primitive_editor)
  let corrected = workflow_test_update(
    interrupted,
    SetPrimitiveField("radius", "250"),
  )
  assert_eq(corrected.error, "")
  assert_true(corrected.draft_changed)
  assert_true(workflow_test_html(pending).contains("disabled"))
}

///|
test "copy last object operation retains fresh identity and current parent without running it" {
  let source = edit_primitive(
    template(initial_model(), "cylinder"),
    "objectId",
    "known-cylinder",
  )
  let executed = workflow_test_update(
    source,
    RunCompleted(Ok(workflow_test_run(source, "execute"))),
  )
  let other = template(executed, "presentation")
  let copied = workflow_test_update(other, CopyLastPrimitive)
  assert_eq(copied.request_id, executed.request_id)
  assert_eq(copied.expected_parent_digest, executed.expected_parent_digest)
  assert_eq(copied.primitive_editor, source.primitive_editor)
  assert_true(copied.draft_changed)
  assert_false(copied.busy)
  assert_eq(copied.last_receipt, executed.last_receipt)
  assert_true(copied.notice.contains("No operation has run"))
  assert_true(last_primitive({ ..copied, model_id: "another-model", }) is None)
  let moved = template(other, "move")
  assert_eq(primitive_test_params(moved), {
    "objectId": "known-cylinder",
    "xMm": 0,
    "yMm": 0,
    "zMm": 0,
  })
}

///|
test "typed edits invalidate validation and keep exact reviewed historical package" {
  let source = template(initial_model(), "box")
  let validated = workflow_test_update(
    source,
    RunCompleted(Ok(workflow_test_run(source, "validate"))),
  )
  assert_eq(workflow_build_action(validated), "Execute request")
  let changed = workflow_test_update(
    validated,
    SetPrimitiveField("width", "999"),
  )
  assert_eq(workflow_build_action(changed), "Validate request")
  assert_eq(changed.last_receipt, validated.last_receipt)
  assert_true(changed.draft_changed)
  let approved = {
    ..delivery_test_exported(),
    delivery: Some(delivery_test_payload()),
  }
  let draft = workflow_test_update(approved, ApplyTemplate("cylinder"))
  let draft = workflow_test_update(draft, SetPrimitiveField("radius", "250"))
  assert_eq(
    draft.delivery.map(value => value.manifest_digest),
    approved.delivery.map(value => value.manifest_digest),
  )
  assert_eq(
    draft.delivery.map(value => value.download_url),
    approved.delivery.map(value => value.download_url),
  )
  assert_eq(draft.delivery_export, approved.delivery_export)
  assert_eq(draft.reviews, approved.reviews)
  assert_true(delivery_is_historical(draft, delivery_test_payload()))
}

///|
test "typed surface discloses volatile drafts units absolute movement and advanced access" {
  let initial = template(initial_model(), "box")
  let html = workflow_test_html(initial)
  assert_true(html.contains("Width (mm)"))
  assert_true(html.contains("Object ID"))
  assert_true(html.contains("Advanced semantic JSON"))
  assert_true(html.contains("Unsaved fields live only in this page"))
  assert_true(html.contains("Reusing an existing ID replaces its geometry"))
  let move_html = workflow_test_html(template(initial, "move"))
  assert_true(move_html.contains("Absolute position, not a movement amount"))
  assert_true(move_html.contains("no fabrication or physical authority"))
}

///|
test "typed controls emit exact operations for native parity fixture" {
  let model = edit_primitive(initial_model(), "units", "cm")
  let box = template(model, "box")
  let box_move = edit_primitive(
    edit_primitive(
      edit_primitive(template(box, "move"), "x", "200"),
      "y",
      "-100",
    ),
    "z",
    "300",
  )
  let cylinder = edit_primitive(
    edit_primitive(
      edit_primitive(template(box_move, "cylinder"), "radius", "350"),
      "height",
      "1600",
    ),
    "sides",
    "9",
  )
  let cylinder_move = edit_primitive(
    edit_primitive(
      edit_primitive(template(cylinder, "move"), "x", "-450"),
      "y",
      "200",
    ),
    "z",
    "800",
  )
  let operations = [model, box, box_move, cylinder, cylinder_move].map(item => {
    guard spatial_request(item) is Ok({ "operation": operation, .. }) else {
      abort("valid fixture")
    }
    operation
  })
  assert_eq(operations[4], {
    "method": "scene.set-transform",
    "params": {
      "objectId": "support-cylinder",
      "xMm": -450,
      "yMm": 200,
      "zMm": 800,
    },
  })
  println("MOONMOLD_TYPED_PARITY=" + Json::array(operations).stringify())
}
