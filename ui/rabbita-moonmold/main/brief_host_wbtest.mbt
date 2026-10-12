///|
// Optional bridge qualification: the .mbtx verifier supplies exact JSON bytes
// from the native no-listener /file/brief.json and recovery responses.
extern "js" fn brief_host_fixture() -> String =
  #| () => process.env.MOONMOLD_BRIEF_HOST_FIXTURE || ""

///|
test "native retained brief response hydrates the actual structured revision workflow" {
  let text = brief_host_fixture()
  if text.is_empty() {
    println("MOONMOLD_HOST_BRIEF_BRIDGE=not-run-without-host-fixture")
    return
  }
  let fixture = @json.parse(text)
  guard fixture
    is {
      "delivery": delivery_json,
      "record": record,
      "expected_brief": expected,
      ..
    } else {
    fail("Expected actual native bridge fixture")
  }
  let delivery = parse_delivery_payload(delivery_json).unwrap()
  let recovered = restore_delivery(initial_model(), Some(delivery))
  let loading = workflow_test_update(recovered, LoadPackageBrief)
  let loaded = workflow_test_update(
    loading,
    PackageBriefLoaded(
      loading.brief_draft_generation,
      delivery_id(delivery),
      delivery.manifest_digest,
      Ok(record),
    ),
  )
  assert_eq(loaded.error, "")
  assert_eq(brief_test_json(loaded), expected)
  assert_true(loaded.brief_editor is Some(_))
  let revised = workflow_test_update(loaded, ReviseBrief)
  assert_true(
    brief_test_json(revised)
    is {
      "revision": Number(3, ..),
      "dimensions_mm": {
        "width": Number(1500, ..),
        "depth": Number(800, ..),
        "height": Number(600, ..),
        ..
      },
      ..
    },
  )
  assert_eq(revised.delivery.unwrap().manifest, delivery.manifest)
  assert_eq(revised.delivery.unwrap().reviews, delivery.reviews)
  assert_true(delivery_is_historical(revised, delivery))
  assert_eq(
    revised.frozen_brief.map(b => b.reference),
    recovered.frozen_brief.map(b => b.reference),
  )
  println("MOONMOLD_HOST_BRIEF_BRIDGE=PASS")
}
