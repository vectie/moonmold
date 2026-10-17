///|
/// Portable declaration consumed by the generic preparation host. The pack
/// owns the payload schema and the explicit reference array it permits rebinding.
pub fn input_capture_policy_json(contract : AdapterOperationContract) -> Json {
  let rebind = contract.input_schema ==
    "moonmold/spatial-operation-request@1.0.0"
  {
    "contract_id": "moonflow.input-capture-policy.v1",
    "mode": if rebind {
      "reference-array-rebind"
    } else {
      "opaque-revalidated"
    },
    "payload_contract_id": if rebind {
      "moonmold.spatial-operation-request.v1"
    } else {
      ""
    },
    "reference_array_field": if rebind {
      "reference_artifacts"
    } else {
      ""
    },
  }
}
