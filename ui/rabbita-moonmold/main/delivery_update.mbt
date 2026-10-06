///|
fn update_delivery(
  emit : @rabbita.Emit[Msg],
  msg : Msg,
  model : Model,
) -> (@rabbita.Cmd, Model) {
  match msg {
    SetBrief(value) =>
      (@rabbita.none, { ..model, brief_json: value, draft_changed: true, })
    PrepareBrief =>
      (
        @rabbita.none,
        {
          ..model,
          brief_json: default_delivery_brief(model.project_id, model.model_id).stringify(
            indent=2,
          ),
          draft_changed: true,
          notice: "Brief draft prepared for the current project/model. Review dimensions and revision, then freeze before model operations.",
        },
      )
    FreezeBrief =>
      match delivery_brief_body(model) {
        Err(error) => (@rabbita.none, { ..model, error, })
        Ok(body) =>
          (
            freeze_brief_request(emit, body),
            {
              ..model,
              busy: true,
              notice: "Freezing the exact digital brief…",
              error: "",
            },
          )
      }
    BriefFrozen(Ok(brief)) =>
      (
        @rabbita.none,
        {
          ..model,
          frozen_brief: Some(brief),
          busy: false,
          draft_changed: true,
          notice: "Brief frozen. Future operations include its reference; choose and execute model operations explicitly.",
          error: "",
        },
      )
    BriefFrozen(Err(error)) => (@rabbita.none, { ..model, busy: false, error, })
    BuildDelivery =>
      match delivery_build_body(model) {
        Err(error) => (@rabbita.none, { ..model, error, })
        Ok(body) =>
          (
            build_delivery_request(emit, body),
            {
              ..model,
              busy: true,
              notice: "Building the package from the selected actual presentation export…",
              error: "",
            },
          )
      }
    DeliveryLoaded(Ok(delivery)) =>
      (
        @rabbita.none,
        {
          ..model,
          delivery: Some(delivery),
          busy: false,
          notice: "Digital package available. Building a package does not grant human approval.",
          error: "",
        },
      )
    DeliveryLoaded(Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error, })
    RefreshDelivery =>
      match model.delivery {
        Some(delivery) =>
          (
            load_delivery_request(emit, delivery_id(delivery)),
            {
              ..model,
              busy: true,
              notice: "Refreshing the exact delivery package…",
              error: "",
            },
          )
        None => (@rabbita.none, { ..model, error: "No package is selected.", })
      }
    SubmitDeliveryReview =>
      match (delivery_review_body(model), model.delivery) {
        (Ok(body), Some(delivery)) =>
          (
            review_delivery_request(emit, delivery, body),
            {
              ..model,
              busy: true,
              notice: "Recording a named decision for this exact package digest…",
              error: "",
            },
          )
        (Err(error), _) => (@rabbita.none, { ..model, error, })
        _ => (@rabbita.none, { ..model, error: "No package is selected.", })
      }
    DeliveryReviewSubmitted(id, digest, Ok(payload)) =>
      match model.delivery {
        Some(delivery) if delivery_id(delivery) == id &&
          delivery.manifest_digest == digest =>
          (
            load_delivery_request(emit, id),
            {
              ..model,
              busy: true,
              notice: "Package review recorded at " +
              payload.reference +
              "; refreshing its exact decision…",
              error: "",
            },
          )
        _ =>
          (
            @rabbita.none,
            {
              ..model,
              busy: false,
              notice: "The review was recorded for the previously selected package.",
            },
          )
      }
    DeliveryReviewSubmitted(_, _, Err(error)) =>
      (@rabbita.none, { ..model, busy: false, error, })
    _ => (@rabbita.none, model)
  }
}
