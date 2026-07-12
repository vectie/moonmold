///|
fn contains_forbidden_segment(value : String) -> Bool {
  value.contains("..") || value.contains("\u0000")
}

///|
pub fn is_moonsuite_workspace_root(root : String) -> Bool {
  root == "/Users/kq/moonsuite" || root.has_prefix("/Users/kq/moonsuite/")
}

///|
pub fn is_scoped_output_path(root : String, path : String) -> Bool {
  is_moonsuite_workspace_root(root) &&
  !contains_forbidden_segment(path) &&
  path.has_prefix(root + "/")
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
  match request.authority {
    Observe | CognitiveMaintenance | SandboxExecution | WorkspaceMutation => ()
    ExternalEffect | PhysicalEffect =>
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
