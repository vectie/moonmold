///|
fn status_request(emit : @rabbita.Emit[Msg]) -> @rabbita.Cmd {
  @http.get("/api/status").expect_json(
    emit.map(result => {
      StatusLoaded(
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn save_request(
  emit : @rabbita.Emit[Msg],
  request : Json,
) -> @rabbita.Cmd {
  @http.post("/api/request/save")
  .with_json({ "request": request })
  .expect_json(
    emit.map(result => {
      RequestSaved(
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn load_request(
  emit : @rabbita.Emit[Msg],
  reference : String,
) -> @rabbita.Cmd {
  @http.post("/api/request/load")
  .with_json({ "reference": reference })
  .expect_json(
    emit.map(result => {
      RequestLoaded(
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn run_request(
  emit : @rabbita.Emit[Msg],
  mode : String,
  request : Json,
) -> @rabbita.Cmd {
  let body : Json = { "mode": mode, "request": request }
  @http.post("/api/run")
  .with_json(body)
  .expect_json(
    emit.map(result => {
      RunCompleted(
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn reconcile_request(
  emit : @rabbita.Emit[Msg],
  flow : Json,
  request : Json,
) -> @rabbita.Cmd {
  @http.post("/api/reconcile")
  .with_json({ "flow_request": flow, "request": request })
  .expect_json(
    emit.map(result => {
      Reconciled(
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn submit_review(
  emit : @rabbita.Emit[Msg],
  attempt_id : String,
  reviewer : String,
  decision : String,
  notes : String,
) -> @rabbita.Cmd {
  @http.post("/api/review")
  .with_json({
    "attempt_id": attempt_id,
    "reviewer": reviewer,
    "decision": decision,
    "notes": notes,
  })
  .expect_json(
    emit.map(result => {
      ReviewSubmitted(
        match result {
          Ok(value) => Ok(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}
