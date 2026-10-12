///|
struct RetainedScene {
  project_id : String
  model_id : String
  workspace_parent_digest : String
  journal_digest : String
  status : String
  message : String
  objects : Array[Json]
  preview_data_url : String?
} derive(Debug)

///|
impl @json.FromJson for RetainedScene with fn from_json(
  json : Json,
  path : @json.JsonPath,
) -> RetainedScene raise @json.JsonDecodeError {
  guard json is Object(fields) else {
    raise JsonDecodeError((path, "RetainedScene: expected object"))
  }
  {
    project_id: recovery_field(fields, "project_id", path),
    model_id: recovery_field(fields, "model_id", path),
    workspace_parent_digest: recovery_field(
      fields, "workspace_parent_digest", path,
    ),
    journal_digest: recovery_field(fields, "journal_digest", path),
    status: recovery_field(fields, "status", path),
    message: recovery_field(fields, "message", path),
    objects: recovery_field(fields, "objects", path),
    preview_data_url: match fields.get("preview_data_url") {
      Some(Null) | None => None
      Some(value) =>
        Some(@json.from_json(value, path=path.add_key("preview_data_url")))
    },
  }
}

///|
fn parse_retained_scene(json : Json) -> Result[RetainedScene, String] {
  match operator_error_message(json) {
    Some(error) => return Err(error)
    None => ()
  }
  guard json
    is {
      "contract_id": String("moonmold.retained-scene.v1"),
      "physical_authority": False,
      "dimension_units": String("mm"),
      "translation_units": String("mm"),
      "backend": {
        "mode": String("deterministic-mock-reference"),
        "blender_evidence": False,
        ..
      },
      ..
    } else {
    return Err("Retained scene exceeded its digital reference boundary.")
  }
  let scene : RetainedScene = @json.from_json(json) catch {
    error => return Err("Invalid retained scene: \{error}")
  }
  if !(scene.status is ("ready" | "empty" | "unsupported")) ||
    scene.objects.length() > 100 ||
    scene.workspace_parent_digest.is_empty() ||
    (scene.status != "ready" && !scene.objects.is_empty()) {
    return Err("Retained scene is incomplete or exceeds its bounds.")
  }
  for object in scene.objects {
    if retained_editor(object, "replace") is None ||
      retained_editor(object, "move") is None ||
      retained_editor(object, "material") is None {
      return Err(
        "Retained object does not match the supported primitive schema.",
      )
    }
  }
  match scene.preview_data_url {
    Some(url) if !url.has_prefix("data:image/svg+xml;base64,") =>
      return Err("Retained preview must be an inert local SVG image.")
    _ => ()
  }
  Ok(scene)
}

///|
fn retained_editor(object : Json, action : String) -> PrimitiveEditor? {
  guard object
    is {
      "object_id": String(object_id),
      "kind": String(kind),
      "dimensions_mm": dimensions,
      "translation_mm": { "x": x, "y": y, "z": z, .. },
      ..
    } else {
    return None
  }
  if action == "material" {
    let material_id = match object {
      { "material_id": Null, .. } => ""
      { "material_id": String(id), .. } if primitive_identifier(id) => id
      _ => return None
    }
    if !primitive_identifier(object_id) {
      return None
    }
    // An unassigned object starts with a deliberately incomplete field. It
    // cannot be saved, validated or executed until the user supplies an ID.
    return Some({
      ..primitive_defaults("scene.assign-material", object_id),
      material_id,
    })
  }
  if action == "move" {
    return primitive_from_operation("scene.set-transform", {
      "objectId": object_id,
      "xMm": x,
      "yMm": y,
      "zMm": z,
    })
  }
  match (kind, dimensions, object) {
    ("box", { "width": width, "depth": depth, "height": height, .. }, _) =>
      primitive_from_operation("scene.create-box", {
        "objectId": object_id,
        "widthMm": width,
        "depthMm": depth,
        "heightMm": height,
      })
    (
      "cylinder",
      { "radius": radius, "height": height, .. },
      { "sides": sides, .. },
    ) =>
      primitive_from_operation("scene.create-cylinder", {
        "objectId": object_id,
        "radiusMm": radius,
        "heightMm": height,
        "sides": sides,
      })
    _ => None
  }
}

///|
fn current_retained_scene(model : Model) -> RetainedScene? {
  match model.retained_scene {
    Some(scene) if scene.project_id == model.project_id &&
      scene.model_id == model.model_id => Some(scene)
    _ => None
  }
}

///|
fn retained_selected(model : Model) -> Json? {
  guard current_retained_scene(model) is Some(scene) else { return None }
  for object in scene.objects {
    match object {
      { "object_id": String(id), .. } if id == model.selected_object =>
        return Some(object)
      _ => ()
    }
  }
  None
}

///|
fn prepare_retained_object(model : Model, action : String) -> Model {
  guard action is ("move" | "replace" | "duplicate" | "material") &&
    current_retained_scene(model) is Some(scene) &&
    retained_selected(model) is Some(object) &&
    retained_editor(object, action) is Some(editor) else {
    return {
      ..model,
      error: "Refresh this model and select a supported retained object first.",
    }
  }
  let editor = if action == "duplicate" {
    let mut identity = ""
    for index in 1..<=101 {
      let candidate = editor.object_id[:110].to_owned() +
        "-copy-" +
        index.to_string()
      if !scene.objects.any(item => {
          match item {
            { "object_id": String(id), .. } => id == candidate
            _ => false
          }
        }) {
        identity = candidate
        break
      }
    }
    { ..editor, object_id: identity, }
  } else {
    editor
  }
  let params = primitive_params(editor)
  if action == "material" {
    return {
      ..model,
      method_name: editor.method_name,
      params_json: match params {
        Ok(value) => value.stringify(indent=2)
        Err(_) =>
          Json::object({
            "objectId": editor.object_id.to_json(),
            "materialId": "",
          }).stringify(indent=2)
      },
      primitive_editor: Some(editor),
      expected_parent_digest: scene.workspace_parent_digest,
      draft_changed: true,
      error: "",
      notice: "Prepared material assignment from the selected retained snapshot. No operation has run. Enter a semantic material ID, then Validate and Execute explicitly; a stale workspace parent is rejected. This label changes no geometry or position and asserts no material properties or manufacturing suitability.",
    }
  }
  match params {
    Err(error) => { ..model, error, }
    Ok(params) =>
      {
        ..model,
        method_name: editor.method_name,
        params_json: params.stringify(indent=2),
        primitive_editor: Some(editor),
        expected_parent_digest: scene.workspace_parent_digest,
        draft_changed: true,
        error: "",
        notice: "Prepared " +
        action +
        " from the selected retained snapshot. No operation has run. Validate and Execute remain explicit; a stale workspace parent is rejected. Replacement/duplicate creates reset position and material.",
      }
  }
}

///|
fn retained_scene_request(
  emit : @rabbita.Emit[Msg],
  model : Model,
  generation : Int,
) -> @rabbita.Cmd {
  // IDs are checked before building this URL, so they contain no query syntax.
  @http.get(
    "/api/scene/retained?project_id=" +
    model.project_id +
    "&model_id=" +
    model.model_id,
  ).expect_json(
    emit.map(result => {
      SceneLoaded(
        generation,
        model.project_id,
        model.model_id,
        match result {
          Ok(value) => parse_retained_scene(value)
          Err(error) => Err("\{error}")
        },
      )
    }),
  )
}

///|
fn update_retained_scene(
  emit : @rabbita.Emit[Msg],
  msg : Msg,
  model : Model,
) -> (@rabbita.Cmd, Model) {
  match msg {
    RefreshScene => {
      if model.scene_loading || model.busy {
        return (@rabbita.none, model)
      }
      if !primitive_identifier(model.project_id) ||
        !primitive_identifier(model.model_id) {
        return (
          @rabbita.none,
          {
            ..model,
            scene_error: "Enter valid project and model IDs before refreshing objects.",
          },
        )
      }
      let generation = model.scene_generation + 1
      (
        retained_scene_request(emit, model, generation),
        {
          ..model,
          scene_generation: generation,
          scene_loading: true,
          scene_error: "",
        },
      )
    }
    SceneLoaded(generation, project, model_id, result) => {
      if !model.scene_loading ||
        generation != model.scene_generation ||
        project != model.project_id ||
        model_id != model.model_id {
        return (@rabbita.none, model)
      }
      match result {
        Err(error) =>
          (
            @rabbita.none,
            {
              ..model,
              scene_loading: false,
              scene_error: error,
              retained_scene: None,
              selected_object: "",
            },
          )
        Ok(scene) => {
          if scene.project_id != project || scene.model_id != model_id {
            return (
              @rabbita.none,
              {
                ..model,
                scene_loading: false,
                scene_error: "Retained response belongs to another model.",
                retained_scene: None,
                selected_object: "",
              },
            )
          }
          // Refresh never rewrites unsaved fields, request identity or parent.
          (
            @rabbita.none,
            {
              ..model,
              scene_loading: false,
              scene_error: "",
              retained_scene: Some(scene),
              selected_object: "",
            },
          )
        }
      }
    }
    SelectObject(id) =>
      if model.busy {
        (@rabbita.none, model)
      } else {
        (@rabbita.none, { ..model, selected_object: id, })
      }
    PrepareObject(action) =>
      if model.busy || model.scene_loading {
        (@rabbita.none, model)
      } else {
        (@rabbita.none, prepare_retained_object(model, action))
      }
    _ => (@rabbita.none, model)
  }
}
