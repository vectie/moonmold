///|
fn brief_test_json(model : Model) -> Json {
  guard delivery_brief_body(model) is Ok({ "brief": brief, .. }) else {
    abort("Expected a complete brief")
  }
  brief
}

///|
fn brief_test_delivery() -> DeliveryPayload {
  let delivery = delivery_test_payload()
  guard delivery.manifest is Object(fields) else { abort("Expected manifest") }
  let fields = fields.copy()
  fields["project_id"] = "example-project"
  fields["model_id"] = "example-model"
  fields["commitment_ref"] = "client-demo-1"
  fields["brief_revision"] = 1
  {
    ..delivery,
    manifest: Json::object(fields),
    reviews: [{ "fixture": "original exact review" }],
  }
}

///|
test "first brief has structured fields and exact existing contract without geometry changes" {
  let initial = initial_model()
  assert_true(initial.brief_editor is Some(_))
  assert_eq(
    brief_test_json(initial),
    default_delivery_brief("example-project", "example-model"),
  )
  let edited = workflow_test_update(initial, SetBriefField("width", "1500"))
  assert_true(
    brief_test_json(edited)
    is { "dimensions_mm": { "width": Number(1500, ..), .. }, .. },
  )
  assert_eq(edited.params_json, initial.params_json)
  assert_eq(edited.last_spatial_request, None)
  assert_eq(edited.frozen_brief.map(b => b.reference), None)
  let html = workflow_test_html(edited)
  for
    label in [
      "Structured digital brief editor", "Commitment reference", "Intended use",
      "Primary width", "Scene / OBJ export units", "Review criteria", "Advanced brief JSON",
    ] {
    assert_true(html.contains(label))
  }
  assert_true(html.contains("always use positive whole millimetres"))
}

///|
test "supported brief JSON hydrates without trimming dropping reordering or coercing values" {
  let initial = initial_model()
  let edited = workflow_test_update(
    workflow_test_update(
      initial,
      SetBriefField("constraints", "  retain spaces  \n第二项"),
    ),
    SetBriefField(
      "review_criteria", "Check <source> & losses\n  keep whitespace  ",
    ),
  )
  let serialized = edited.brief_json
  let restored = workflow_test_update(initial, SetBrief(serialized))
  assert_eq(restored.brief_json, serialized)
  assert_eq(restored.brief_editor, edited.brief_editor)
  guard restored.brief_editor is Some(editor) else {
    fail("Expected structured editor")
  }
  assert_eq(brief_value(editor), Ok(@json.parse(serialized)))
  let empty_constraints = workflow_test_update(
    restored,
    SetBriefField("constraints", ""),
  )
  assert_true(
    brief_test_json(empty_constraints) is { "constraints": Array([]), .. },
  )
}

///|
test "unsupported and malformed JSON remain exact advanced drafts" {
  let initial = initial_model()
  let cases : Array[(String, Json)] = [
    ("title", "Unsupported title"),
    ("units", "relative"),
    ("units", "inch"),
    ("coordinate_frame", "y-up-right-handed"),
    ("physical_authority", true),
    ("deliverables", ["presentation", "editable-source"]),
    ("constraints", ["one\nmultiline entry"]),
    ("constraints", ["one\rmultiline entry"]),
    ("constraints", [" "]),
    ("review_criteria", []),
    ("revision", 2147483648),
    ("revision", 1.5),
    ("dimensions_mm", { "width": 1.5, "depth": 800, "height": 600 }),
    ("dimensions_mm", { "width": 2147483648, "depth": 800, "height": 600 }),
    (
      "dimensions_mm",
      { "width": 1200, "depth": 800, "height": 600, "extra": 1 },
    ),
  ]
  for (key, value) in cases {
    guard default_delivery_brief("example-project", "example-model")
      is Object(fields) else {
      fail("Expected brief")
    }
    fields[key] = value
    let text = Json::object(fields).stringify(indent=2)
    let loaded = workflow_test_update(initial, SetBrief(text))
    assert_eq(loaded.brief_json, text)
    assert_eq(loaded.brief_editor, None)
    let attempted = workflow_test_update(loaded, SetBriefField("width", "999"))
    assert_eq(attempted.brief_json, text)
  }
  for text in ["{", "null", "{}", "[]"] {
    let loaded = workflow_test_update(initial, SetBrief(text))
    assert_eq(loaded.brief_editor, None)
    assert_eq(loaded.brief_json, text)
    assert_true(delivery_brief_body(loaded) is Err(_))
  }
}

///|
test "incomplete typed fields block freeze and revision while retaining last complete JSON" {
  for
    (name, values) in [
      ("width", ["", "-", "0", "-1", "1.5", "2147483648", "2 cm"]),
      ("depth", ["0"]),
      ("height", ["NaN"]),
      ("revision", ["", "0", "1.5", "2147483648"]),
      ("commitment_ref", ["", "path/invalid", " leading"]),
      ("intended_use", [" "]),
      ("units", ["relative"]),
      ("constraints", ["one\n"]),
      ("review_criteria", ["", "one\n\nlast"]),
    ] {
    for value in values {
      let initial = delivery_test_frozen(initial_model())
      let edited = workflow_test_update(initial, SetBriefField(name, value))
      assert_eq(edited.brief_json, initial.brief_json)
      assert_true(edited.brief_editor != initial.brief_editor)
      assert_true(delivery_brief_body(edited) is Err(_))
      for message in [FreezeBrief, ReviseBrief, PrepareBrief] {
        let blocked = workflow_test_update(edited, message)
        assert_false(blocked.busy)
        assert_eq(blocked.brief_json, edited.brief_json)
        assert_eq(blocked.brief_editor, edited.brief_editor)
        assert_eq(
          blocked.frozen_brief.map(b => b.digest),
          initial.frozen_brief.map(b => b.digest),
        )
        assert_false(blocked.error.is_empty())
      }
    }
  }
}

///|
test "scene unit edits preserve millimetres and unsupported relative units do not hydrate" {
  for units in ["mm", "cm", "m"] {
    let original = initial_model()
    let edited = workflow_test_update(original, SetBriefField("units", units))
    guard brief_test_json(edited)
      is { "units": String(actual), "dimensions_mm": dimensions, .. } else {
      fail("Expected units")
    }
    assert_eq(actual, units)
    assert_eq(dimensions, { "width": 1200, "depth": 800, "height": 600 })
    assert_eq(edited.params_json, original.params_json)
  }
}

///|
test "current model preparation preserves brief content and invalid drafts" {
  let edited = workflow_test_update(
    initial_model(),
    SetBriefField("width", "1740"),
  )
  let changed = { ..edited, project_id: "new-project", model_id: "new-model", }
  assert_true(delivery_brief_body(changed) is Err(_))
  let prepared = workflow_test_update(changed, PrepareBrief)
  assert_true(
    brief_test_json(prepared)
    is {
      "project_id": String("new-project"),
      "model_id": String("new-model"),
      "dimensions_mm": { "width": Number(1740, ..), .. },
      ..
    },
  )
  let invalid = workflow_test_update(prepared, SetBrief("{"))
  assert_eq(workflow_test_update(invalid, PrepareBrief).brief_json, "{")
}

///|
test "revision copies current content and preserves original frozen package and reviews" {
  let delivered = {
    ..delivery_test_exported(),
    delivery: Some(brief_test_delivery()),
  }
  let before = delivered.delivery.unwrap()
  let edited = workflow_test_update(delivered, SetBriefField("width", "1500"))
  let next = workflow_test_update(edited, ReviseBrief)
  assert_true(
    brief_test_json(next)
    is {
      "revision": Number(2, ..),
      "dimensions_mm": { "width": Number(1500, ..), .. },
      ..
    },
  )
  assert_eq(
    next.frozen_brief.map(b => b.brief),
    delivered.frozen_brief.map(b => b.brief),
  )
  assert_eq(next.delivery.unwrap().manifest, before.manifest)
  assert_eq(next.delivery.unwrap().reviews, before.reviews)
  assert_eq(next.delivery_export, delivered.delivery_export)
  assert_eq(next.params_json, delivered.params_json)
  assert_true(delivery_is_historical(next, before))
  let repeat = workflow_test_update(next, ReviseBrief)
  assert_true(brief_test_json(repeat) is { "revision": Number(3, ..), .. })
  let failed = workflow_test_update(
    workflow_test_update(next, FreezeBrief),
    BriefFrozen(Err("immutable-output-conflict")),
  )
  assert_eq(failed.brief_editor, next.brief_editor)
  assert_eq(failed.brief_json, next.brief_json)
  assert_true(failed.brief_draft_dirty)
  let frozen = workflow_test_update(
    failed,
    BriefFrozen(
      Ok({
        reference: "brief-r2",
        digest: "new-digest",
        brief: brief_test_json(next),
      }),
    ),
  )
  assert_false(frozen.brief_draft_dirty)
  assert_true(delivery_build_body(frozen) is Err(_))
  assert_eq(frozen.delivery.unwrap().reviews, before.reviews)
}

///|
test "request load execution and recovery preserve separate unsaved brief state" {
  let delivered = {
    ..delivery_test_exported(),
    delivery: Some(brief_test_delivery()),
  }
  let edited = workflow_test_update(delivered, SetBriefField("width", "-"))
  let request = spatial_request(delivered).unwrap()
  let loaded = request_from_json(edited, request).unwrap()
  let recovered = restore_delivery(loaded, delivered.delivery)
  let completed = workflow_test_update(
    recovered,
    RunCompleted(Ok(workflow_test_run(delivered, "execute"))),
  )
  assert_eq(completed.brief_editor, edited.brief_editor)
  assert_eq(completed.brief_json, edited.brief_json)
  assert_true(completed.brief_draft_dirty)
  assert_true(delivery_is_historical(completed, completed.delivery.unwrap()))
  assert_eq(workflow_stage(completed), 1)
}

///|
test "busy freeze and package loads reject repeated clicks and draft edits" {
  let model = { ..initial_model(), busy: true, }
  for
    message in [
      SetBrief("{}"),
      SetBriefField("width", "900"),
      PrepareBrief,
      ReviseBrief,
      LoadPackageBrief,
      FreezeBrief,
    ] {
    let result = workflow_test_update(model, message)
    assert_eq(result.brief_json, model.brief_json)
    assert_eq(result.brief_editor, model.brief_editor)
    assert_true(result.busy)
    assert_false(result.brief_draft_dirty)
  }
}

///|
test "package recovery explicitly loads exact brief and rejects stale mismatched or failed replies" {
  let delivered = brief_test_delivery()
  let model = restore_delivery(initial_model(), Some(delivered))
  let record : Json = {
    "contract_id": "moonmold.frozen-digital-brief.v1",
    "brief": default_delivery_brief("example-project", "example-model"),
  }
  let loading = workflow_test_update(model, LoadPackageBrief)
  let loaded = workflow_test_update(
    loading,
    PackageBriefLoaded(
      loading.brief_draft_generation,
      delivery_id(delivered),
      delivered.manifest_digest,
      Ok(record),
    ),
  )
  assert_eq(
    brief_test_json(loaded),
    default_delivery_brief("example-project", "example-model"),
  )
  assert_true(loaded.brief_editor is Some(_))
  assert_eq(loaded.delivery.unwrap().reviews, delivered.reviews)
  assert_eq(loaded.frozen_brief.map(b => b.brief), Some(Json::null()))
  assert_true(
    brief_test_json(workflow_test_update(loaded, ReviseBrief))
    is { "revision": Number(2, ..), .. },
  )
  for
    reply in [
      PackageBriefLoaded(
        loaded.brief_draft_generation,
        "other",
        delivered.manifest_digest,
        Ok(record),
      ),
      PackageBriefLoaded(
        loaded.brief_draft_generation,
        delivery_id(delivered),
        "other-digest",
        Ok(record),
      ),
      PackageBriefLoaded(
        loaded.brief_draft_generation,
        delivery_id(delivered),
        delivered.manifest_digest,
        Ok({
          "contract_id": "moonmold.frozen-digital-brief.v1",
          "brief": default_delivery_brief("other-project", "example-model"),
        }),
      ),
      PackageBriefLoaded(
        loaded.brief_draft_generation,
        delivery_id(delivered),
        delivered.manifest_digest,
        Err("interrupted"),
      ),
    ] {
    let retained = workflow_test_update(loaded, reply)
    assert_eq(retained.brief_json, loaded.brief_json)
    assert_eq(retained.brief_editor, loaded.brief_editor)
    assert_false(retained.busy)
    assert_false(retained.error.is_empty())
    assert_eq(retained.delivery.unwrap().reviews, delivered.reviews)
  }
  let other_model = { ..loaded, model_id: "other", }
  assert_true(
    load_package_brief(
      other_model,
      delivery_id(delivered),
      delivered.manifest_digest,
      record,
    )
    is Err(_),
  )
  let newer = workflow_test_update(loaded, SetBriefField("width", "-"))
  let late = workflow_test_update(
    newer,
    PackageBriefLoaded(
      loading.brief_draft_generation,
      delivery_id(delivered),
      delivered.manifest_digest,
      Ok(record),
    ),
  )
  assert_eq(late.brief_editor, newer.brief_editor)
  assert_eq(late.brief_json, newer.brief_json)
  let failing = workflow_test_update(newer, LoadPackageBrief)
  let failed = workflow_test_update(
    failing,
    PackageBriefLoaded(
      failing.brief_draft_generation,
      delivery_id(delivered),
      delivered.manifest_digest,
      Err("interrupted"),
    ),
  )
  assert_eq(failed.brief_editor, newer.brief_editor)
  assert_eq(failed.brief_json, newer.brief_json)
  let retried = workflow_test_update(failed, LoadPackageBrief)
  let old_failure = workflow_test_update(
    retried,
    PackageBriefLoaded(
      failing.brief_draft_generation,
      delivery_id(delivered),
      delivered.manifest_digest,
      Err("late failure"),
    ),
  )
  assert_true(old_failure.busy)
  assert_eq(old_failure.error, retried.error)
  assert_eq(old_failure.brief_editor, newer.brief_editor)
}

///|
test "structured brief controls emit exact first and revised briefs for native parity" {
  let fixtures : Array[Json] = []
  for units in ["mm", "cm", "m"] {
    let initial = initial_model()
    let first = workflow_test_update(
      workflow_test_update(
        workflow_test_update(initial, SetBriefField("units", units)),
        SetBriefField("commitment_ref", "typed-brief-" + units),
      ),
      SetBriefField("intended_use", "Synthetic structured brief parity"),
    )
    let revised = workflow_test_update(
      workflow_test_update(first, ReviseBrief),
      SetBriefField("width", "1500"),
    )
    let first_json = brief_test_json(first)
    let revised_json = brief_test_json(revised)
    assert_true(
      first_json
      is {
        "revision": Number(1, ..),
        "dimensions_mm": { "width": Number(1200, ..), .. },
        ..
      },
    )
    assert_true(
      revised_json
      is {
        "revision": Number(2, ..),
        "dimensions_mm": { "width": Number(1500, ..), .. },
        ..
      },
    )
    fixtures.push({
      "units": units,
      "first": first_json,
      "revised": revised_json,
    })
  }
  println("MOONMOLD_BRIEF_PARITY=" + Json::array(fixtures).stringify())
}
