///|
pub fn adapter_id() -> String {
  "moonmold-pack-local-v1"
}

///|
pub fn adapter_protocol() -> String {
  "moonflow.adapter.v2"
}

///|
pub fn pack_version() -> String {
  "0.2.0"
}

///|
pub fn operation_contracts() -> Array[AdapterOperationContract] {
  [
    {
      operation_id: "spatial.operation.validate",
      authority_class: "sandbox-execution",
      input_schema: "moonmold/spatial-operation-request@1.0.0",
      output_schema: "moonmold/spatial-operation-receipt@1.0.0",
      claim_ceiling: "observation",
      review_required: false,
    },
    {
      operation_id: "spatial.operation.execute",
      authority_class: "workspace-mutation",
      input_schema: "moonmold/spatial-operation-request@1.0.0",
      output_schema: "moonmold/spatial-operation-receipt@1.0.0",
      claim_ceiling: "digital-artifact",
      review_required: true,
    },
    {
      operation_id: "representation.validate",
      authority_class: "sandbox-execution",
      input_schema: "moonmold/spatial-artifact@1.0.0",
      output_schema: "moonmold/spatial-operation-receipt@1.0.0",
      claim_ceiling: "observation",
      review_required: true,
    },
  ]
}

///|
pub fn find_operation_contract(
  operation_id : String,
) -> AdapterOperationContract? {
  let normalized = match operation_id {
    "moonmold/spatial.operation.validate@0.2.0" => "spatial.operation.validate"
    "moonmold/spatial.operation.execute@0.2.0" => "spatial.operation.execute"
    "moonmold/representation.validate@0.2.0" => "representation.validate"
    other => other
  }
  for contract in operation_contracts() {
    if contract.operation_id == normalized {
      return Some(contract)
    }
  }
  None
}

///|
pub fn operation_refs() -> Array[String] {
  operation_contracts().map(contract => {
    "moonmold/\{contract.operation_id}@\{pack_version()}"
  })
}

///|
pub fn adapter_declaration_json() -> Json {
  {
    "contract_id": "moonflow.adapter-declaration.v1",
    "adapter_id": adapter_id(),
    "product_id": "moonmold",
    "pack_id": "moonmold",
    "pack_version": pack_version(),
    "protocol": adapter_protocol(),
    "operations": operation_contracts().map(contract => {
      let item : Json = {
        "operation_id": contract.operation_id,
        "claim_ceiling": contract.claim_ceiling,
        "supports_cancel": false,
        "supports_reconcile": true,
      }
      item
    }),
  }
}

///|
pub fn moonflow_adapter_capability_json_with_health(healthy : Bool) -> Json {
  {
    "adapter_id": adapter_id(),
    "product_id": "moonmold",
    "protocol": adapter_protocol(),
    "operations": operation_contracts().map(contract => contract.operation_id),
    "authority_classes": ["sandbox-execution", "workspace-mutation"],
    "input_contracts": operation_contracts().map(contract => {
      contract.input_schema
    }),
    "output_contracts": [
      "moonmold/spatial-operation-receipt@1.0.0", "moonflow.adapter-result.v1",
    ],
    "claim_ceiling": "digital-artifact",
    "healthy": healthy,
    "supports_cancel": false,
    "supports_reconcile": true,
  }
}

///|
pub fn moonflow_adapter_capability_json() -> Json {
  moonflow_adapter_capability_json_with_health(true)
}
