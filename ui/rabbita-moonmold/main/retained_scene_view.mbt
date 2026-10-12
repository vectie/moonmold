///|
fn retained_object_label(object : Json) -> String {
  guard retained_editor(object, "replace") is Some(editor) &&
    retained_editor(object, "move") is Some(position) else {
    return "Unsupported object"
  }
  let dimensions = if editor.method_name == "scene.create-box" {
    "box · W " +
    editor.width +
    " × D " +
    editor.depth +
    " × H " +
    editor.height +
    " mm"
  } else {
    "cylinder · radius " +
    editor.radius +
    " × H " +
    editor.height +
    " mm · " +
    editor.sides +
    " sides"
  }
  let material = match object {
    { "material_id": String(id), .. } => id
    _ => "none"
  }
  editor.object_id +
  " · " +
  dimensions +
  " · position (" +
  position.x +
  ", " +
  position.y +
  ", " +
  position.z +
  ") mm · material " +
  material
}

///|
fn retained_scene_panel(
  emit : @rabbita.Emit[Msg],
  model : Model,
) -> @rabbita.Html {
  let content : Array[@rabbita.Html] = [
    @html.h3("Retained model objects"),
    @html.p(
      "Inspect the selected project/model without remembering object IDs. Refresh reads durable verified operations and preserves unsaved fields. Select an object, then explicitly prepare a draft.",
    ),
    action(
      if model.scene_loading {
        "Refreshing objects…"
      } else {
        "Refresh retained objects"
      },
      emit(RefreshScene),
      disabled=model.busy || model.scene_loading,
    ),
  ]
  if !model.scene_error.is_empty() {
    content.push(@html.p(class="primitive-error", model.scene_error))
  }
  match current_retained_scene(model) {
    None =>
      content.push(
        @html.p(
          "Refresh to load the retained object inventory for " +
          model.project_id +
          " / " +
          model.model_id +
          ".",
        ),
      )
    Some(scene) => {
      content.push(@html.p(scene.message))
      content.push(
        @html.small(
          "As-of verified journal snapshot · fixture reference only · not Blender · no physical authority. Other workspace operations can make this snapshot stale.",
        ),
      )
      if scene.workspace_parent_digest != model.expected_parent_digest {
        content.push(
          @html.p(
            "Snapshot workspace parent differs from this draft. Preparation binds the snapshot's global parent; refresh first if newer work has run.",
          ),
        )
      }
      content.push(
        @html.details([
          @html.summary("Snapshot identity"),
          @html.p("Workspace-global parent: " + scene.workspace_parent_digest),
          @html.p("Journal digest: " + scene.journal_digest),
        ]),
      )
      match scene.preview_data_url {
        Some(src) =>
          content.push(
            @html.img(
              src~,
              alt="Illustrative retained primitives; not an engineering drawing or Blender evidence",
              class="retained-preview",
            ),
          )
        None => ()
      }
      for object in scene.objects {
        match object {
          { "object_id": String(id), .. } =>
            content.push(
              @html.div(class="retained-object", [
                action(
                  if id == model.selected_object {
                    "Selected: " + id
                  } else {
                    "Select " + id
                  },
                  emit(SelectObject(id)),
                  disabled=model.busy || model.scene_loading,
                ),
                @html.p(retained_object_label(object)),
              ]),
            )
          _ => ()
        }
      }
      let disabled = model.busy ||
        model.scene_loading ||
        retained_selected(model) is None
      content.push(
        @html.div(class="templates", [
          action("Prepare move", emit(PrepareObject("move")), disabled~),
          action(
            "Prepare material assignment",
            emit(PrepareObject("material")),
            disabled~,
          ),
          action(
            "Prepare replacement",
            emit(PrepareObject("replace")),
            disabled~,
          ),
          action(
            "Prepare duplicate",
            emit(PrepareObject("duplicate")),
            disabled~,
          ),
        ]),
      )
      content.push(
        @html.small(
          "Prepare replaces unsaved operation fields, never executes. Material assignment records a semantic identity only, without material properties or manufacturing suitability; geometry and position stay unchanged. Move uses the retained absolute position. Replacement keeps the ID; duplicate proposes an unused ID and copies only kind/dimensions/sides. Both creates reset position to origin and material to none. Validate and Execute are still required; refresh and reselect after changes. Unsupported history produces no approximate inventory.",
        ),
      )
    }
  }
  @html.section(
    class="retained-scene",
    attrs=@html.Attrs::build().aria_label("Retained model object browser"),
    content,
  )
}
