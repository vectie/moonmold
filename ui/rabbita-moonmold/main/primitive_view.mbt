///|
fn primitive_field(
  emit : @rabbita.Emit[Msg],
  model : Model,
  title : String,
  name : String,
  value : String,
) -> @rabbita.Html {
  @html.label(class="field", [
    @html.span(title),
    @html.input(
      input_type=Text,
      value~,
      attrs=@html.Attrs::build().disabled(model.busy),
      on_input=emit.map(value => SetPrimitiveField(name, value)),
    ),
  ])
}

///|
fn primitive_panel(emit : @rabbita.Emit[Msg], model : Model) -> @rabbita.Html {
  let controls : Array[@rabbita.Html] = [
    @html.h3("Object controls"),
    retained_scene_panel(emit, model),
    @html.p(
      "Choose an operation, fill in its fields, then validate and execute. Choosing a different operation replaces unsaved parameters.",
    ),
    @html.div(class="templates", [
      action("Create model", emit(ApplyTemplate("model")), disabled=model.busy),
      action("Add box", emit(ApplyTemplate("box")), disabled=model.busy),
      action(
        "Add cylinder",
        emit(ApplyTemplate("cylinder")),
        disabled=model.busy,
      ),
      action("Move object", emit(ApplyTemplate("move")), disabled=model.busy),
      action(
        "Copy last object operation",
        emit(CopyLastPrimitive),
        disabled=model.busy || last_primitive(model) is None,
      ),
    ]),
  ]
  match model.primitive_editor {
    None =>
      controls.push(
        @html.p(
          "This request uses advanced parameters. Its exact parameter values are retained below. Choose a supported operation above to start a new typed draft.",
        ),
      )
    Some(editor) => {
      let title = match editor.method_name {
        "scene.create-model" => "Create model"
        "scene.create-box" => "Box dimensions"
        "scene.create-cylinder" => "Cylinder dimensions"
        "scene.assign-material" => "Semantic material assignment"
        _ => "Absolute object position"
      }
      controls.push(@html.h3(title))
      controls.push(
        primitive_field(
          emit,
          model,
          if editor.method_name == "scene.create-model" {
            "Model name"
          } else {
            "Object ID"
          },
          "objectId",
          editor.object_id,
        ),
      )
      match editor.method_name {
        "scene.assign-material" => {
          controls.push(
            primitive_field(
              emit,
              model,
              "Material ID (semantic identity only)",
              "materialId",
              editor.material_id,
            ),
          )
          controls.push(
            @html.p(
              "This records a label on an existing object. It does not change geometry or position, describe physical material properties, or establish manufacturing suitability. The ID is preserved exactly in retained objects and editable-source delivery. Blank does not clear an assignment; enter a valid ID.",
            ),
          )
        }
        "scene.create-model" => {
          controls.push(
            @html.label(class="field", [
              @html.span("Model / export units"),
              @html.select(
                disabled=model.busy,
                on_change=emit.map(value => SetPrimitiveField("units", value)),
                [
                  @html.option(
                    value="mm",
                    selected=editor.units == "mm",
                    "Millimetres (mm)",
                  ),
                  @html.option(
                    value="cm",
                    selected=editor.units == "cm",
                    "Centimetres (cm)",
                  ),
                  @html.option(
                    value="m",
                    selected=editor.units == "m",
                    "Metres (m)",
                  ),
                ],
              ),
            ]),
          )
          controls.push(
            @html.p(
              "Frame: z-up-right-handed. Object dimensions and positions below are always entered in mm, regardless of export units. Creating an existing model resets its scene.",
            ),
          )
        }
        "scene.create-box" =>
          controls.push(
            @html.div(class="two", [
              primitive_field(emit, model, "Width (mm)", "width", editor.width),
              primitive_field(emit, model, "Depth (mm)", "depth", editor.depth),
              primitive_field(
                emit,
                model,
                "Height (mm)",
                "height",
                editor.height,
              ),
            ]),
          )
        "scene.create-cylinder" =>
          controls.push(
            @html.div(class="two", [
              primitive_field(
                emit,
                model,
                "Radius (mm)",
                "radius",
                editor.radius,
              ),
              primitive_field(
                emit,
                model,
                "Height (mm)",
                "height",
                editor.height,
              ),
              primitive_field(
                emit,
                model,
                "Sides (8–256)",
                "sides",
                editor.sides,
              ),
            ]),
          )
        _ => {
          controls.push(
            @html.div(class="two", [
              primitive_field(emit, model, "X position (mm)", "x", editor.x),
              primitive_field(emit, model, "Y position (mm)", "y", editor.y),
              primitive_field(emit, model, "Z position (mm)", "z", editor.z),
            ]),
          )
          controls.push(
            @html.p(
              "Absolute position, not a movement amount. Negative positions are allowed. The object must already exist; this does not rotate or resize it.",
            ),
          )
        }
      }
      if editor.method_name is ("scene.create-box" | "scene.create-cylinder") {
        controls.push(
          @html.p(
            "Use a new object ID to add a primitive. Reusing an existing ID replaces its geometry and resets its position/material. Dimensions are positive whole mm (maximum 2147483647).",
          ),
        )
      }
      let error = primitive_draft_error(model)
      if !error.is_empty() {
        controls.push(
          @html.p(
            class="primitive-error",
            attrs=@html.Attrs::build().role("alert"),
            error +
            " Complete this field before saving, validating or executing. Advanced JSON may show earlier values until every field is complete.",
          ),
        )
      }
    }
  }
  controls.push(
    @html.small(
      "Unsaved fields live only in this page. Save a complete request to reload it later. Reload recovery restores the last durable operation, not unfinished edits.",
    ),
  )
  @html.section(
    id="object-controls",
    class="primitive-editor",
    attrs=@html.Attrs::build().aria_label("Typed object editor"),
    controls,
  )
}
