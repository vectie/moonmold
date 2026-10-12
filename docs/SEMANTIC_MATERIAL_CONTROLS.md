# Semantic material assignment

1. Enter the project and model, then **Refresh retained objects**.
2. Select an existing box or cylinder and choose **Prepare material assignment**.
3. Review the object ID. Enter a material ID, then use the existing **Validate request** and **Execute request** actions.
4. Refresh to inspect the retained assignment. Save a complete request to reload it, or reload the operator to recover its last durable operation.
5. Build the existing digital delivery. `editable-source.json` retains the exact assignment operation and each object's `material_id`.

IDs have 1–128 ASCII characters, beginning with a letter or digit; subsequent characters may also be dot, underscore, colon or hyphen. No trimming, case conversion or label substitution occurs. A previously unassigned object starts with an empty field. Empty or invalid IDs cannot be saved, validated or executed through the typed editor. Blank does not clear an assignment.

This ID is a semantic identity only. It supplies no physical material properties, manufacturing suitability, Blender evidence or fabrication authority. Assignment changes no primitive dimensions, topology or position. Existing replacement and duplicate creates still reset position to the origin and material to none.

Preparation replaces unsaved operation fields but sends no operation. Changing selection, refreshing, or a late response does not retarget an already prepared draft. Model navigation invalidates the retained inventory. Preparing a new draft binds the snapshot's workspace-global parent, never the model-filtered source digest; later workspace mutations can make it stale and the native adapter refuses stale execution.

The operator's material route checks the existing object against its verified, bounded retained project/model inventory before validating or executing. Missing and foreign objects, unsupported history, and integrity errors fail closed. This is a narrow operator safeguard: the native deterministic reference backend itself tracks semantic lineage rather than independently validating full object geometry. It is not a generalized geometry-validation claim. An assignment replay is also subject to this current-inventory safeguard; if the object has since been removed or history is unsupported, refresh and resolve that state first.

## Development and verification scope

Round 29 starts from the exact accepted Round 25 MoonMold source. The user's cloud-only continuation overrides the historical `/Users/kq/moonsuite` workspace location in `AGENTS.md`; this round stays in its private cloud candidate. No Mac, provider, Blender, hardware, remote push, credentials, module-manifest or vendor-source changes are needed.

Regression coverage includes compiled typed editor state, native no-listener operator execution, interleaved model/global-parent refusal, retained projection, request save/load, startup recovery, delivery source and digest parity, unchanged primitive mesh/position, invalid IDs, missing/foreign objects, dirty drafts and response races, and replacement reset. Normal UI assets are built separately. Full Node aggregation may still encounter historical external fixture dependencies; qualification must report focused and full-suite outcomes separately.
