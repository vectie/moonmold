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
fn build_delivery_request(
  emit : @rabbita.Emit[Msg],
  body : Json,
) -> @rabbita.Cmd {
  @http.post("/api/delivery/build")
  .with_json(body)
  .expect_json(
    emit.map(result => {
      DeliveryLoaded(
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
) -> @rabbita.Cmd {
  @http.get("/api/delivery/" + id).expect_json(
    emit.map(result => {
      DeliveryLoaded(
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
