///|
/// Semantic operations are the complete public modeling surface. There is no
/// ExecuteScript, Python, shell, eval, or arbitrary-code constructor.
pub(all) enum SemanticOperation {
  CreateModel(name~ : String, units~ : String, coordinate_frame~ : String)
  CreateBox(
    object_id~ : String,
    width_mm~ : Int,
    depth_mm~ : Int,
    height_mm~ : Int
  )
  CreateCylinder(
    object_id~ : String,
    radius_mm~ : Int,
    height_mm~ : Int,
    sides~ : Int
  )
  SetTransform(object_id~ : String, x_mm~ : Int, y_mm~ : Int, z_mm~ : Int)
  AssignMaterial(object_id~ : String, material_id~ : String)
  BooleanSubtract(target_id~ : String, cutter_id~ : String)
  ValidateScene
  ExportRepresentation(
    representation~ : RepresentationKind,
    output_path~ : String
  )
} derive(Debug, Eq, ToJson)

///|
pub(all) struct AdapterRequest {
  project_id : String
  session_id : String
  model_id : String
  request_id : String
  idempotency_key : String
  expected_parent_digest : String
  workspace_root : String
  deadline_ms : Int
  authority : AuthorityClass
  operation : SemanticOperation
}

///|
pub(all) enum AdapterOutcome {
  Applied
  IdempotentNoOp
  Rejected
} derive(Debug, Eq, ToJson)

///|
pub(all) struct AdapterReceipt {
  request_id : String
  idempotency_key : String
  outcome : AdapterOutcome
  before_digest : String
  after_digest : String
  changed_objects : Array[String]
  warnings : Array[String]
  evidence : ValidationEvidence
} derive(Debug, Eq, ToJson)

///|
pub(all) suberror AdapterError {
  InvalidIdentity(String)
  InvalidDeadline(Int)
  AuthorityExceeded(AuthorityClass)
  WorkspaceBoundaryViolation(String)
  StaleParent(expected~ : String, actual~ : String)
  ConflictingIdempotencyKey(String)
  UnsupportedTransportMethod(String)
  InvalidOperation(String)
} derive(Debug, Eq)
