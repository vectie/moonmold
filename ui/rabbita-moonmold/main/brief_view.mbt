///|
fn brief_field(
  emit : @rabbita.Emit[Msg],
  model : Model,
  title : String,
  name : String,
  value : String,
  multiline? : Bool = false,
) -> @rabbita.Html {
  @html.label(class="field", [
    @html.span(title),
    if multiline {
      @html.textarea(
        value~,
        rows=3,
        disabled=model.busy,
        on_input=emit.map(value => SetBriefField(name, value)),
        "",
      )
    } else {
      @html.input(
        input_type=Text,
        value~,
        attrs=@html.Attrs::build().disabled(model.busy),
        on_input=emit.map(value => SetBriefField(name, value)),
      )
    },
  ])
}

///|
fn brief_editor_panel(
  emit : @rabbita.Emit[Msg],
  model : Model,
) -> @rabbita.Html {
  let controls : Array[@rabbita.Html] = [@html.h3("Brief draft")]
  match model.brief_editor {
    Some(editor) => {
      controls.push(
        @html.p(
          "Project: " + editor.project_id + " · Model: " + editor.model_id,
        ),
      )
      controls.push(
        @html.div(class="two", [
          brief_field(
            emit,
            model,
            "Commitment reference",
            "commitment_ref",
            editor.commitment_ref,
          ),
          brief_field(
            emit,
            model,
            "Brief revision",
            "revision",
            editor.revision,
          ),
        ]),
      )
      controls.push(
        brief_field(
          emit,
          model,
          "Intended use",
          "intended_use",
          editor.intended_use,
          multiline=true,
        ),
      )
      controls.push(
        @html.div(class="two", [
          brief_field(
            emit,
            model,
            "Primary width / cylinder diameter (mm)",
            "width",
            editor.width,
          ),
          brief_field(
            emit,
            model,
            "Primary depth / cylinder diameter (mm)",
            "depth",
            editor.depth,
          ),
          brief_field(
            emit,
            model,
            "Primary height (mm)",
            "height",
            editor.height,
          ),
        ]),
      )
      controls.push(
        @html.label(class="field", [
          @html.span("Scene / OBJ export units"),
          @html.select(
            disabled=model.busy,
            on_change=emit.map(value => SetBriefField("units", value)),
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
          "Dimensions always use positive whole millimetres (maximum 2147483647). Changing scene units never converts these inputs or changes model operations. Set the same units explicitly in Create model. Cylinder width and depth are its nominal diameter, not faceted mesh bounds.",
        ),
      )
      controls.push(
        brief_field(
          emit,
          model,
          "Constraints · one per line (optional)",
          "constraints",
          editor.constraints,
          multiline=true,
        ),
      )
      controls.push(
        brief_field(
          emit,
          model,
          "Review criteria · one per line",
          "review_criteria",
          editor.review_criteria,
          multiline=true,
        ),
      )
      let error = brief_draft_error(model)
      if !error.is_empty() {
        controls.push(
          @html.p(
            class="primitive-error",
            attrs=@html.Attrs::build().role("alert"),
            error +
            " Complete the draft before freezing. Advanced JSON shows the last complete values.",
          ),
        )
      }
    }
    None =>
      controls.push(
        @html.p(
          "This draft uses advanced JSON because its fields cannot be shown losslessly in this form. Exact text is retained below; correcting supported fields restores the form. Unsupported values still require host validation.",
        ),
      )
  }
  controls.push(
    @html.p(
      "Deliverables: editable source + presentation. Frame: z-up-right-handed. Digital only; no physical authority. Human constraints and review criteria are retained for review, not automatically proven.",
    ),
  )
  controls.push(
    @html.div(class="actions", [
      action(
        "Use current project/model",
        emit(PrepareBrief),
        disabled=model.busy,
      ),
      action(
        "Start next revision from draft",
        emit(ReviseBrief),
        disabled=model.busy || delivery_brief_body(model) is Err(_),
      ),
      action(
        "Load selected package brief",
        emit(LoadPackageBrief),
        disabled=model.busy || model.delivery is None,
      ),
    ]),
  )
  controls.push(
    @html.small(
      "Loading a package brief replaces this draft; its frozen binding, downloads and reviews remain unchanged. Next revision copies current values and increments the revision, without freezing or running anything. Unsaved brief fields live only in this page; after reload, load the retained package brief to revise it.",
    ),
  )
  @html.section(
    class="primitive-editor",
    attrs=@html.Attrs::build().aria_label("Structured digital brief editor"),
    controls,
  )
}
