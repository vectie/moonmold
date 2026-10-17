///|
/// Read-only verification consumes explicit evidence and never invokes an
/// operation, touches the semantic journal, or starts another process.
fn verified_exchange_json(
  root : String,
  fields : Map[String, Json],
  reference_key : String,
  digest_key : String,
) -> Json raise {
  guard fields.get(reference_key) is Some(String(reference)) &&
    fields.get(digest_key) is Some(String(digest)) else {
    fail("verification requires an explicit artifact reference and digest")
  }
  let path = match resolve_ref(root, reference) {
    Ok(path) => path
    Err(error) => fail(error.message)
  }
  let bytes = @fsx.read_file_to_bytes(path)
  guard bytes.length() <= 16 * 1024 * 1024 && sha256_bytes(bytes) == digest else {
    fail("verification artifact bytes changed or exceed the input bound")
  }
  @json.parse(@utf8.decode(bytes))
}

///|
pub fn verify_single_step(
  workspace : String,
  path : String,
) -> Result[Json, AdapterRuntimeIssue] {
  let text = @fsx.read_file_to_string(path) catch {
    _ =>
      return Err(
        issue(
          "read-verification-request", path, "verification request is unreadable",
        ),
      )
  }
  try {
    guard @utf8.encode(text).length() <= 256 * 1024 else {
      fail("verification control exchange exceeded 256 KiB")
    }
    let value = @json.parse(text)
    guard value is Object(fields) else {
      fail("verification request must be an object")
    }
    fields["primary_input"] = verified_exchange_json(
      workspace, fields, "primary_input_ref", "primary_input_sha256",
    )
    fields["health"] = verified_exchange_json(
      workspace, fields, "health_evidence_ref", "health_evidence_sha256",
    )
    if fields.get("phase") == Some(Json::string("result")) {
      guard fields.get("adapter_request") is Some(raw_request) &&
        fields.get("receipt_ref") is Some(String(receipt_ref)) else {
        fail(
          "terminal verification requires the original request and receipt reference",
        )
      }
      let request = @suite_adapter.decode_moonflow_adapter_request(raw_request)
      guard @suite_adapter.single_step_request_supported(request) &&
        receipt_ref == @suite_adapter.single_step_receipt_ref(request) else {
        fail(
          "terminal verification receipt differs from its exact owned attempt",
        )
      }
      fields["receipt"] = verified_exchange_json(
        workspace, fields, "receipt_ref", "receipt_digest",
      )
    }
    @suite_adapter.single_step_verify_exchange(value, sha256_text(text))
  } catch {
    error => Err(issue("verify-single-step", path, error.to_string()))
  } noraise {
    proof => Ok(proof)
  }
}
