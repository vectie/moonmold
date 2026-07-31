///|
fn json_fields(value : Json, label : String) -> Map[String, Json] raise {
  match value {
    Object(fields) => fields
    _ => fail("\{label} must be an object")
  }
}

///|
fn json_string(fields : Map[String, Json], name : String) -> String raise {
  match fields.get(name) {
    Some(String(value)) => value
    _ => fail("\{name} must be a string")
  }
}

///|
fn json_int(fields : Map[String, Json], name : String) -> Int raise {
  match fields.get(name) {
    Some(value) => @json.from_json(value)
    None => fail("\{name} is required")
  }
}

///|
fn exact_keys(
  fields : Map[String, Json],
  expected : Array[String],
) -> Unit raise {
  for name, _ in fields {
    if !expected.contains(name) {
      fail("unexpected semantic parameter: \{name}")
    }
  }
  for name in expected {
    if !fields.contains(name) {
      fail("missing semantic parameter: \{name}")
    }
  }
}

///|
fn representation_kind(value : String) -> @moonmold.RepresentationKind raise {
  match value {
    "editable-source" => EditableSource
    "engineering" => Engineering
    "presentation" => Presentation
    "simulation" => Simulation
    "manufacturing-candidate" => ManufacturingCandidate
    _ => fail("unsupported representation")
  }
}

///|
fn representation_id(kind : @moonmold.RepresentationKind) -> String {
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
fn authority_class(value : String) -> @moonmold.AuthorityClass raise {
  match value {
    "Observe" => Observe
    "CognitiveMaintenance" => CognitiveMaintenance
    "SandboxExecution" => SandboxExecution
    "WorkspaceMutation" => WorkspaceMutation
    _ => fail("unsupported spatial authority")
  }
}

///|
fn semantic_operation(
  workspace_root : String,
  operation : Json,
) -> @moonmold.SemanticOperation raise {
  let fields = json_fields(operation, "operation")
  exact_keys(fields, ["method", "params"])
  let method_name = json_string(fields, "method")
  let params = json_fields(fields["params"], "params")
  match method_name {
    "scene.create-model" => {
      exact_keys(params, ["name", "units", "coordinateFrame"])
      CreateModel(
        name=json_string(params, "name"),
        units=json_string(params, "units"),
        coordinate_frame=json_string(params, "coordinateFrame"),
      )
    }
    "scene.create-box" => {
      exact_keys(params, ["objectId", "widthMm", "depthMm", "heightMm"])
      CreateBox(
        object_id=json_string(params, "objectId"),
        width_mm=json_int(params, "widthMm"),
        depth_mm=json_int(params, "depthMm"),
        height_mm=json_int(params, "heightMm"),
      )
    }
    "scene.create-cylinder" => {
      exact_keys(params, ["objectId", "radiusMm", "heightMm", "sides"])
      CreateCylinder(
        object_id=json_string(params, "objectId"),
        radius_mm=json_int(params, "radiusMm"),
        height_mm=json_int(params, "heightMm"),
        sides=json_int(params, "sides"),
      )
    }
    "scene.set-transform" => {
      exact_keys(params, ["objectId", "xMm", "yMm", "zMm"])
      SetTransform(
        object_id=json_string(params, "objectId"),
        x_mm=json_int(params, "xMm"),
        y_mm=json_int(params, "yMm"),
        z_mm=json_int(params, "zMm"),
      )
    }
    "scene.assign-material" => {
      exact_keys(params, ["objectId", "materialId"])
      AssignMaterial(
        object_id=json_string(params, "objectId"),
        material_id=json_string(params, "materialId"),
      )
    }
    "scene.boolean-subtract" => {
      exact_keys(params, ["targetId", "cutterId"])
      BooleanSubtract(
        target_id=json_string(params, "targetId"),
        cutter_id=json_string(params, "cutterId"),
      )
    }
    "scene.validate" => {
      exact_keys(params, [])
      ValidateScene
    }
    "representation.export" => {
      exact_keys(params, ["representation", "outputPath"])
      let (_, path) = match
        output_ref(workspace_root, json_string(params, "outputPath")) {
        Ok(value) => value
        Err(error) => fail(error.message)
      }
      ExportRepresentation(
        representation=representation_kind(
          json_string(params, "representation"),
        ),
        output_path=path,
      )
    }
    _ => fail("unsupported semantic method")
  }
}

///|
fn adapter_request(
  workspace_root : String,
  flow : @suite_adapter.MoonflowAdapterRequest,
  spatial : @suite_adapter.SpatialOperationRequest,
) -> Result[@moonmold.AdapterRequest, AdapterRuntimeIssue] {
  let operation = try
    semantic_operation(workspace_root, spatial.operation)
  catch {
    error =>
      return Err(
        issue(
          "invalid-semantic-operation",
          flow.operation,
          "semantic operation is invalid: \{error}",
        ),
      )
  } noraise {
    value => value
  }
  let authority = try authority_class(spatial.authority) catch {
    error =>
      return Err(
        issue(
          "invalid-spatial-authority",
          spatial.authority,
          "spatial authority is invalid: \{error}",
        ),
      )
  } noraise {
    value => value
  }
  Ok({
    project_id: spatial.project_id,
    session_id: flow.run_id,
    model_id: spatial.model_id,
    request_id: spatial.request_id,
    idempotency_key: spatial.idempotency_key,
    expected_parent_digest: spatial.expected_parent_digest,
    workspace_root: trim_trailing_slash(workspace_root),
    deadline_ms: flow.timeout_ms,
    authority,
    operation,
  })
}
