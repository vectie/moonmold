///|
fn canonical_operation_id(value : String) -> String {
  match value {
    "moonmold/spatial.operation.validate@0.2.0" => "spatial.operation.validate"
    "moonmold/spatial.operation.execute@0.2.0" => "spatial.operation.execute"
    "moonmold/representation.validate@0.2.0" => "representation.validate"
    other => other
  }
}

///|
fn claim_rank(value : String) -> Int? {
  match value {
    "" | "observation" => Some(0)
    "research-evidence" => Some(1)
    "execution-result" => Some(2)
    "accepted-knowledge" => Some(3)
    "digital-artifact" => Some(4)
    _ => None
  }
}

///|
fn request_issues(
  request : @suite_adapter.MoonflowAdapterRequest,
) -> Array[String] {
  let issues : Array[String] = []
  for
    item in [
      ("request_id", request.request_id),
      ("run_id", request.run_id),
      ("book_id", request.book_id),
      ("work_item_id", request.work_item_id),
      ("declaration_id", request.declaration_id),
      ("attempt_id", request.attempt_id),
      ("idempotency_key", request.idempotency_key),
      ("input_digest", request.input_digest),
      ("created_at", request.created_at),
    ] {
    let (name, value) = item
    if value.trim().is_empty() {
      issues.push("\{name} is required")
    }
  }
  if !valid_identity(request.attempt_id) {
    issues.push("attempt_id must be a safe identity")
  }
  if request.product_id != "moonmold" {
    issues.push("product_id must be moonmold")
  }
  match @suite_adapter.find_operation_contract(request.operation) {
    None => issues.push("operation is not declared by MoonMold 0.2.0")
    Some(contract) => {
      if request.requested_authority != contract.authority_class {
        issues.push(
          "requested authority does not match the installed manifest tool",
        )
      }
      if !request.input_contracts.is_empty() &&
        !request.input_contracts.contains(contract.input_schema) {
        issues.push("input schema does not match the installed manifest tool")
      }
      if !request.output_contracts.is_empty() &&
        !request.output_contracts.contains(contract.output_schema) {
        issues.push("output schema does not match the installed manifest tool")
      }
      match
        (claim_rank(request.required_claim), claim_rank(contract.claim_ceiling)) {
        (Some(required), Some(ceiling)) if required > ceiling =>
          issues.push("required claim exceeds the adapter claim ceiling")
        (None, _) => issues.push("required claim is unsupported")
        _ => ()
      }
    }
  }
  if request.timeout_ms <= 0 || request.timeout_ms > 120000 {
    issues.push("timeout_ms must be between 1 and 120000")
  }
  if request.input_artifacts.is_empty() {
    issues.push(
      "a safe workspace-relative typed primary input artifact is required",
    )
  } else if request.input_artifacts.any(reference => {
      !valid_relative_ref(reference)
    }) {
    issues.push(
      "all input artifacts must be safe workspace-relative references",
    )
  }
  issues
}

///|
fn load_input(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
) -> Result[(String, String, Json), AdapterRuntimeIssue] {
  guard request.input_artifacts is [artifact_ref, ..] else {
    return Err(
      issue(
        "missing-operation-input",
        request.operation,
        "a typed primary input artifact is required",
      ),
    )
  }
  let path = match resolve_ref(workspace_root, artifact_ref) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let text = @fsx.read_file_to_string(path) catch {
    _ =>
      return Err(
        issue(
          "read-operation-input", path, "failed to read MoonMold operation input",
        ),
      )
  }
  let value = @json.parse(text) catch {
    _ =>
      return Err(
        issue(
          "parse-operation-input", path, "failed to parse MoonMold operation input",
        ),
      )
  }
  Ok((artifact_ref, sha256_text(text), value))
}

///|
fn input_artifact_set_digest(
  workspace_root : String,
  artifact_refs : Array[String],
) -> Result[String, AdapterRuntimeIssue] {
  if artifact_refs.is_empty() {
    return Err(
      issue(
        "missing-operation-input", "", "a typed primary input artifact is required",
      ),
    )
  }
  let identities : Array[String] = []
  for artifact_ref in artifact_refs {
    let path = match resolve_ref(workspace_root, artifact_ref) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    let bytes = @fsx.read_file_to_bytes(path) catch {
      _ =>
        return Err(
          issue(
            "read-operation-evidence", path, "failed to read MoonMold input artifact evidence",
          ),
        )
    }
    identities.push("\{artifact_ref}|\{sha256_bytes(bytes)}")
  }
  Ok(sha256_text(identities.join("\n")))
}

///|
fn load_journal(
  workspace_root : String,
) -> Result[Array[Json], AdapterRuntimeIssue] {
  let path = match resolve_ref(workspace_root, journal_ref()) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if !@fsx.path_exists(path) {
    return Ok([])
  }
  match read_json(path) {
    Ok(Array(entries)) => Ok(entries)
    Ok(_) =>
      Err(
        issue(
          "invalid-semantic-journal", path, "semantic journal must be a JSON array",
        ),
      )
    Err(error) => Err(error)
  }
}

///|
fn save_journal(
  workspace_root : String,
  entries : Array[Json],
) -> Result[Unit, AdapterRuntimeIssue] {
  let path = match resolve_ref(workspace_root, journal_ref()) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  write_json(path, Json::array(entries))
}

///|
fn decode_journal_entry(
  value : Json,
) -> Result[
  (
    @suite_adapter.MoonflowAdapterRequest,
    @suite_adapter.SpatialOperationRequest,
  ),
  AdapterRuntimeIssue,
] {
  guard value
    is { "flow_request": flow_json, "spatial_request": spatial_json, .. } else {
    return Err(
      issue(
        "invalid-semantic-journal",
        journal_ref(),
        "semantic journal entry is malformed",
      ),
    )
  }
  let flow = try
    @suite_adapter.decode_moonflow_adapter_request(flow_json)
  catch {
    error =>
      return Err(
        issue(
          "invalid-semantic-journal",
          journal_ref(),
          "journal flow request is invalid: \{error}",
        ),
      )
  } noraise {
    value => value
  }
  let spatial = try
    @suite_adapter.decode_spatial_operation_request(spatial_json)
  catch {
    error =>
      return Err(
        issue(
          "invalid-semantic-journal",
          journal_ref(),
          "journal spatial request is invalid: \{error}",
        ),
      )
  } noraise {
    value => value
  }
  Ok((flow, spatial))
}

///|
fn replay_backend(
  workspace_root : String,
  journal : Array[Json],
) -> Result[@moonmold.MockBackend, AdapterRuntimeIssue] {
  let backend = @moonmold.MockBackend::new()
  for entry in journal {
    let (flow, spatial) = match decode_journal_entry(entry) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    let request = match adapter_request(workspace_root, flow, spatial) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    try backend.execute(request) catch {
      error =>
        return Err(
          issue(
            "semantic-journal-replay-failed",
            journal_ref(),
            "persisted semantic operation cannot replay: \{to_repr(error)}",
          ),
        )
    } noraise {
      _ => ()
    }
  }
  Ok(backend)
}

///|
fn outcome_id(value : @moonmold.AdapterOutcome) -> String {
  match value {
    Applied => "applied"
    IdempotentNoOp => "idempotent-no-op"
    Rejected => "rejected"
  }
}

///|
fn representation_policy(
  representation : @moonmold.RepresentationKind,
) -> (String, Array[String], String) {
  match representation {
    EditableSource => ("modeled-from", [], "editable-digital-source")
    Engineering => ("modeled-from", [], "digital-engineering-candidate")
    Presentation =>
      (
        "styled-from",
        ["engineering material fidelity", "collision fidelity"],
        "presentation-only",
      )
    Simulation =>
      (
        "physics-derived-from",
        ["measured mass properties absent", "environment calibration absent"],
        "simulation-input-candidate",
      )
    ManufacturingCandidate =>
      (
        "manufacturing-derived-from",
        [
          "watertightness not independently measured", "fabrication tolerance unqualified",
          "material and process assumptions unresolved",
        ],
        "analysis-only-no-machine-authority",
      )
    _ => ("interpreted-from", [], "digital-artifact")
  }
}

///|
fn materialize_representation(
  workspace_root : String,
  spatial : @suite_adapter.SpatialOperationRequest,
  operation : @moonmold.SemanticOperation,
  receipt : @moonmold.AdapterReceipt,
) -> Result[Array[String], AdapterRuntimeIssue] {
  guard operation is ExportRepresentation(representation~, output_path~) else {
    return Ok([])
  }
  let (artifact_ref, artifact_path) = match
    output_ref(workspace_root, output_path) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let (relation, losses, ceiling) = representation_policy(representation)
  let artifact_digest = sha256_text(
    "\{spatial.project_id}|\{spatial.model_id}|\{representation_id(representation)}|\{receipt.after_digest}",
  )
  let artifact : Json = {
    "contract_id": "moonmold.spatial-artifact.v1",
    "artifact_id": "\{spatial.model_id}:\{representation_id(representation)}",
    "project_id": spatial.project_id,
    "model_id": spatial.model_id,
    "representation": representation_id(representation),
    "digest": artifact_digest,
    "parent_digest": receipt.after_digest,
    "lineage_relation": relation,
    "units": "declared-by-editable-source",
    "coordinate_frame": "declared-by-editable-source",
    "known_losses": losses,
    "claim_ceiling": ceiling,
    "physical_authority": false,
    "backend": {
      "mode": "deterministic-mock-reference",
      "evidence_class": "fixture-reference-only",
      "blender_evidence": false,
    },
    "intent": spatial.intent,
    "reference_artifacts": spatial.reference_artifacts,
    "constraints": spatial.constraints,
  }
  let text = artifact.stringify(indent=2) + "\n"
  if @fsx.path_exists(artifact_path) {
    let existing = @fsx.read_file_to_string(artifact_path) catch {
      _ =>
        return Err(
          issue(
            "read-existing-artifact", artifact_ref, "failed to inspect existing representation artifact",
          ),
        )
    }
    if existing != text {
      return Err(
        issue(
          "immutable-output-conflict", artifact_ref, "representation output already exists with different bytes",
        ),
      )
    }
  } else {
    match write_text(artifact_path, text) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
  }
  Ok([artifact_ref])
}

///|
fn mock_backend_qualification() -> Json {
  {
    "selected_backend": "deterministic-mock-reference",
    "evidence_class": "fixture-reference-only",
    "production_qualified": false,
    "blender_evidence": false,
    "physical_authority": false,
  }
}

///|
fn spatial_receipt_from_execution(
  request : @suite_adapter.MoonflowAdapterRequest,
  spatial : @suite_adapter.SpatialOperationRequest,
  root_receipt : @moonmold.AdapterReceipt,
  artifacts : Array[String],
) -> Json {
  let contract = @suite_adapter.find_operation_contract(request.operation).unwrap()
  let warnings = root_receipt.warnings.copy()
  warnings.push(
    "deterministic mock output is reference evidence, not Blender evidence",
  )
  {
    "contract_id": "moonmold.spatial-operation-receipt.v1",
    "operation_ref": "moonmold/\{contract.operation_id}@0.2.0",
    "request_id": request.request_id,
    "source_request_id": spatial.request_id,
    "attempt_id": request.attempt_id,
    "idempotency_key": request.idempotency_key,
    "outcome": outcome_id(root_receipt.outcome),
    "before_digest": root_receipt.before_digest,
    "after_digest": root_receipt.after_digest,
    "claim_ceiling": contract.claim_ceiling,
    "physical_authority": false,
    "artifacts": artifacts,
    "changed_objects": root_receipt.changed_objects,
    "warnings": warnings,
    "validation_evidence": root_receipt.evidence,
    "backend_qualification": mock_backend_qualification(),
    "review_required": contract.review_required,
    "reconciliation": { "supported": true, "state": "terminal" },
  }
}

///|
fn validation_receipt(
  request : @suite_adapter.MoonflowAdapterRequest,
  source_request_id : String,
  subject_digest : String,
  accepted : Bool,
  findings : Array[Json],
) -> Json {
  let contract = @suite_adapter.find_operation_contract(request.operation).unwrap()
  {
    "contract_id": "moonmold.spatial-operation-receipt.v1",
    "operation_ref": "moonmold/\{contract.operation_id}@0.2.0",
    "request_id": request.request_id,
    "source_request_id": source_request_id,
    "attempt_id": request.attempt_id,
    "idempotency_key": request.idempotency_key,
    "outcome": if accepted {
      "applied"
    } else {
      "rejected"
    },
    "before_digest": subject_digest,
    "after_digest": subject_digest,
    "claim_ceiling": contract.claim_ceiling,
    "physical_authority": false,
    "artifacts": [],
    "changed_objects": [],
    "warnings": [],
    "validation_evidence": {
      "validator": "moonmold-pack-local-validator",
      "validator_version": "1",
      "subject_digest": subject_digest,
      "accepted": accepted,
      "findings": findings,
    },
    "backend_qualification": mock_backend_qualification(),
    "review_required": contract.review_required,
    "reconciliation": { "supported": true, "state": "terminal" },
  }
}

///|
fn representation_validation_receipt(
  request : @suite_adapter.MoonflowAdapterRequest,
  artifact : Json,
  observed_digest : String,
) -> Json {
  let findings : Array[Json] = []
  let mut accepted = true
  match artifact {
    {
      "contract_id": String("moonmold.spatial-artifact.v1"),
      "artifact_id": String(artifact_id),
      "representation": String(representation),
      "digest": String(digest),
      "known_losses": Array(losses),
      "claim_ceiling": String(claim_ceiling),
      "physical_authority": False,
      ..
    } => {
      if artifact_id.is_blank() || digest.is_blank() {
        accepted = false
        findings.push({
          "code": "missing-artifact-identity",
          "severity": "error",
          "message": "artifact identity and digest must be explicit",
        })
      }
      if representation
        is ("presentation" | "simulation" | "manufacturing-candidate") &&
        losses.is_empty() {
        accepted = false
        findings.push({
          "code": "undeclared-representation-loss",
          "severity": "error",
          "message": "derived siblings must declare representation losses",
        })
      }
      if representation == "manufacturing-candidate" &&
        claim_ceiling != "analysis-only-no-machine-authority" {
        accepted = false
        findings.push({
          "code": "manufacturing-overclaim",
          "severity": "error",
          "message": "manufacturing candidates cannot grant fabrication authority",
        })
      }
    }
    _ => {
      accepted = false
      findings.push({
        "code": "invalid-spatial-artifact",
        "severity": "error",
        "message": "input does not match moonmold.spatial-artifact.v1",
      })
    }
  }
  validation_receipt(
    request, "representation", observed_digest, accepted, findings,
  )
}

///|
fn result_for_receipt(
  request : @suite_adapter.MoonflowAdapterRequest,
  receipt : Json,
  artifacts : Array[String],
) -> @suite_adapter.AdapterResult {
  let receipt_text = receipt.stringify(indent=2) + "\n"
  {
    result_id: "result-\{request.attempt_id}-succeeded",
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    idempotency_key: request.idempotency_key,
    product_id: "moonmold",
    external_job_id: "moonmold-\{request.attempt_id}",
    status: "succeeded",
    output_digest: sha256_text(receipt_text),
    output_artifacts: [receipt_ref(request.attempt_id), ..artifacts],
    error_kind: "",
    compensable: true,
    recorded_at: request.created_at,
  }
}

///|
fn started_attempt(
  request : @suite_adapter.MoonflowAdapterRequest,
) -> @suite_adapter.AttemptRecord {
  {
    contract_id: "moonmold.adapter-attempt.v1",
    adapter_id: @suite_adapter.adapter_id(),
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    idempotency_key: request.idempotency_key,
    operation_id: canonical_operation_id(request.operation),
    status: "started",
    request_ref: request_ref(request.attempt_id),
    input_ref: input_ref(request.attempt_id),
    receipt_ref: receipt_ref(request.attempt_id),
    result_ref: result_ref(request.attempt_id),
    started_at: request.created_at,
    updated_at: request.created_at,
  }
}

///|
fn persist_attempt_start(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
  input : Json,
) -> Result[Unit, AdapterRuntimeIssue] {
  for
    item in [
      (request_ref(request.attempt_id), request.to_json()),
      (input_ref(request.attempt_id), input),
      (attempt_ref(request.attempt_id), started_attempt(request).to_json()),
    ] {
    let (reference, value) = item
    let path = match resolve_ref(workspace_root, reference) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    match write_json(path, value) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
  }
  Ok(())
}

///|
fn persist_terminal(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
  receipt : Json,
  result : @suite_adapter.AdapterResult,
) -> Result[Unit, AdapterRuntimeIssue] {
  let receipt_path = match
    resolve_ref(workspace_root, receipt_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let result_path = match
    resolve_ref(workspace_root, result_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let attempt_path = match
    resolve_ref(workspace_root, attempt_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  match write_json(receipt_path, receipt) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  match write_json(result_path, result.to_json()) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let terminal = {
    ..started_attempt(request),
    status: "succeeded",
    updated_at: request.created_at,
  }
  write_json(attempt_path, terminal.to_json())
}

///|
pub fn invoke(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
) -> Result[@suite_adapter.AdapterResult, AdapterRuntimeIssue] {
  let issues = request_issues(request)
  if !issues.is_empty() {
    return Err(
      issue("invalid-adapter-request", request.operation, issues.join("; ")),
    )
  }
  let (_, observed_digest, input) = match load_input(workspace_root, request) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let aggregate_input_digest = match
    input_artifact_set_digest(workspace_root, request.input_artifacts) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if aggregate_input_digest != request.input_digest {
    return Err(
      issue(
        "input-digest-mismatch",
        request.input_artifacts[0],
        "MoonFlow input_digest does not match the ordered input artifact set",
      ),
    )
  }
  let result_path = match
    resolve_ref(workspace_root, result_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if @fsx.path_exists(result_path) {
    return read_typed(result_path)
  }
  let attempt_path = match
    resolve_ref(workspace_root, attempt_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if @fsx.path_exists(attempt_path) {
    return Err(
      issue(
        "reconciliation-required",
        attempt_ref(request.attempt_id),
        "attempt already started; reconcile it before any retry",
      ),
    )
  }
  match persist_attempt_start(workspace_root, request, input) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let operation_id = canonical_operation_id(request.operation)
  let (receipt, artifacts) = if operation_id == "representation.validate" {
    (representation_validation_receipt(request, input, observed_digest), [])
  } else {
    let spatial = try
      @suite_adapter.decode_spatial_operation_request(input)
    catch {
      error =>
        return Err(
          issue(
            "invalid-spatial-request",
            input_ref(request.attempt_id),
            "spatial request is invalid: \{error}",
          ),
        )
    } noraise {
      value => value
    }
    if spatial.contract_id != "moonmold.spatial-operation-request.v1" {
      return Err(
        issue(
          "invalid-spatial-request",
          input_ref(request.attempt_id),
          "unsupported spatial request contract",
        ),
      )
    }
    let mapped = match adapter_request(workspace_root, request, spatial) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    if operation_id == "spatial.operation.validate" {
      try @moonmold.validate_request(mapped) catch {
        error => {
          let finding : Json = {
            "code": "semantic-request-rejected",
            "severity": "error",
            "message": "\{to_repr(error)}",
          }
          (
            validation_receipt(
              request,
              spatial.request_id,
              observed_digest,
              false,
              [finding],
            ),
            [],
          )
        }
      } noraise {
        _ =>
          (
            validation_receipt(
              request,
              spatial.request_id,
              observed_digest,
              true,
              [],
            ),
            [],
          )
      }
    } else {
      if spatial.backend_preference != "" &&
        spatial.backend_preference != "mock-reference" {
        return Err(
          issue(
            "provider-not-qualified",
            spatial.backend_preference,
            "live Blender remains a separately qualified provider; the MoonBit adapter never substitutes mock evidence",
          ),
        )
      }
      let journal = match load_journal(workspace_root) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let backend = match replay_backend(workspace_root, journal) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let root_receipt = try backend.execute(mapped) catch {
        error =>
          return Err(
            issue(
              "semantic-execution-rejected",
              request.operation,
              "semantic operation was rejected: \{to_repr(error)}",
            ),
          )
      } noraise {
        value => value
      }
      let output_artifacts = match
        materialize_representation(
          workspace_root,
          spatial,
          mapped.operation,
          root_receipt,
        ) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let entry : Json = { "flow_request": request, "spatial_request": spatial }
      journal.push(entry)
      match save_journal(workspace_root, journal) {
        Ok(_) => ()
        Err(error) => return Err(error)
      }
      (
        spatial_receipt_from_execution(
          request, spatial, root_receipt, output_artifacts,
        ),
        output_artifacts,
      )
    }
  }
  let result = result_for_receipt(request, receipt, artifacts)
  match persist_terminal(workspace_root, request, receipt, result) {
    Ok(_) => Ok(result)
    Err(error) => Err(error)
  }
}
