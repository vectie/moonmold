///|
struct FrozenBrief {
  reference : String
  digest : String
  brief : Json
} derive(Debug, FromJson)

///|
struct DeliveryFile {
  name : String
  url : String
} derive(Debug, FromJson)

///|
struct DeliveryPayload {
  contract_id : String
  manifest : Json
  manifest_digest : String
  download_url : String
  files : Array[DeliveryFile]
  review_status : String
  reviews : Array[Json]
  stale : Bool?
} derive(Debug, FromJson)

///|
struct DeliveryExport {
  attempt_id : String
  brief_ref : String
  receipt_digest : String
} derive(Debug, Eq)

///|
fn default_delivery_brief(project_id : String, model_id : String) -> Json {
  {
    "contract_id": "moonmold.digital-brief.v1",
    "commitment_ref": "client-demo-1",
    "revision": 1,
    "project_id": project_id,
    "model_id": model_id,
    "intended_use": "Digital box visualization",
    "units": "mm",
    "coordinate_frame": "z-up-right-handed",
    "dimensions_mm": { "width": 1200, "depth": 800, "height": 600 },
    "constraints": ["Digital only"],
    "deliverables": ["editable-source", "presentation"],
    "review_criteria": ["Inspect dimensions and losses"],
    "physical_authority": false,
  }
}

///|
fn parse_frozen_brief(json : Json) -> Result[FrozenBrief, String] {
  match operator_error_message(json) {
    Some(error) => Err(error)
    None => {
      let value : FrozenBrief = @json.from_json(json) catch {
        error => return Err("Invalid frozen brief response: \{error}")
      }
      if value.reference.is_empty() ||
        value.digest.is_empty() ||
        !(value.brief
        is {
          "contract_id": String("moonmold.digital-brief.v1"),
          "physical_authority": False,
          ..
        }) {
        Err("Frozen brief response does not establish a digital-only brief.")
      } else {
        Ok(value)
      }
    }
  }
}

///|
fn delivery_id(delivery : DeliveryPayload) -> String {
  match delivery.manifest {
    { "package_id": String(value), .. } => value
    _ => ""
  }
}

///|
fn parse_delivery_payload(json : Json) -> Result[DeliveryPayload, String] {
  match operator_error_message(json) {
    Some(error) => Err(error)
    None => {
      let value : DeliveryPayload = @json.from_json(json) catch {
        error => return Err("Invalid delivery response: \{error}")
      }
      if value.contract_id != "moonmold.operator-delivery.v1" ||
        value.manifest_digest.is_empty() ||
        delivery_id(value).is_empty() ||
        !(value.manifest
        is {
          "contract_id": String("moonmold.digital-delivery.v1"),
          "brief_ref": String(_),
          "brief_digest": String(_),
          "attempt_id": String(_),
          "receipt_digest": String(_),
          "backend": {
            "mode": String("deterministic-mock-reference"),
            "evidence_class": String("fixture-reference-only"),
            "blender_evidence": False,
            ..
          },
          "physical_authority": False,
          ..
        }) {
        Err(
          "Delivery response does not establish the bounded mock digital package.",
        )
      } else {
        Ok(value)
      }
    }
  }
}

///|
// A frozen brief remains bound even when the editable reference list changes.
fn delivery_references(model : Model) -> Array[String] {
  let references = lines(model.references)
  match model.frozen_brief {
    Some(brief) =>
      if !references.contains(brief.reference) {
        references.push(brief.reference)
      }
    None => ()
  }
  references
}

///|
fn delivery_brief_body(model : Model) -> Result[Json, String] {
  let brief = @json.parse(model.brief_json) catch {
    error => return Err("Brief is invalid JSON: \{error}")
  }
  guard brief
    is {
      "project_id": String(project_id),
      "model_id": String(model_id),
      "physical_authority": False,
      ..
    } &&
    project_id == model.project_id &&
    model_id == model.model_id else {
    return Err(
      "Brief project/model must match the current request and physical_authority must be false. Use Prepare brief for current model, then review its fields.",
    )
  }
  Ok({ "brief": brief })
}

///|
// Only an applied export establishes current scene evidence. A new no-op can
// carry an older scene receipt; a same-attempt retry retains its applied receipt.
fn delivery_export_target(model : Model, run : RunPayload) -> DeliveryExport? {
  guard model.frozen_brief is Some(brief) &&
    run.request
    is {
      "reference_artifacts": Array(references),
      "operation": {
        "method": String("representation.export"),
        "params": { "representation": String("presentation"), .. },
        ..
      },
      ..
    } &&
    references.contains(Json::string(brief.reference)) &&
    run.receipt
    is Some(
      {
        "contract_id": String("moonmold.spatial-operation-receipt.v1"),
        "operation_ref": String("moonmold/spatial.operation.execute@0.2.0"),
        "attempt_id": String(attempt_id),
        "outcome": String("applied"),
        "physical_authority": False,
        ..
      }
    ) &&
    flow_attempt_id(Some(run.flow_request)) == Some(attempt_id) &&
    run.result
    is {
      "status": String("succeeded"),
      "attempt_id": String(result_attempt),
      "output_digest": String(receipt_digest),
      ..
    } &&
    result_attempt == attempt_id &&
    !receipt_digest.is_empty() else {
    return None
  }
  Some({ attempt_id, brief_ref: brief.reference, receipt_digest, })
}

///|
fn delivery_build_body(model : Model) -> Result[Json, String] {
  guard model.delivery_export is Some(target) &&
    model.frozen_brief is Some(brief) &&
    brief.reference == target.brief_ref else {
    return Err(
      "Freeze the brief before model operations, then explicitly execute a presentation export bound to that brief before building a package.",
    )
  }
  Ok({ "attempt_id": target.attempt_id, "brief_ref": target.brief_ref })
}

///|
fn next_delivery_export(model : Model, run : RunPayload) -> DeliveryExport? {
  match delivery_export_target(model, run) {
    Some(target) => Some(target)
    None => model.delivery_export
  }
}

///|
fn delivery_review_body(model : Model) -> Result[Json, String] {
  guard model.delivery is Some(delivery) &&
    delivery.manifest is { "attempt_id": String(attempt_id), .. } else {
    return Err("Build or recover a delivery package before reviewing it.")
  }
  Ok({
    "attempt_id": attempt_id,
    "delivery_id": delivery_id(delivery),
    "delivery_digest": delivery.manifest_digest,
    "reviewer": model.reviewer,
    "decision": model.decision,
    "notes": model.review_notes,
  })
}

///|
fn delivery_is_historical(model : Model, delivery : DeliveryPayload) -> Bool {
  if model.draft_changed || delivery.stale == Some(true) {
    return true
  }
  match delivery.manifest {
    { "attempt_id": String(attempt_id), "brief_ref": String(brief_ref), .. } =>
      flow_attempt_id(model.last_flow_request) != Some(attempt_id) ||
      model.frozen_brief.map(brief => brief.reference) != Some(brief_ref)
    _ => true
  }
}

///|
fn restore_delivery(model : Model, delivery : DeliveryPayload?) -> Model {
  guard delivery is Some(value) &&
    value.manifest
    is {
      "brief_ref": String(reference),
      "brief_digest": String(digest),
      "attempt_id": String(attempt_id),
      "receipt_digest": String(receipt_digest),
      ..
    } else {
    return model
  }
  {
    ..model,
    delivery: Some(value),
    frozen_brief: Some({ reference, digest, brief: Json::null(), }),
    delivery_export: Some({ attempt_id, brief_ref: reference, receipt_digest, }),
  }
}
