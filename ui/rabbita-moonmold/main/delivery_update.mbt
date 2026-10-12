///|
fn update_delivery(
  emit : @rabbita.Emit[Msg],
  msg : Msg,
  model : Model,
) -> (@rabbita.Cmd, Model) {
  match msg {
    SetDeliverySelection(value) =>
      (@rabbita.none, { ..model, delivery_selection: value, })
    OpenDelivery => {
      let id = model.delivery_selection.trim().to_owned()
      if !id.has_prefix("delivery-") ||
        id.length() != 73 ||
        !id[9:]
        .to_owned()
        .iter()
        .all(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
        return (
          @rabbita.none,
          {
            ..model,
            error: "Enter an exact saved delivery ID (delivery- followed by 64 lowercase hex digits).",
          },
        )
      }
      (
        load_delivery_request(emit, id, "", model.delivery_generation + 1),
        {
          ..model,
          delivery: None,
          delivery_generation: model.delivery_generation + 1,
          busy: true,
          error: "",
          notice: "Loading exact saved delivery and verified report members…",
        },
      )
    }
    DeliveryReadCompleted(generation, id, digest, result) => {
      if generation != model.delivery_generation {
        return (@rabbita.none, model)
      }
      if !digest.is_empty() &&
        model.delivery.map(value => (delivery_id(value), value.manifest_digest)) !=
        Some((id, digest)) {
        return (@rabbita.none, model)
      }
      match result {
        Err(error) =>
          update_delivery(emit, DeliveryLoaded(Err(error)), {
            ..model,
            delivery_generation: generation + 1,
            delivery: model.delivery.map(value => { ..value, reports: None, }),
          })
        Ok(value) if (!id.is_empty() && delivery_id(value) != id) ||
          (!digest.is_empty() && value.manifest_digest != digest) =>
          (
            @rabbita.none,
            {
              ..model,
              busy: false,
              delivery_generation: generation + 1,
              error: "The response does not match the selected saved delivery identity. Retry the exact package.",
              delivery: model.delivery.map(value => { ..value, reports: None, }),
            },
          )
        _ =>
          update_delivery(emit, DeliveryLoaded(result), {
            ..model,
            delivery_generation: generation + 1,
          })
      }
    }
    SetBrief(value) =>
      (
        @rabbita.none,
        sync_brief_editor({
          ..model,
          brief_json: value,
          brief_draft_dirty: true,
          draft_changed: true,
          error: "",
        }),
      )
    SetBriefField(name, value) =>
      (@rabbita.none, edit_brief(model, name, value))
    PrepareBrief => {
      if !brief_draft_error(model).is_empty() {
        return (@rabbita.none, { ..model, error: brief_draft_error(model), })
      }
      let brief = @json.parse(model.brief_json) catch { _ => Json::null() }
      guard brief is Object(fields) else {
        return (
          @rabbita.none,
          {
            ..model,
            error: "Correct the advanced brief JSON before changing its project/model.",
          },
        )
      }
      fields["project_id"] = model.project_id.to_json()
      fields["model_id"] = model.model_id.to_json()
      (
        @rabbita.none,
        sync_brief_editor({
          ..model,
          brief_json: Json::object(fields).stringify(indent=2),
          brief_draft_dirty: true,
          draft_changed: true,
          notice: "Brief draft now uses the current project/model. Existing dimensions and criteria are preserved; review before freezing.",
          error: "",
        }),
      )
    }
    ReviseBrief =>
      match revise_brief(model) {
        Ok(updated) => (@rabbita.none, updated)
        Err(error) => (@rabbita.none, { ..model, error, })
      }
    LoadPackageBrief =>
      match model.delivery {
        Some(delivery) =>
          (
            load_package_brief_request(
              emit,
              delivery,
              model.brief_draft_generation + 1,
            ),
            {
              ..model,
              brief_draft_generation: model.brief_draft_generation + 1,
              busy: true,
              notice: "Loading the selected package's exact brief; this replaces the brief draft only…",
              error: "",
            },
          )
        None => (@rabbita.none, { ..model, error: "No package is selected.", })
      }
    PackageBriefLoaded(generation, id, digest, result) => {
      if generation != model.brief_draft_generation {
        return (@rabbita.none, model)
      }
      match result {
        Err(error) =>
          (
            @rabbita.none,
            {
              ..model,
              brief_draft_generation: generation + 1,
              busy: false,
              error,
            },
          )
        Ok(record) =>
          match load_package_brief(model, id, digest, record) {
            Ok(updated) => (@rabbita.none, updated)
            Err(error) =>
              (
                @rabbita.none,
                {
                  ..model,
                  brief_draft_generation: generation + 1,
                  busy: false,
                  error,
                },
              )
          }
      }
    }
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
          brief_draft_dirty: false,
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
            build_delivery_request(emit, body, model.delivery_generation + 1),
            {
              ..model,
              busy: true,
              notice: "Building the package from the selected actual presentation export…",
              delivery_generation: model.delivery_generation + 1,
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
            load_delivery_request(
              emit,
              delivery_id(delivery),
              delivery.manifest_digest,
              model.delivery_generation + 1,
            ),
            {
              ..model,
              busy: true,
              notice: "Refreshing the exact delivery package…",
              delivery_generation: model.delivery_generation + 1,
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
            load_delivery_request(
              emit,
              id,
              digest,
              model.delivery_generation + 1,
            ),
            {
              ..model,
              busy: true,
              delivery_generation: model.delivery_generation + 1,
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
