///|
extern "js" fn delivery_reader_host_fixture() -> String =
  #| () => process.env.MOONMOLD_READER_HOST_FIXTURE || ""

///|
test "reader compiled UI crosses real HTTP projection with exact digest fields" {
  let source = delivery_reader_host_fixture()
  if source.is_empty() {
    println("MOONMOLD_READER_HTTP_BRIDGE=not-run-without-fixture")
    return
  }
  guard @json.parse(source) is Array(snapshots) else {
    fail("expected HTTP snapshots")
  }
  assert_true(snapshots.length() > 0)
  for snapshot in snapshots {
    let delivery = parse_delivery_payload(snapshot).unwrap()
    let model = workflow_test_update(
      { ..initial_model(), delivery_generation: 1, busy: true, },
      DeliveryReadCompleted(1, delivery_id(delivery), "", Ok(delivery)),
    )
    assert_false(model.busy)
    assert_true(model.error.is_empty())
    let rendered = workflow_test_html(model)
    assert_true(rendered.contains("Changes and checks"))
    assert_true(rendered.contains("Historical package"))
    assert_true(rendered.contains(delivery.manifest_digest))
    for report in delivery.reports.unwrap() {
      assert_true(delivery_report_valid(delivery, report))
      assert_true(rendered.contains(report.sha256))
      assert_true(report.rows.length() > 0)
    }
    assert_true(rendered.contains("cylinder_tessellation.0.sides"))
    assert_true(rendered.contains("constraints_pending_human_review.0"))
    println("MOONMOLD_READER_RENDER=" + rendered)
  }
  println("MOONMOLD_READER_HTTP_BRIDGE=PASS")
}

///|
test "reader renders hostile complete text escaped and never treats unavailable as passed" {
  let report : DeliveryReport = {
    name: "change-report.json",
    sha256: "sha256:file-exact",
    status: "available",
    message: "",
    rows: [
      {
        label: "changed.0.after.material_id",
        value: "<script>alert(1)</script> & 中文",
      },
    ],
  }
  let delivery = { ..delivery_test_payload(), reports: Some([report]), }
  let model = { ..initial_model(), delivery: Some(delivery), }
  let html = workflow_test_html(model)
  assert_true(
    html.contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; 中文"),
  )
  assert_false(html.contains("<script>alert(1)</script>"))
  assert_true(html.contains("Interpretation unavailable"))
  for
    invalid in [
      { ..report, sha256: "sha256:wrong", },
      { ..report, status: "unavailable", },
    ] {
    let html = workflow_test_html({
      ..model,
      delivery: Some({ ..delivery, reports: Some([invalid]), }),
    })
    assert_false(html.contains("alert(1)"))
    assert_true(html.contains("this is not a passed check"))
    assert_true(html.contains("Download exact change-report.json"))
  }
}

///|
test "saved selection stale success error retry and repeated callbacks cannot replace reports" {
  let selected = {
    ..delivery_test_payload(),
    reports: Some([
      {
        name: "change-report.json",
        sha256: "sha256:file-exact",
        status: "available",
        message: "",
        rows: [{ label: "changed.0.after.material_id", value: "steel-tag", }],
      },
    ]),
  }
  let model = {
    ..initial_model(),
    delivery: Some(selected),
    delivery_generation: 3,
    busy: true,
  }
  for result in [Ok(selected), Err("old error")] {
    let stale = workflow_test_update(
      model,
      DeliveryReadCompleted(2, "delivery-old", "", result),
    )
    assert_eq(
      stale.delivery.map(value => value.manifest_digest),
      Some(selected.manifest_digest),
    )
    assert_true(stale.busy)
    assert_eq(stale.error, "")
  }
  let failed = workflow_test_update(
    model,
    DeliveryReadCompleted(
      3,
      delivery_id(selected),
      selected.manifest_digest,
      Err("read failed"),
    ),
  )
  assert_false(failed.busy)
  assert_eq(failed.error, "read failed")
  assert_true(failed.delivery.unwrap().reports is None)
  assert_false(workflow_test_html(failed).contains("steel-tag"))
  assert_eq(failed.delivery_generation, 4)
  let retry = workflow_test_update(failed, RefreshDelivery)
  assert_true(retry.busy)
  assert_eq(retry.delivery_generation, 5)
  let late = workflow_test_update(
    retry,
    DeliveryReadCompleted(3, delivery_id(selected), "", Ok(selected)),
  )
  assert_eq(late.delivery_generation, 5)
  assert_true(late.busy)
  let done = workflow_test_update(
    retry,
    DeliveryReadCompleted(
      5,
      delivery_id(selected),
      selected.manifest_digest,
      Ok(selected),
    ),
  )
  assert_false(done.busy)
  assert_eq(done.delivery_generation, 6)
  let wrong = workflow_test_update(
    model,
    DeliveryReadCompleted(3, "delivery-other", "", Ok(selected)),
  )
  assert_true(wrong.error.contains("does not match"))
  let id = "delivery-" + "a".repeat(64)
  let opening = workflow_test_update(
    { ..initial_model(), delivery_selection: id, delivery: Some(selected), },
    OpenDelivery,
  )
  assert_true(opening.busy)
  assert_true(opening.delivery is None)
  assert_eq(opening.delivery_generation, 1)
  let duplicate = workflow_test_update(opening, OpenDelivery)
  assert_eq(duplicate.delivery_generation, 1)
  let bad = workflow_test_update(
    { ..initial_model(), delivery_selection: "../outside", },
    OpenDelivery,
  )
  assert_false(bad.error.is_empty())
}
