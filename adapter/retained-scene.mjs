import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AdapterRejection, canonicalJson } from "./protocol.mjs";
import { DELIVERY_BACKEND, reconstructModel, renderSvg } from "./delivery-geometry.mjs";

const JOURNAL = ".moonsuite/products/moonmold/runtime/semantic-journal.json";
export const RETAINED_LIMITS = Object.freeze({ journal_bytes: 4 * 1024 * 1024, journal_entries: 2000, objects: 100 });
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const reject = (code, message) => { throw new AdapterRejection(code, message); };

async function journalBytes(workspace) {
  const file = path.join(workspace, JOURNAL);
  try {
    if ((await stat(file)).size > RETAINED_LIMITS.journal_bytes) reject("retained-scene-limit", "Retained scene exceeds the bounded journal size; no partial inventory was produced");
    const bytes = await readFile(file);
    if (bytes.length > RETAINED_LIMITS.journal_bytes) reject("retained-scene-limit", "Retained scene exceeds the bounded journal size");
    return bytes;
  } catch (error) {
    if (error.code === "ENOENT") return Buffer.from("[]");
    throw error;
  }
}

// Read-only, as-of projection. Every journal entry is verified because the
// native scene parent is WORKSPACE-global, even though geometry is model-local.
// Never use the model/source digest as expected_parent_digest. No-op receipts
// retain an old digest; only applied entries advance the workspace head.
export async function retainedScene(workspace, projectId, modelId, loadRun) {
  const bytes = await journalBytes(workspace);
  const journal = JSON.parse(bytes);
  if (!Array.isArray(journal) || journal.length > RETAINED_LIMITS.journal_entries) reject("retained-scene-limit", "Retained scene requires a bounded complete journal; no partial inventory was produced");
  const operations = [];
  let parent = "mm1-empty-scene";
  for (const entry of journal) {
    const run = await loadRun(entry?.flow_request?.attempt_id);
    if (!run || canonicalJson(run.request) !== canonicalJson(entry.spatial_request) ||
        canonicalJson(run.flow_request) !== canonicalJson(entry.flow_request) ||
        run.flow_request.operation !== "spatial.operation.execute" || run.result.status !== "succeeded" ||
        !["applied", "idempotent-no-op"].includes(run.receipt?.outcome) ||
        run.receipt.backend_qualification?.selected_backend !== DELIVERY_BACKEND.mode ||
        run.receipt.backend_qualification?.blender_evidence !== false || run.receipt.physical_authority !== false) {
      reject("retained-scene-integrity", "Journal source is not bound to its verified deterministic execution receipt");
    }
    if (run.receipt.outcome === "applied") {
      if (run.receipt.before_digest !== parent || typeof run.receipt.after_digest !== "string" || !run.receipt.after_digest) reject("retained-scene-integrity", "Applied workspace scene lineage is discontinuous");
      parent = run.receipt.after_digest;
      if (run.request.project_id === projectId && run.request.model_id === modelId) operations.push(run.request.operation);
    }
  }
  if (!bytes.equals(await journalBytes(workspace))) reject("retained-scene-changed", "Workspace changed while reading retained objects; refresh to obtain one complete snapshot");
  const base = {
    contract_id: "moonmold.retained-scene.v1", project_id: projectId, model_id: modelId,
    workspace_parent_digest: parent, journal_digest: sha(bytes), journal_entries: journal.length,
    backend: DELIVERY_BACKEND, dimension_units: "mm", translation_units: "mm",
    physical_authority: false, as_of: "verified journal snapshot; refresh after other workspace operations",
    limits: RETAINED_LIMITS,
  };
  if (!operations.length) return { ...base, status: "empty", message: "No applied model operations in this project/model", objects: [], preview_data_url: null, model: null };
  let model;
  try { model = reconstructModel(operations, { allowEmpty: true }); }
  catch (error) {
    if (!(error instanceof AdapterRejection)) throw error;
    return { ...base, status: "unsupported", message: `${error.code}: ${error.message}`, objects: [], preview_data_url: null, model: null };
  }
  if (model.objects.length > RETAINED_LIMITS.objects) reject("retained-scene-limit", "Model exceeds the 100-object inventory limit; no partial inventory was produced");
  const sourceDigest = sha(canonicalJson(model));
  return {
    ...base, status: "ready", message: model.objects.length ? "Verified retained primitives; selection only prepares a request" : "Model exists with no retained primitives",
    model, objects: model.objects, source_digest: sourceDigest,
    preview_data_url: model.objects.length ? `data:image/svg+xml;base64,${Buffer.from(renderSvg(model, sourceDigest)).toString("base64")}` : null,
  };
}
