///|
struct AppliedRequest {
  idempotency_key : String
  request_fingerprint : String
  receipt : AdapterReceipt
}

///|
pub struct MockBackend {
  mut scene_digest : String
  applied : Array[AppliedRequest]
}

///|
pub fn MockBackend::new(
  initial_digest? : String = "mm1-empty-scene",
) -> MockBackend {
  { scene_digest: initial_digest, applied: [] }
}

///|
pub fn MockBackend::scene_digest(self : MockBackend) -> String {
  self.scene_digest
}

///|
fn operation_fingerprint(operation : SemanticOperation) -> String {
  deterministic_manifest_key(to_repr(operation).to_string())
}

///|
fn changed_objects(operation : SemanticOperation) -> Array[String] {
  match operation {
    CreateModel(..) | ValidateScene | ExportRepresentation(..) => []
    CreateBox(object_id~, ..)
    | CreateCylinder(object_id~, ..)
    | SetTransform(object_id~, ..)
    | AssignMaterial(object_id~, ..) => [object_id]
    BooleanSubtract(target_id~, cutter_id~) => [target_id, cutter_id]
  }
}

///|
fn accepted_evidence(subject_digest : String) -> ValidationEvidence {
  {
    validator: "moonmold-mock-validator",
    validator_version: "1",
    subject_digest,
    accepted: true,
    findings: [],
  }
}

///|
pub fn MockBackend::execute(
  self : MockBackend,
  request : AdapterRequest,
) -> AdapterReceipt raise AdapterError {
  validate_request(request)
  let fingerprint = operation_fingerprint(request.operation)
  for prior in self.applied {
    if prior.idempotency_key == request.idempotency_key {
      if prior.request_fingerprint != fingerprint {
        raise ConflictingIdempotencyKey(request.idempotency_key)
      }
      let old = prior.receipt
      return {
        request_id: request.request_id,
        idempotency_key: request.idempotency_key,
        outcome: IdempotentNoOp,
        before_digest: old.after_digest,
        after_digest: old.after_digest,
        changed_objects: [],
        warnings: ["identical completed request was not applied twice"],
        evidence: old.evidence,
      }
    }
  }
  if request.expected_parent_digest != self.scene_digest {
    raise StaleParent(
      expected=request.expected_parent_digest,
      actual=self.scene_digest,
    )
  }
  let before = self.scene_digest
  let after = deterministic_manifest_key(
    "scene-v1\nparent=\{before}\noperation=\{to_repr(request.operation)}\n",
  )
  let receipt : AdapterReceipt = {
    request_id: request.request_id,
    idempotency_key: request.idempotency_key,
    outcome: Applied,
    before_digest: before,
    after_digest: after,
    changed_objects: changed_objects(request.operation),
    warnings: [],
    evidence: accepted_evidence(after),
  }
  self.scene_digest = after
  self.applied.push({
    idempotency_key: request.idempotency_key,
    request_fingerprint: fingerprint,
    receipt,
  })
  receipt
}
