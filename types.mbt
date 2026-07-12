///|
/// A representation is a declared view of spatial truth, never an implicit
/// upgrade in authority.
pub(all) enum RepresentationKind {
  ReferenceSet
  SpatialIntent
  EditableSource
  Engineering
  Presentation
  Simulation
  ManufacturingCandidate
} derive(Debug, Eq, ToJson)

///|
/// Portable lineage relations used by MoonBook, MoonTown, MoonRobo, and
/// MoonMoon. Consumers may preserve additional domain-specific relations.
pub(all) enum LineageRelation {
  InterpretedFrom
  ModeledFrom
  DimensionedBy
  StyledFrom
  OptimizedFrom
  CollisionDerivedFrom
  PhysicsDerivedFrom
  ManufacturingDerivedFrom
  ValidatedBy
  RejectedBy
  SupersededBy
  PlacedAs
  SimulatedAs
} derive(Debug, Eq, ToJson)

///|
/// MoonMold's initial authority ceiling is digital and workspace-local.
pub(all) enum AuthorityClass {
  Observe
  CognitiveMaintenance
  SandboxExecution
  WorkspaceMutation
  ExternalEffect
  PhysicalEffect
} derive(Debug, Eq, ToJson)

///|
/// A finding is machine-readable while keeping a useful human explanation.
pub(all) enum FindingSeverity {
  Info
  Warning
  Error
} derive(Debug, Eq, ToJson)

///|
pub(all) struct ValidationFinding {
  code : String
  severity : FindingSeverity
  message : String
  criterion : String
} derive(Debug, Eq, ToJson)

///|
pub(all) struct ValidationEvidence {
  validator : String
  validator_version : String
  subject_digest : String
  accepted : Bool
  findings : Array[ValidationFinding]
} derive(Debug, Eq, ToJson)

///|
/// Artifact fields are intentionally close to MoonLib's portable contract:
/// identity, representation class, parent lineage, declared losses, units,
/// coordinate frame, digest, and validation stay explicit.
pub struct SpatialArtifact {
  artifact_id : String
  representation : RepresentationKind
  digest : String
  units : String
  coordinate_frame : String
  parent_digest : String?
  relation : LineageRelation?
  known_losses : Array[String]
}

///|
pub fn new_artifact(
  artifact_id~ : String,
  representation~ : RepresentationKind,
  digest~ : String,
  units~ : String,
  coordinate_frame~ : String,
  parent_digest~ : String?,
  relation~ : LineageRelation?,
  known_losses~ : Array[String],
) -> SpatialArtifact {
  {
    artifact_id,
    representation,
    digest,
    units,
    coordinate_frame,
    parent_digest,
    relation,
    known_losses,
  }
}

///|
pub fn SpatialArtifact::artifact_id(self : SpatialArtifact) -> String {
  self.artifact_id
}

///|
pub fn SpatialArtifact::representation(
  self : SpatialArtifact,
) -> RepresentationKind {
  self.representation
}

///|
pub fn SpatialArtifact::digest(self : SpatialArtifact) -> String {
  self.digest
}

///|
pub fn SpatialArtifact::units(self : SpatialArtifact) -> String {
  self.units
}

///|
pub fn SpatialArtifact::coordinate_frame(self : SpatialArtifact) -> String {
  self.coordinate_frame
}

///|
pub fn SpatialArtifact::parent_digest(self : SpatialArtifact) -> String? {
  self.parent_digest
}

///|
pub fn SpatialArtifact::relation(self : SpatialArtifact) -> LineageRelation? {
  self.relation
}

///|
pub fn SpatialArtifact::known_losses(self : SpatialArtifact) -> Array[String] {
  self.known_losses.copy()
}

///|
/// This is a representation-shape predicate, not validation or permission to
/// replace an accepted engineering artifact.
pub fn SpatialArtifact::is_lossless_engineering_representation(
  self : SpatialArtifact,
) -> Bool {
  self.representation == Engineering && self.known_losses.is_empty()
}

///|
pub fn derive_artifact(
  parent : SpatialArtifact,
  artifact_id~ : String,
  representation~ : RepresentationKind,
  digest~ : String,
  relation~ : LineageRelation,
  known_losses~ : Array[String],
) -> SpatialArtifact {
  new_artifact(
    artifact_id~,
    representation~,
    digest~,
    units=parent.units,
    coordinate_frame=parent.coordinate_frame,
    parent_digest=Some(parent.digest),
    relation=Some(relation),
    known_losses~,
  )
}
