///|
fn safe_health_suffix(value : String) -> String {
  value
  .replace(old=":", new="-")
  .replace(old="/", new="-")
  .replace(old=" ", new="-")
}

///|
fn blender_qualification(workspace_root : String) -> Json {
  let reference = "tools/blender/runtime-manifest.json"
  let path = match resolve_ref(workspace_root, reference) {
    Ok(value) => value
    Err(_) => ""
  }
  if path == "" || !@fsx.path_exists(path) {
    return {
      "status": "not-installed",
      "manifest_ref": reference,
      "adapter_route_ready": false,
      "evidence_class": "none",
    }
  }
  match read_json(path) {
    Ok(
      {
        "contract_id": String("moonsuite.workspace-tool-runtime.v1"),
        "tool_id": String("blender"),
        "physical_effects": False,
        ..
      }
    ) =>
      {
        "status": "conditionally-discovered",
        "manifest_ref": reference,
        "adapter_route_ready": false,
        "evidence_class": "manifest-only",
        "message": "fixed Blender bridge still requires a live provider qualification run",
      }
    _ =>
      {
        "status": "invalid-manifest",
        "manifest_ref": reference,
        "adapter_route_ready": false,
        "evidence_class": "none",
      }
  }
}

///|
pub fn health_attestation(
  workspace_root : String,
  checked_at : String,
  valid_until : String,
) -> Result[@suite_adapter.AdapterHealthAttestation, AdapterRuntimeIssue] {
  let evidence_ref = ".moonsuite/products/moonmold/adapter-health/\{@suite_adapter.adapter_id()}-\{safe_health_suffix(checked_at)}.json"
  let evidence_path = match resolve_ref(workspace_root, evidence_ref) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let state_root = parent_dir(
    match resolve_ref(workspace_root, journal_ref()) {
      Ok(value) => value
      Err(error) => return Err(error)
    },
  )
  match ensure_directory_tree(state_root) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let evidence : Json = {
    "contract_id": "moonmold.adapter-health-evidence.v1",
    "adapter_id": @suite_adapter.adapter_id(),
    "pack_version": @suite_adapter.pack_version(),
    "protocol": @suite_adapter.adapter_protocol(),
    "checked_at": checked_at,
    "valid_until": valid_until,
    "operation_refs": @suite_adapter.operation_refs(),
    "semantic_runtime": {
      "status": "healthy",
      "backend": "deterministic-mock-reference",
      "evidence_class": "fixture-reference-only",
      "production_qualified": false,
      "physical_authority": false,
    },
    "blender_provider": blender_qualification(workspace_root),
    "capability": @suite_adapter.moonflow_adapter_capability_json(),
  }
  let evidence_text = evidence.stringify(indent=2) + "\n"
  match write_text(evidence_path, evidence_text) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  Ok({
    contract_id: "moonflow.adapter-health.v1",
    adapter_id: @suite_adapter.adapter_id(),
    product_id: "moonmold",
    pack_id: "moonmold",
    pack_version: @suite_adapter.pack_version(),
    protocol: @suite_adapter.adapter_protocol(),
    status: "healthy",
    checked_at,
    valid_until,
    operation_refs: @suite_adapter.operation_refs(),
    evidence_ref,
    evidence_digest: sha256_text(evidence_text),
  })
}

///|
pub fn capability_source_bundle(
  pack_manifest : Json,
  workspace_root : String,
  compiled_at : String,
  valid_until : String,
) -> Result[Json, AdapterRuntimeIssue] {
  let health = match
    health_attestation(workspace_root, compiled_at, valid_until) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  Ok({
    "contract_id": "moonflow.capability-source-bundle.v1",
    "catalog_id": "moonmold-\{safe_health_suffix(compiled_at)}",
    "compiled_at": compiled_at,
    "pack_manifests": [pack_manifest],
    "adapter_declarations": [@suite_adapter.adapter_declaration_json()],
    "health_attestations": [health],
  })
}
