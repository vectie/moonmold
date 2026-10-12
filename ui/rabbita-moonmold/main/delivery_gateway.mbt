///|
fn freeze_brief_request(emit : @rabbita.Emit[Msg], body : Json) -> @rabbita.Cmd {
  @http.post("/api/delivery/brief")
  .with_json(body)
  .expect_json(
    emit.map(result => {
      BriefFrozen(
        match result {
          Ok(value) => parse_frozen_brief(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn load_package_brief_request(
  emit : @rabbita.Emit[Msg],
  delivery : DeliveryPayload,
  generation : Int,
) -> @rabbita.Cmd {
  @http.get("/api/delivery/" + delivery_id(delivery) + "/file/brief.json").expect_json(
    emit.map(result => {
      PackageBriefLoaded(
        generation,
        delivery_id(delivery),
        delivery.manifest_digest,
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn build_delivery_request(
  emit : @rabbita.Emit[Msg],
  body : Json,
  generation : Int,
) -> @rabbita.Cmd {
  @http.post("/api/delivery/build")
  .with_json(body)
  .expect_json(
    emit.map(result => {
      DeliveryReadCompleted(
        generation,
        "",
        "",
        match result {
          Ok(value) => parse_delivery_payload(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn load_delivery_request(
  emit : @rabbita.Emit[Msg],
  id : String,
  digest : String,
  generation : Int,
) -> @rabbita.Cmd {
  @http.get("/api/delivery/" + id).expect_json(
    emit.map(result => {
      DeliveryReadCompleted(
        generation,
        id,
        digest,
        match result {
          Ok(value) => parse_delivery_payload(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn review_delivery_request(
  emit : @rabbita.Emit[Msg],
  delivery : DeliveryPayload,
  body : Json,
) -> @rabbita.Cmd {
  @http.post("/api/review")
  .with_json(body)
  .expect_json(
    emit.map(result => {
      DeliveryReviewSubmitted(
        delivery_id(delivery),
        delivery.manifest_digest,
        match result {
          Ok(value) => parse_review_payload(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}
