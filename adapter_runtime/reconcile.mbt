///|
fn unknown_result(
  request : @suite_adapter.MoonflowAdapterRequest,
  status : String,
  error_kind : String,
) -> @suite_adapter.AdapterResult {
  {
    result_id: "result-\{request.attempt_id}-\{status}",
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    idempotency_key: request.idempotency_key,
    product_id: "moonmold",
    external_job_id: "",
    status,
    output_digest: "",
    output_artifacts: [],
    error_kind,
    compensable: status == "not-applied",
    recorded_at: request.created_at,
  }
}

///|
fn receipt_artifacts(receipt : Json) -> Array[String] {
  match receipt {
    { "artifacts": Array(values), .. } =>
      values.filter_map(value => {
        match value {
          String(reference) => Some(reference)
          _ => None
        }
      })
    _ => []
  }
}

///|
fn persist_reconciliation(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
  report : @suite_adapter.ReconciliationReport,
) -> Result[@suite_adapter.ReconciliationReport, AdapterRuntimeIssue] {
  let path = match
    resolve_ref(workspace_root, reconciliation_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  match write_json(path, report.to_json()) {
    Ok(_) => Ok(report)
    Err(error) => Err(error)
  }
}

///|
fn report(
  request : @suite_adapter.MoonflowAdapterRequest,
  decision : String,
  retry_allowed : Bool,
  evidence_refs : Array[String],
  result : @suite_adapter.AdapterResult,
  message : String,
) -> @suite_adapter.ReconciliationReport {
  {
    contract_id: "moonflow.adapter-reconciliation.v1",
    adapter_id: @suite_adapter.adapter_id(),
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    decision,
    retry_allowed,
    evidence_refs,
    result,
    message,
    recorded_at: request.created_at,
  }
}

///|
fn journal_contains_attempt(
  journal : Array[Json],
  request : @suite_adapter.MoonflowAdapterRequest,
) -> Bool {
  journal.any(entry => {
    match decode_journal_entry(entry) {
      Ok((flow, _)) =>
        flow.attempt_id == request.attempt_id &&
        flow.idempotency_key == request.idempotency_key &&
        flow.request_id == request.request_id
      Err(_) => false
    }
  })
}

///|
fn recover_executed_attempt(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
  journal : Array[Json],
) -> Result[@suite_adapter.AdapterResult, AdapterRuntimeIssue] {
  let (_, _, input) = match load_input(workspace_root, request) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let spatial = try
    @suite_adapter.decode_spatial_operation_request(input)
  catch {
    error =>
      return Err(
        issue(
          "invalid-spatial-request",
          input_ref(request.attempt_id),
          "cannot recover malformed spatial request: \{error}",
        ),
      )
  } noraise {
    value => value
  }
  let mapped = match adapter_request(workspace_root, request, spatial) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let backend = match replay_backend(workspace_root, journal) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let recovered = try backend.execute(mapped) catch {
    error =>
      return Err(
        issue(
          "recovery-replay-failed",
          request.operation,
          "journaled operation cannot be reconciled: \{to_repr(error)}",
        ),
      )
  } noraise {
    value => value
  }
  let artifacts = match
    materialize_representation(
      workspace_root,
      spatial,
      mapped.operation,
      recovered,
    ) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let receipt = spatial_receipt_from_execution(
    request, spatial, recovered, artifacts,
  )
  let result = result_for_receipt(request, receipt, artifacts)
  match persist_terminal(workspace_root, request, receipt, result) {
    Ok(_) => Ok(result)
    Err(error) => Err(error)
  }
}

///|
pub fn reconcile(
  workspace_root : String,
  request : @suite_adapter.MoonflowAdapterRequest,
) -> Result[@suite_adapter.ReconciliationReport, AdapterRuntimeIssue] {
  let issues = request_issues(request)
  if !issues.is_empty() {
    return Err(
      issue("invalid-adapter-request", request.operation, issues.join("; ")),
    )
  }
  let result_path = match
    resolve_ref(workspace_root, result_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if @fsx.path_exists(result_path) {
    let result : @suite_adapter.AdapterResult = match read_typed(result_path) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    return persist_reconciliation(
      workspace_root,
      request,
      report(
        request,
        if result.status == "succeeded" {
          "recovered-succeeded"
        } else {
          "recovered-failed"
        },
        false,
        [result_ref(request.attempt_id)],
        result,
        "terminal adapter result was already durable",
      ),
    )
  }
  let receipt_path = match
    resolve_ref(workspace_root, receipt_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if @fsx.path_exists(receipt_path) {
    let receipt = match read_json(receipt_path) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    let result = result_for_receipt(
      request,
      receipt,
      receipt_artifacts(receipt),
    )
    match persist_terminal(workspace_root, request, receipt, result) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
    return persist_reconciliation(
      workspace_root,
      request,
      report(
        request,
        "recovered-succeeded",
        false,
        [receipt_ref(request.attempt_id), result_ref(request.attempt_id)],
        result,
        "terminal operation receipt recovered the missing adapter result",
      ),
    )
  }
  let attempt_path = match
    resolve_ref(workspace_root, attempt_ref(request.attempt_id)) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  if !@fsx.path_exists(attempt_path) {
    return persist_reconciliation(
      workspace_root,
      request,
      report(
        request,
        "not-applied",
        true,
        [],
        unknown_result(request, "not-applied", ""),
        "no attempt or effect evidence exists",
      ),
    )
  }
  if canonical_operation_id(request.operation) == "spatial.operation.execute" {
    let journal = match load_journal(workspace_root) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    if journal_contains_attempt(journal, request) {
      let result = match
        recover_executed_attempt(workspace_root, request, journal) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      return persist_reconciliation(
        workspace_root,
        request,
        report(
          request,
          "recovered-succeeded",
          false,
          [
            journal_ref(),
            receipt_ref(request.attempt_id),
            result_ref(request.attempt_id),
          ],
          result,
          "durable semantic journal recovered the interrupted terminal write",
        ),
      )
    }
  }
  persist_reconciliation(
    workspace_root,
    request,
    report(
      request,
      "not-applied",
      true,
      [attempt_ref(request.attempt_id)],
      unknown_result(request, "not-applied", ""),
      "attempt started but no semantic journal or terminal effect evidence exists",
    ),
  )
}
