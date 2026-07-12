///|
fn representation_name(kind : RepresentationKind) -> String {
  match kind {
    ReferenceSet => "reference-set"
    SpatialIntent => "spatial-intent"
    EditableSource => "editable-source"
    Engineering => "engineering"
    Presentation => "presentation"
    Simulation => "simulation"
    ManufacturingCandidate => "manufacturing-candidate"
  }
}

///|
fn relation_name(relation : LineageRelation) -> String {
  match relation {
    InterpretedFrom => "interpreted-from"
    ModeledFrom => "modeled-from"
    DimensionedBy => "dimensioned-by"
    StyledFrom => "styled-from"
    OptimizedFrom => "optimized-from"
    CollisionDerivedFrom => "collision-derived-from"
    PhysicsDerivedFrom => "physics-derived-from"
    ManufacturingDerivedFrom => "manufacturing-derived-from"
    ValidatedBy => "validated-by"
    RejectedBy => "rejected-by"
    SupersededBy => "superseded-by"
    PlacedAs => "placed-as"
    SimulatedAs => "simulated-as"
  }
}

///|
/// Canonical manifests use fixed field order and preserve declared loss order.
/// The format is stable text so other Moon Suite products can hash or sign it.
pub fn SpatialArtifact::canonical_manifest(self : SpatialArtifact) -> String {
  let parent = match self.parent_digest {
    Some(value) => value
    None => "none"
  }
  let relation = match self.relation {
    Some(value) => relation_name(value)
    None => "none"
  }
  let losses = self.known_losses.join("|")
  "moonmold-manifest-v1\nartifact-id=\{self.artifact_id}\nrepresentation=\{representation_name(self.representation)}\ndigest=\{self.digest}\nunits=\{self.units}\ncoordinate-frame=\{self.coordinate_frame}\nparent-digest=\{parent}\nrelation=\{relation}\nknown-losses=\{losses}\n"
}

///|
/// A deterministic integrity key. This deliberately calls itself `mm1`, not
/// SHA-256: it is stable addressing for manifests, not a cryptographic claim.
pub fn deterministic_manifest_key(canonical : String) -> String {
  let modulus = 16777213
  let hash = canonical.fold(init=216613, (acc, char) => {
    (acc * 31 + char.to_int()) % modulus
  })
  "mm1-\{hash}"
}

///|
pub fn SpatialArtifact::manifest_key(self : SpatialArtifact) -> String {
  deterministic_manifest_key(self.canonical_manifest())
}
