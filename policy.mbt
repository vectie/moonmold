///|
fn absolute_path_is_canonical(value : String) -> Bool {
  if !value.has_prefix("/") ||
    value == "/" ||
    value.has_suffix("/") ||
    value.contains("\\") ||
    value.contains("\u0000") {
    return false
  }
  value[1:]
  .split("/")
  .all(segment => segment != "" && segment != "." && segment != "..")
}

///|
pub fn is_moonsuite_workspace_root(root : String) -> Bool {
  absolute_path_is_canonical(root)
}

///|
pub fn is_scoped_output_path(root : String, path : String) -> Bool {
  is_moonsuite_workspace_root(root) &&
  absolute_path_is_canonical(path) &&
  path.has_prefix(root + "/")
}

///|
fn operation_claim_ceiling(operation : SemanticOperation) -> String {
  match operation {
    ValidateScene => "digital-validation-evidence"
    ExportRepresentation(representation=ManufacturingCandidate, ..) =>
      "digital-manufacturing-candidate"
    ExportRepresentation(representation=Engineering, ..) =>
      "derived-engineering-representation"
    ExportRepresentation(..) => "derived-digital-representation"
    _ => "editable-digital-model"
  }
}

///|
/// Classifies the authority boundary without performing IO. MoonMold owns
/// digital model mutation and validation only. External and physical effects
/// remain host-owned even when a manufacturing candidate is being prepared.
pub fn request_responsibility(
  request : AdapterRequest,
) -> RequestResponsibility {
  match request.authority {
    Observe | CognitiveMaintenance | SandboxExecution | WorkspaceMutation =>
      {
        owner_product: "moonmold",
        disposition: "execute-digital-operation",
        claim_ceiling: operation_claim_ceiling(request.operation),
        reasons: [],
      }
    ExternalEffect =>
      {
        owner_product: "host/moongate",
        disposition: "separate-authority-required",
        claim_ceiling: "no-external-effect",
        reasons: ["MoonMold does not own external-effect authority"],
      }
    PhysicalEffect =>
      {
        owner_product: "host/moongate",
        disposition: "reject",
        claim_ceiling: "no-physical-readiness-claim",
        reasons: ["MoonMold never authorizes fabrication or physical motion"],
      }
  }
}

///|
pub fn validate_transport_method(
  method_name : String,
) -> Unit raise AdapterError {
  match method_name {
    "capability.discover"
    | "scene.create-model"
    | "scene.create-box"
    | "scene.create-cylinder"
    | "scene.set-transform"
    | "scene.assign-material"
    | "scene.boolean-subtract"
    | "scene.validate"
    | "representation.export" => ()
    _ => raise UnsupportedTransportMethod(method_name)
  }
}

///|
pub fn validate_request(request : AdapterRequest) -> Unit raise AdapterError {
  if request.project_id is "" ||
    request.session_id is "" ||
    request.model_id is "" ||
    request.request_id is "" ||
    request.idempotency_key is "" {
    raise InvalidIdentity("identity fields must be non-empty")
  }
  if request.deadline_ms <= 0 || request.deadline_ms > 120000 {
    raise InvalidDeadline(request.deadline_ms)
  }
  let responsibility = request_responsibility(request)
  if responsibility.disposition != "execute-digital-operation" {
    raise AuthorityExceeded(request.authority)
  }
  if !is_moonsuite_workspace_root(request.workspace_root) {
    raise WorkspaceBoundaryViolation(request.workspace_root)
  }
  match request.operation {
    ExportRepresentation(output_path~, ..) =>
      if !is_scoped_output_path(request.workspace_root, output_path) {
        raise WorkspaceBoundaryViolation(output_path)
      }
    CreateModel(name~, units~, coordinate_frame~) =>
      if name is "" || units is "" || coordinate_frame is "" {
        raise InvalidOperation("model metadata must be explicit")
      }
    CreateBox(object_id~, width_mm~, depth_mm~, height_mm~) =>
      if object_id is "" || width_mm <= 0 || depth_mm <= 0 || height_mm <= 0 {
        raise InvalidOperation("box dimensions must be positive")
      }
    CreateCylinder(object_id~, radius_mm~, height_mm~, sides~) =>
      if object_id is "" || radius_mm <= 0 || height_mm <= 0 || sides < 8 {
        raise InvalidOperation(
          "cylinder requires positive dimensions and at least 8 sides",
        )
      }
    SetTransform(object_id~, ..) | AssignMaterial(object_id~, ..) =>
      if object_id is "" {
        raise InvalidOperation("object identity must be explicit")
      }
    BooleanSubtract(target_id~, cutter_id~) =>
      if target_id is "" || cutter_id is "" || target_id == cutter_id {
        raise InvalidOperation("boolean operands must be distinct")
      }
    ValidateScene => ()
  }
}
