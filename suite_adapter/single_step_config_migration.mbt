///|
/// Translate the pack-specific legacy configuration without changing any path,
/// executable identity, grant or budget. The caller reviews and persists it.
pub fn migrate_single_step_config_v2(value : Json) -> Json raise {
  let fields = wire_object(value, "legacy single-step configuration")
  guard wire_string(fields, "contract_id") == "moonflow.single-step-config.v1" &&
    !fields.contains("adapter_executable") &&
    !fields.contains("adapter_sha256") else {
    fail("migration requires an unambiguous legacy single-step config")
  }
  {
    "contract_id": "moonflow.single-step-config.v2",
    "capability_ref": wire_string(fields, "capability_ref"),
    "envelope_ref": wire_string(fields, "envelope_ref"),
    "usage_ref": wire_string(fields, "usage_ref"),
    "gate_executable": wire_string(fields, "gate_executable"),
    "gate_sha256": wire_string(fields, "gate_sha256"),
    "adapter_executable": wire_string(fields, "mold_executable"),
    "adapter_sha256": wire_string(fields, "mold_sha256"),
  }
}
