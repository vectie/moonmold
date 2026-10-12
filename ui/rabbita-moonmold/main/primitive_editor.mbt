///|
// Text fields retain incomplete input. Only complete, bounded values become a
// semantic request. Geometry is always integer millimetres, including in a
// model whose exported coordinates use cm or m.
struct PrimitiveEditor {
  method_name : String
  object_id : String
  material_id : String
  units : String
  width : String
  depth : String
  height : String
  radius : String
  sides : String
  x : String
  y : String
  z : String
} derive(Debug, Eq)

///|
fn primitive_defaults(
  method_name : String,
  object_id : String,
) -> PrimitiveEditor {
  {
    method_name,
    object_id,
    material_id: "",
    units: "mm",
    width: "1200",
    depth: "800",
    height: "600",
    radius: "200",
    sides: "32",
    x: "0",
    y: "0",
    z: "0",
  }
}

///|
fn primitive_identifier(value : String) -> Bool {
  if value.is_empty() || value.length() > 128 {
    return false
  }
  for i = 0; i < value.length(); i = i + 1 {
    let code = value[i]
    let alphanumeric = (code >= 'a' && code <= 'z') ||
      (code >= 'A' && code <= 'Z') ||
      (code >= '0' && code <= '9')
    if !alphanumeric && (i == 0 || !(code is ('.' | '_' | ':' | '-'))) {
      return false
    }
  }
  true
}

///|
fn primitive_integer(
  value : String,
  label : String,
  positive? : Bool = false,
) -> Result[Int, String] {
  let text = value.trim().to_owned()
  if text.is_empty() {
    return Err(label + " is required.")
  }
  let number = @string.parse_int(text, base=10) catch {
    _ =>
      return Err(
        label + " must be a whole number from -2147483648 through 2147483647.",
      )
  }
  if positive && number <= 0 {
    Err(label + " must be greater than 0 mm (maximum 2147483647 mm).")
  } else {
    Ok(number)
  }
}

///|
fn primitive_params(editor : PrimitiveEditor) -> Result[Json, String] {
  if !primitive_identifier(editor.object_id) {
    return Err(
      if editor.method_name == "scene.create-model" {
        "Model name needs 1–128 characters: start with a letter or digit; then use letters, digits, dot, underscore, colon or hyphen."
      } else {
        "Object ID needs 1–128 characters: start with a letter or digit; then use letters, digits, dot, underscore, colon or hyphen."
      },
    )
  }
  match editor.method_name {
    "scene.assign-material" => {
      if !primitive_identifier(editor.material_id) {
        return Err(
          "Material ID needs 1–128 characters: start with a letter or digit; then use letters, digits, dot, underscore, colon or hyphen.",
        )
      }
      Ok({ "objectId": editor.object_id, "materialId": editor.material_id })
    }
    "scene.create-model" => {
      if !(editor.units is ("mm" | "cm" | "m")) {
        return Err("Model units must be mm, cm or m.")
      }
      Ok({
        "name": editor.object_id,
        "units": editor.units,
        "coordinateFrame": "z-up-right-handed",
      })
    }
    "scene.create-box" => {
      let width = match
        primitive_integer(editor.width, "Width", positive=true) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let depth = match
        primitive_integer(editor.depth, "Depth", positive=true) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let height = match
        primitive_integer(editor.height, "Height", positive=true) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      Ok({
        "objectId": editor.object_id,
        "widthMm": width,
        "depthMm": depth,
        "heightMm": height,
      })
    }
    "scene.create-cylinder" => {
      let radius = match
        primitive_integer(editor.radius, "Radius", positive=true) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let height = match
        primitive_integer(editor.height, "Height", positive=true) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let sides = match primitive_integer(editor.sides, "Sides") {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      if sides < 8 || sides > 256 {
        return Err("Sides must be a whole number from 8 through 256.")
      }
      Ok({
        "objectId": editor.object_id,
        "radiusMm": radius,
        "heightMm": height,
        "sides": sides,
      })
    }
    "scene.set-transform" => {
      let x = match primitive_integer(editor.x, "X position") {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let y = match primitive_integer(editor.y, "Y position") {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let z = match primitive_integer(editor.z, "Z position") {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      Ok({ "objectId": editor.object_id, "xMm": x, "yMm": y, "zMm": z })
    }
    _ => Err("This operation uses the advanced JSON editor.")
  }
}

///|
fn primitive_number(fields : Map[String, Json], name : String) -> String? {
  guard fields.get(name) is Some(value) else { return None }
  let number : Int = @json.from_json(value) catch { _ => return None }
  // FromJson[Int] on JS may truncate a JSON number. Never let hydration turn
  // a decimal or out-of-range advanced value into a different typed request.
  if value != number.to_json() {
    return None
  }
  Some(number.to_string())
}

///|
// Hydrate exact schemas only. Extra keys, unsupported operations/frames, and
// values outside the native integer contract remain lossless advanced JSON.
fn primitive_from_operation(
  method_name : String,
  params : Json,
) -> PrimitiveEditor? {
  guard params is Object(fields) else { return None }
  let mut editor = primitive_defaults(method_name, "")
  if method_name == "scene.create-model" {
    guard fields.length() == 3 &&
      fields.get("name") is Some(String(name)) &&
      fields.get("units") is Some(String(units)) &&
      fields.get("coordinateFrame") is Some(String("z-up-right-handed")) else {
      return None
    }
    editor = { ..editor, object_id: name, units, }
  } else {
    guard fields.get("objectId") is Some(String(object_id)) else { return None }
    editor = { ..editor, object_id, }
    match method_name {
      "scene.assign-material" => {
        guard fields.length() == 2 &&
          fields.get("materialId") is Some(String(material_id)) else {
          return None
        }
        editor = { ..editor, material_id, }
      }
      "scene.create-box" => {
        guard fields.length() == 4 &&
          primitive_number(fields, "widthMm") is Some(width) &&
          primitive_number(fields, "depthMm") is Some(depth) &&
          primitive_number(fields, "heightMm") is Some(height) else {
          return None
        }
        editor = { ..editor, width, depth, height, }
      }
      "scene.create-cylinder" => {
        guard fields.length() == 4 &&
          primitive_number(fields, "radiusMm") is Some(radius) &&
          primitive_number(fields, "heightMm") is Some(height) &&
          primitive_number(fields, "sides") is Some(sides) else {
          return None
        }
        editor = { ..editor, radius, height, sides, }
      }
      "scene.set-transform" => {
        guard fields.length() == 4 &&
          primitive_number(fields, "xMm") is Some(x) &&
          primitive_number(fields, "yMm") is Some(y) &&
          primitive_number(fields, "zMm") is Some(z) else {
          return None
        }
        editor = { ..editor, x, y, z, }
      }
      _ => return None
    }
  }
  match primitive_params(editor) {
    Ok(_) => Some(editor)
    Err(_) => None
  }
}

///|
fn sync_primitive_editor(model : Model) -> Model {
  let params = @json.parse(model.params_json) catch { _ => Json::null() }
  let editor = primitive_from_operation(model.method_name, params)
  { ..model, primitive_editor: editor, }
}

///|
fn edit_primitive(model : Model, name : String, value : String) -> Model {
  guard model.primitive_editor is Some(current) else { return model }
  let editor = match name {
    "objectId" => { ..current, object_id: value, }
    "materialId" => { ..current, material_id: value, }
    "units" => { ..current, units: value, }
    "width" => { ..current, width: value, }
    "depth" => { ..current, depth: value, }
    "height" => { ..current, height: value, }
    "radius" => { ..current, radius: value, }
    "sides" => { ..current, sides: value, }
    "x" => { ..current, x: value, }
    "y" => { ..current, y: value, }
    "z" => { ..current, z: value, }
    _ => return model
  }
  let (params_json, error) = match primitive_params(editor) {
    Ok(params) => (params.stringify(indent=2), "")
    Err(error) => (model.params_json, error)
  }
  {
    ..model,
    primitive_editor: Some(editor),
    params_json,
    draft_changed: true,
    error,
  }
}

///|
fn primitive_draft_error(model : Model) -> String {
  match model.primitive_editor {
    Some(editor) =>
      match primitive_params(editor) {
        Err(error) => error
        Ok(_) => ""
      }
    None => ""
  }
}

///|
fn last_primitive(model : Model) -> PrimitiveEditor? {
  guard successful_receipt(model, "spatial.operation.execute") &&
    model.last_spatial_request
    is Some(
      {
        "project_id": String(project),
        "model_id": String(model_id),
        "operation": { "method": String(method_name), "params": params, .. },
        ..
      }
    ) &&
    project == model.project_id &&
    model_id == model.model_id &&
    method_name != "scene.create-model" else {
    return None
  }
  primitive_from_operation(method_name, params)
}
