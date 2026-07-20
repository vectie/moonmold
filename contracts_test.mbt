///|
fn base_request(operation : SemanticOperation) -> AdapterRequest {
  {
    project_id: "moonbook-building-1",
    session_id: "session-1",
    model_id: "model-1",
    request_id: "request-1",
    idempotency_key: "key-1",
    expected_parent_digest: "mm1-empty-scene",
    workspace_root: "/Users/kq/moonsuite",
    deadline_ms: 30000,
    authority: WorkspaceMutation,
    operation,
  }
}

///|
test "canonical manifest and key are deterministic" {
  let artifact = new_artifact(
    artifact_id="a",
    representation=Engineering,
    digest="sha256:abc",
    units="m",
    coordinate_frame="z-up-right-handed",
    parent_digest=None,
    relation=None,
    known_losses=[],
  )
  assert_eq(artifact.manifest_key(), artifact.manifest_key())
  assert_true(artifact.canonical_manifest().has_prefix("moonmold-manifest-v1"))
}

///|
test "styled artifact is a sibling with explicit losses" {
  let parent = new_artifact(
    artifact_id="source",
    representation=Engineering,
    digest="mm1-source",
    units="m",
    coordinate_frame="z-up-right-handed",
    parent_digest=None,
    relation=None,
    known_losses=[],
  )
  let child = derive_artifact(
    parent,
    artifact_id="styled",
    representation=Presentation,
    digest="mm1-styled",
    relation=StyledFrom,
    known_losses=["engineering material fidelity"],
  )
  assert_true(child.parent_digest() == Some(parent.digest()))
  assert_true(child.relation() == Some(StyledFrom))
  assert_false(child.is_lossless_engineering_representation())
}

///|
test "mock backend applies once and no-ops an identical duplicate" {
  let backend = MockBackend::new()
  let request = base_request(
    CreateBox(object_id="wall-1", width_mm=5000, depth_mm=200, height_mm=3000),
  )
  let first = backend.execute(request)
  assert_true(first.outcome == Applied)
  let duplicate = backend.execute(request)
  assert_true(duplicate.outcome == IdempotentNoOp)
  assert_eq(duplicate.after_digest, first.after_digest)
}

///|
test "stale parent fails closed" {
  let backend = MockBackend::new(initial_digest="current")
  let request = base_request(ValidateScene)
  try backend.execute(request) catch {
    StaleParent(expected~, actual~) => {
      assert_eq(expected, "mm1-empty-scene")
      assert_eq(actual, "current")
    }
    error => fail("unexpected error: \{to_repr(error)}")
  } noraise {
    _ => fail("expected stale-parent rejection")
  }
}

///|
test "conflicting duplicate fails closed" {
  let backend = MockBackend::new()
  let request = base_request(ValidateScene)
  ignore(backend.execute(request))
  let conflict = {
    ..request,
    operation: CreateModel(name="x", units="m", coordinate_frame="z-up"),
  }
  try backend.execute(conflict) catch {
    ConflictingIdempotencyKey(key) => assert_eq(key, "key-1")
    error => fail("unexpected error: \{to_repr(error)}")
  } noraise {
    _ => fail("expected conflicting-idempotency rejection")
  }
}

///|
test "paths outside moonsuite and traversal fail closed" {
  for
    path in [
      "/tmp/model.glb", "/Users/kq/moonsuite/../escape.glb", "/Users/kq/Workspace/model.glb",
    ] {
    let request = base_request(
      ExportRepresentation(representation=Presentation, output_path=path),
    )
    try validate_request(request) catch {
      WorkspaceBoundaryViolation(_) => ()
      error => fail("unexpected error: \{to_repr(error)}")
    } noraise {
      _ => fail("expected path rejection: \{path}")
    }
  }
}

///|
test "physical and external authority are not accepted" {
  let authorities : Array[AuthorityClass] = [ExternalEffect, PhysicalEffect]
  for authority in authorities {
    let request = { ..base_request(ValidateScene), authority, }
    try validate_request(request) catch {
      AuthorityExceeded(actual) => assert_true(actual == authority)
      error => fail("unexpected error: \{to_repr(error)}")
    } noraise {
      _ => fail("expected authority rejection")
    }
  }
}

///|
test "responsibility decision keeps digital claims below physical authority" {
  let manufacturing = request_responsibility(
    base_request(
      ExportRepresentation(
        representation=ManufacturingCandidate,
        output_path="/Users/kq/moonsuite/outputs/candidate.step",
      ),
    ),
  )
  assert_eq(manufacturing.owner_product, "moonmold")
  assert_eq(manufacturing.disposition, "execute-digital-operation")
  assert_eq(manufacturing.claim_ceiling, "digital-manufacturing-candidate")
  let physical = request_responsibility({
    ..base_request(ValidateScene),
    authority: PhysicalEffect,
  })
  assert_eq(physical.owner_product, "host/moongate")
  assert_eq(physical.disposition, "reject")
  assert_eq(physical.claim_ceiling, "no-physical-readiness-claim")
  assert_false(physical.reasons.is_empty())
}

///|
test "workspace boundary is portable but requires canonical absolute paths" {
  assert_true(is_moonsuite_workspace_root("/home/operator/moonsuite"))
  assert_false(is_moonsuite_workspace_root("relative/moonsuite"))
  assert_false(is_moonsuite_workspace_root("/home/operator/../escape"))
  assert_false(is_moonsuite_workspace_root("/"))
  assert_true(
    is_scoped_output_path(
      "/home/operator/moonsuite", "/home/operator/moonsuite/outputs/model.glb",
    ),
  )
  assert_false(
    is_scoped_output_path(
      "/home/operator/moonsuite", "/home/operator/moonsuite-other/model.glb",
    ),
  )
}

///|
test "script-like and unknown transport methods are rejected" {
  for
    method_name in [
      "python.exec", "script.evaluate", "shell.run", "scene.delete-all",
    ] {
    try validate_transport_method(method_name) catch {
      UnsupportedTransportMethod(actual) => assert_eq(actual, method_name)
      error => fail("unexpected error: \{to_repr(error)}")
    } noraise {
      _ => fail("expected method rejection")
    }
  }
}

///|
test "malformed primitive dimensions fail closed" {
  let request = base_request(
    CreateBox(object_id="wall", width_mm=0, depth_mm=200, height_mm=3000),
  )
  try validate_request(request) catch {
    InvalidOperation(_) => ()
    error => fail("unexpected error: \{to_repr(error)}")
  } noraise {
    _ => fail("expected dimension rejection")
  }
}
