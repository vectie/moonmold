///|
// Text remains editable when incomplete; only valid values replace JSON.
// This form is a view of the existing brief, never a geometry operation.
struct BriefEditor {
  project_id : String
  model_id : String
  commitment_ref : String
  revision : String
  intended_use : String
  units : String
  width : String
  depth : String
  height : String
  constraints : String
  review_criteria : String
} derive(Debug, Eq)

///|
fn brief_lines(value : String) -> Array[String] {
  if value.is_empty() {
    []
  } else {
    value.split("\n").map(s => s.to_owned()).collect()
  }
}

///|
fn brief_value(editor : BriefEditor) -> Result[Json, String] {
  for
    (label, value) in [
      ("Project", editor.project_id),
      ("Model", editor.model_id),
      ("Commitment reference", editor.commitment_ref),
    ] {
    if !primitive_identifier(value) {
      return Err(
        label +
        " needs 1–128 characters: start with a letter or digit; then use letters, digits, dot, underscore, colon or hyphen.",
      )
    }
  }
  let revision = @string.parse_int(editor.revision.trim(), base=10) catch {
    _ =>
      return Err(
        "Brief revision must be a whole number from 1 through 2147483647.",
      )
  }
  if revision < 1 {
    return Err(
      "Brief revision must be a whole number from 1 through 2147483647.",
    )
  }
  if editor.intended_use.trim().is_empty() {
    return Err("Intended use is required.")
  }
  if !(editor.units is ("mm" | "cm" | "m")) {
    return Err("Brief scene units must be mm, cm or m.")
  }
  let width = match
    primitive_integer(editor.width, "Brief width", positive=true) {
    Ok(n) => n
    Err(e) => return Err(e)
  }
  let depth = match
    primitive_integer(editor.depth, "Brief depth", positive=true) {
    Ok(n) => n
    Err(e) => return Err(e)
  }
  let height = match
    primitive_integer(editor.height, "Brief height", positive=true) {
    Ok(n) => n
    Err(e) => return Err(e)
  }
  let constraints = brief_lines(editor.constraints)
  let criteria = brief_lines(editor.review_criteria)
  if constraints.any(s => s.trim().is_empty()) {
    return Err(
      "Each constraint line must contain text; leave the field empty for no constraints.",
    )
  }
  if criteria.is_empty() || criteria.any(s => s.trim().is_empty()) {
    return Err("Add at least one review criterion, with text on every line.")
  }
  Ok({
    "contract_id": "moonmold.digital-brief.v1",
    "commitment_ref": editor.commitment_ref,
    "revision": revision,
    "project_id": editor.project_id,
    "model_id": editor.model_id,
    "intended_use": editor.intended_use,
    "units": editor.units,
    "coordinate_frame": "z-up-right-handed",
    "dimensions_mm": { "width": width, "depth": depth, "height": height },
    "constraints": constraints,
    "deliverables": ["editable-source", "presentation"],
    "review_criteria": criteria,
    "physical_authority": false,
  })
}

///|
fn brief_text_lines(value : Json) -> String? {
  guard value is Array(items) else { return None }
  let strings : Array[String] = []
  for item in items {
    guard item is String(text) && !text.contains("\n") && !text.contains("\r") else {
      return None
    }
    strings.push(text)
  }
  Some(strings.join("\n"))
}

///|
// Strict semantic round-trip: unknown keys, unusual arrays, larger numbers,
// unsupported frames and units stay in advanced JSON without coercion/loss.
fn brief_from_json(value : Json) -> BriefEditor? {
  guard value is Object(fields) &&
    value
    is {
      "project_id": String(project_id),
      "model_id": String(model_id),
      "commitment_ref": String(commitment_ref),
      "intended_use": String(intended_use),
      "units": String(units),
      "dimensions_mm": Object(dimensions),
      "constraints": constraints,
      "review_criteria": review_criteria,
      ..
    } &&
    primitive_number(fields, "revision") is Some(revision) &&
    primitive_number(dimensions, "width") is Some(width) &&
    primitive_number(dimensions, "depth") is Some(depth) &&
    primitive_number(dimensions, "height") is Some(height) &&
    brief_text_lines(constraints) is Some(constraints) &&
    brief_text_lines(review_criteria) is Some(review_criteria) else {
    return None
  }
  let editor = {
    project_id,
    model_id,
    commitment_ref,
    revision,
    intended_use,
    units,
    width,
    depth,
    height,
    constraints,
    review_criteria,
  }
  match brief_value(editor) {
    Ok(round_trip) if round_trip == value => Some(editor)
    _ => None
  }
}

///|
fn sync_brief_editor(model : Model) -> Model {
  let brief = @json.parse(model.brief_json) catch { _ => Json::null() }
  {
    ..model,
    brief_editor: brief_from_json(brief),
    brief_draft_generation: model.brief_draft_generation + 1,
  }
}

///|
fn brief_draft_error(model : Model) -> String {
  match model.brief_editor {
    Some(editor) =>
      match brief_value(editor) {
        Err(error) => error
        Ok(_) => ""
      }
    None => ""
  }
}

///|
fn edit_brief(model : Model, name : String, value : String) -> Model {
  guard model.brief_editor is Some(current) else { return model }
  let editor = match name {
    "commitment_ref" => { ..current, commitment_ref: value, }
    "revision" => { ..current, revision: value, }
    "intended_use" => { ..current, intended_use: value, }
    "units" => { ..current, units: value, }
    "width" => { ..current, width: value, }
    "depth" => { ..current, depth: value, }
    "height" => { ..current, height: value, }
    "constraints" => { ..current, constraints: value, }
    "review_criteria" => { ..current, review_criteria: value, }
    _ => return model
  }
  let (brief_json, error) = match brief_value(editor) {
    Ok(brief) => (brief.stringify(indent=2), "")
    Err(error) => (model.brief_json, error)
  }
  {
    ..model,
    brief_editor: Some(editor),
    brief_json,
    brief_draft_dirty: true,
    brief_draft_generation: model.brief_draft_generation + 1,
    draft_changed: true,
    error,
  }
}

///|
fn revise_brief(model : Model) -> Result[Model, String] {
  guard delivery_brief_body(model) is Ok({ "brief": Object(fields), .. }) else {
    return Err(
      "Complete a valid brief for the current project/model before starting the next revision. Load the selected package brief to recover its exact content.",
    )
  }
  guard primitive_number(fields, "revision") is Some(text) else {
    return Err(
      "Use advanced JSON to revise this brief's larger revision number.",
    )
  }
  let revision = @string.parse_int(text) catch {
    _ => return Err("Invalid brief revision.")
  }
  if revision == 2147483647 {
    return Err(
      "Use advanced JSON to revise this brief's larger revision number.",
    )
  }
  // Parse produced a fresh map; frozen briefs/packages are never mutated.
  fields["revision"] = (revision + 1).to_json()
  Ok(
    sync_brief_editor({
      ..model,
      brief_json: Json::object(fields).stringify(indent=2),
      brief_draft_dirty: true,
      draft_changed: true,
      notice: "Next brief revision copied from the current draft. Review changes and freeze before changed operations. Earlier packages and reviews remain intact.",
      error: "",
    }),
  )
}

///|
// The existing file route verifies package bytes. Also reject late responses
// and mismatched identities instead of replacing another selected draft.
fn load_package_brief(
  model : Model,
  id : String,
  digest : String,
  record : Json,
) -> Result[Model, String] {
  guard model.delivery is Some(delivery) &&
    delivery_id(delivery) == id &&
    delivery.manifest_digest == digest else {
    return Err(
      "The selected package changed while its brief was loading; the draft was preserved.",
    )
  }
  guard record
    is {
      "contract_id": String("moonmold.frozen-digital-brief.v1"),
      "brief": Object(brief) as value,
      ..
    } &&
    delivery.manifest is Object(manifest) &&
    brief.get("project_id") == manifest.get("project_id") &&
    brief.get("model_id") == manifest.get("model_id") &&
    brief.get("commitment_ref") == manifest.get("commitment_ref") &&
    brief.get("revision") == manifest.get("brief_revision") &&
    brief.get("project_id") == Some(model.project_id.to_json()) &&
    brief.get("model_id") == Some(model.model_id.to_json()) &&
    brief.get("contract_id") == Some("moonmold.digital-brief.v1") &&
    brief.get("physical_authority") == Some(false.to_json()) else {
    return Err(
      "The package brief does not match the selected package and current project/model; the draft was preserved.",
    )
  }
  Ok(
    sync_brief_editor({
      ..model,
      brief_json: value.stringify(indent=2),
      brief_draft_dirty: true,
      busy: false,
      draft_changed: true,
      notice: "Exact package brief loaded into the draft. Start next revision, edit, and freeze before changed operations. The frozen binding and package reviews are unchanged.",
      error: "",
    }),
  )
}
