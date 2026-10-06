///|
fn successful_receipt(model : Model, operation : String) -> Bool {
  match (model.last_receipt, model.last_result) {
    (
      Some(
        {
          "contract_id": String("moonmold.spatial-operation-receipt.v1"),
          "operation_ref": String(operation_ref),
          "outcome": String("applied" | "idempotent-no-op"),
          "physical_authority": False,
          ..
        }
      ),
      Some({ "status": String("succeeded"), .. }),
    ) => operation_ref == "moonmold/\{operation}@0.2.0"
    _ => false
  }
}

///|
extern "js" fn review_timestamp(value : String) -> Double =
  #| (value) => Date.parse(value)

///|
// The host verifies the receipt bytes. Retain its result digest so reviews
// cannot be projected onto a different receipt, attempt, or artifact.
fn workflow_review_decision(model : Model) -> String {
  guard model.last_receipt
    is Some({ "attempt_id": String(receipt_attempt), .. }) &&
    flow_attempt_id(model.last_flow_request) is Some(attempt) &&
    receipt_attempt == attempt &&
    model.last_result
    is Some(
      {
        "status": String("succeeded"),
        "attempt_id": String(result_attempt),
        "output_digest": String(digest),
        "output_artifacts": Array(artifacts),
        ..
      }
    ) &&
    result_attempt == attempt &&
    !digest.is_empty() else {
    return ""
  }
  let receipt_ref = ".moonsuite/products/moonmold/adapter-attempts/\{attempt}/operation-receipt.json"
  guard artifacts.contains(Json::string(receipt_ref)) else { return "" }
  let mut latest : Double? = None
  let mut decision = ""
  for review in model.reviews {
    guard review
      is {
        "attempt_id": String(review_attempt),
        "receipt_ref": String(review_ref),
        "receipt_digest": String(review_digest),
        ..
      } &&
      review_attempt == attempt &&
      review_ref == receipt_ref &&
      review_digest == digest else {
      continue
    }
    guard review
      is {
        "contract_id": String("moonmold.named-review.v1"),
        "reviewer": String(reviewer),
        "decision": String(value),
        "reviewed_at": String(reviewed_at),
        "self_approved": False,
        "physical_authority": False,
        ..
      } &&
      reviewer.trim().length() >= 2 else {
      return "unverified"
    }
    let timestamp = review_timestamp(reviewed_at)
    if timestamp.is_nan() {
      return "unverified"
    }
    let value = match value {
      "approve" | "request-changes" | "reject" => value
      _ => "unverified"
    }
    match latest {
      None => {
        latest = Some(timestamp)
        decision = value
      }
      Some(previous) =>
        if timestamp > previous {
          latest = Some(timestamp)
          decision = value
        } else if timestamp == previous && decision != value {
          // Simultaneous contradictory decisions do not establish acceptance.
          decision = "unverified"
        }
    }
  }
  decision
}

///|
fn workflow_stage(model : Model) -> Int {
  if model.draft_changed {
    1
  } else if successful_receipt(model, "spatial.operation.validate") {
    2
  } else if !successful_receipt(model, "spatial.operation.execute") {
    1
  } else if !has_current_representation(model) {
    2
  } else if workflow_review_decision(model) == "approve" {
    4
  } else {
    3
  }
}

///|
// Project snapshots may include older siblings. Only the selected export's
// output and current scene lineage complete this build.
fn has_current_representation(model : Model) -> Bool {
  guard model.last_spatial_request
    is Some(
      {
        "project_id": String(project_id),
        "model_id": String(model_id),
        "operation": {
          "method": String("representation.export"),
          "params": {
            "representation": String(representation),
            "outputPath": String(output),
            ..
          },
          ..
        },
        ..
      }
    ) &&
    model.last_receipt
    is Some(
      {
        "after_digest": String(parent),
        "artifacts": Array(receipt_artifacts),
        ..
      }
    ) &&
    model.last_result
    is Some({ "output_artifacts": Array(result_artifacts), .. }) &&
    representation_output_ref(model, output) is Some(output_ref) &&
    receipt_artifacts.contains(Json::string(output_ref)) &&
    result_artifacts.contains(Json::string(output_ref)) else {
    return false
  }
  model.representations.any(artifact => {
    match artifact {
      {
        "contract_id": String("moonmold.spatial-artifact.v1"),
        "project_id": String(artifact_project),
        "model_id": String(artifact_model),
        "representation": String(artifact_representation),
        "parent_digest": String(artifact_parent),
        "physical_authority": False,
        ..
      } =>
        artifact_project == project_id &&
        artifact_model == model_id &&
        artifact_representation == representation &&
        artifact_parent == parent
      _ => false
    }
  })
}

///|
// The operator also accepts absolute paths inside its workspace, but receipts
// publish workspace-relative references. This only normalizes display binding;
// the host remains responsible for filesystem validation and authority.
fn representation_output_ref(model : Model, output : String) -> String? {
  if !output.has_prefix("/") {
    return if output.is_empty() { None } else { Some(output) }
  }
  guard model.status is Some({ "workspace_root": String(root), .. }) else {
    return None
  }
  let parts : Array[String] = []
  for part in output.split("/") {
    match part {
      "" | "." => ()
      ".." => ignore(parts.pop())
      _ => parts.push(part.to_owned())
    }
  }
  let canonical = "/" + parts.join("/")
  canonical.strip_prefix(root + "/").map(value => value.to_owned())
}

///|
// Operator identities advance after each durable run. Compare the semantic
// request separately, so editing it never inherits an older validation prompt.
fn matches_last_request(model : Model, operation_only? : Bool = false) -> Bool {
  match (spatial_request(model), model.last_spatial_request) {
    (Ok(Object(current)), Some(Object(previous))) => {
      let keys = if operation_only {
        ["project_id", "model_id", "operation"]
      } else {
        [
          "project_id", "model_id", "operation", "expected_parent_digest", "authority",
          "intent", "reference_artifacts", "constraints", "backend_preference",
        ]
      }
      keys.all(key => current.get(key) == previous.get(key))
    }
    _ => false
  }
}

///|
fn workflow_build_action(model : Model) -> String {
  if successful_receipt(model, "spatial.operation.validate") &&
    matches_last_request(model) {
    if model.method_name == "representation.export" {
      "Build representation"
    } else {
      "Execute request"
    }
  } else if successful_receipt(model, "spatial.operation.execute") &&
    matches_last_request(model, operation_only=true) {
    if model.method_name == "representation.export" {
      "Reconcile representation"
    } else {
      "Choose representation"
    }
  } else if model.method_name == "representation.export" {
    "Validate representation"
  } else {
    "Validate request"
  }
}
