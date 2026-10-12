///|
struct DeliveryReportRow {
  label : String
  value : String
} derive(Debug, FromJson)

///|
struct DeliveryReport {
  name : String
  sha256 : String
  status : String
  message : String
  rows : Array[DeliveryReportRow]
} derive(Debug, FromJson)

///|
fn delivery_report_valid(
  delivery : DeliveryPayload,
  report : DeliveryReport,
) -> Bool {
  ["change-report.json", "loss-report.json", "validation.json"].contains(
    report.name,
  ) &&
  report.sha256 == delivery_file_digest(delivery, report.name) &&
  report.status == "available" &&
  report.rows.length() <= 2048 &&
  report.rows.all(row => {
    row.label.length() <= 4096 && row.value.length() <= 16384
  })
}

///|
fn delivery_report_panel(delivery : DeliveryPayload) -> @rabbita.Html {
  @html.details(class="delivery-report-reader", [
    @html.summary("Changes and checks · exact saved delivery"),
    @html.p(
      "Historical report fields from the selected package, not the current editable scene. Human criteria remain pending until a separate named review.",
    ),
    @html.code(delivery_id(delivery)),
    @html.code(delivery.manifest_digest),
    match delivery.manifest {
      { "brief_ref": String(reference), "brief_digest": String(digest), .. } =>
        @html.div([
          @html.small("Exact brief"),
          @html.code(reference),
          @html.code(digest),
        ])
      _ => @html.p("Brief identity unavailable")
    },
    @html.div(
      ["change-report.json", "loss-report.json", "validation.json"].map(name => {
        let reports = delivery.reports.unwrap_or([])
        let report = reports
          .search_by(report => report.name == name)
          .map(index => reports[index])
        @html.section([
          @html.h3(
            match name {
              "change-report.json" =>
                "Added, removed, and changed object fields"
              "loss-report.json" => "Declared representation losses"
              _ => "Recorded validation and pending human checks"
            },
          ),
          @html.code(delivery_file_digest(delivery, name)),
          @html.a(
            href="/api/delivery/" + delivery_id(delivery) + "/file/" + name,
            download=name,
            escape=true,
            "Download exact " + name,
          ),
          match report {
            Some(value) if delivery_report_valid(delivery, value) =>
              @html.div([
                @html.p(
                  "Exact retained fields; no human approval or physical qualification is inferred.",
                ),
                @html.div(
                  value.rows.map(row => {
                    @html.div(class="delivery-report-field", [
                      @html.strong(row.label),
                      @html.pre(row.value),
                    ])
                  }),
                ),
              ])
            _ =>
              @html.p(
                "Interpretation unavailable: malformed, unsupported, missing, or over display bounds. Download the exact retained member; this is not a passed check.",
              )
          },
        ])
      }),
    ),
  ])
}
