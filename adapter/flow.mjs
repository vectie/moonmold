import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runLiveBlenderExperiment } from "./live-blender.mjs";
import { AdapterRejection, assertWorkspaceRoot, canonicalJson } from "./protocol.mjs";

function safeReference(reference) {
  return typeof reference === "string" &&
    reference.length > 0 &&
    !path.isAbsolute(reference) &&
    !reference.includes("\0") &&
    !reference.replaceAll("\\", "/").split("/").some((part) => part === ".." || part === "");
}

function scoped(workspace, reference) {
  const root = assertWorkspaceRoot(path.resolve(workspace));
  if (!safeReference(reference)) {
    throw new AdapterRejection("workspace-boundary", "Flow artifact reference must be workspace-relative");
  }
  const resolved = path.resolve(root, reference);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new AdapterRejection("workspace-boundary", "Flow artifact escapes the workspace");
  }
  return resolved;
}

async function jsonAt(workspace, reference) {
  return JSON.parse(await readFile(scoped(workspace, reference), "utf8"));
}

function requireIdentity(request) {
  for (const field of ["request_id", "attempt_id", "idempotency_key", "run_id", "work_item_id"]) {
    if (typeof request[field] !== "string" || !request[field]) {
      throw new AdapterRejection("invalid-flow-request", `MoonMold Flow request requires ${field}`);
    }
  }
  if (
    request.product_id !== "moonmold" ||
    request.operation !== "live-building" ||
    request.required_claim !== "digital-artifact"
  ) {
    throw new AdapterRejection(
      "invalid-flow-request",
      "MoonMold owns only live-building at the digital-artifact claim ceiling",
    );
  }
  if (request.requested_authority === "external-effect" || request.requested_authority === "physical-effect") {
    throw new AdapterRejection("authority-exceeded", "MoonMold Flow cannot accept external or physical authority");
  }
}

async function findPlan(workspace, request) {
  if (!Array.isArray(request.input_artifacts)) {
    throw new AdapterRejection("missing-building-plan", "MoonMold Flow requires input artifacts");
  }
  for (const reference of request.input_artifacts) {
    if (!safeReference(reference)) continue;
    try {
      const candidate = await jsonAt(workspace, reference);
      if (candidate?.schema === "moonmold-building-plan-v1") return { reference, candidate };
    } catch (error) {
      if (error instanceof AdapterRejection) throw error;
    }
  }
  throw new AdapterRejection(
    "missing-building-plan",
    "MoonMold Flow could not find a moonmold-building-plan-v1 input",
  );
}

async function immutableJson(workspace, reference, value) {
  const output = scoped(workspace, reference);
  const bytes = `${canonicalJson(value)}\n`;
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await writeFile(output, bytes, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || await readFile(output, "utf8") !== bytes) {
      throw new AdapterRejection("immutable-output-conflict", `MoonMold Flow output conflicts: ${reference}`);
    }
  }
  return bytes;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function declaredArtifactDigest(workspace, references) {
  const identities = [];
  for (const reference of references) {
    identities.push(`${reference}|${sha256(await readFile(scoped(workspace, reference)))}`);
  }
  return sha256(identities.join("\n"));
}

export async function executeFlow({ workspace, requestRef, resultRef, draftRef }) {
  const request = await jsonAt(workspace, requestRef);
  requireIdentity(request);
  try {
    const existing = await jsonAt(workspace, resultRef);
    if (
      existing.request_id !== request.request_id ||
      existing.attempt_id !== request.attempt_id ||
      existing.idempotency_key !== request.idempotency_key ||
      existing.product_id !== "moonmold"
    ) {
      throw new AdapterRejection(
        "immutable-output-conflict",
        "MoonMold Flow result belongs to a different request",
      );
    }
    return existing;
  } catch (error) {
    if (error instanceof AdapterRejection) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const { reference: planRef } = await findPlan(workspace, request);
  const outputRef = `.moonsuite/products/moonmold/runs/${request.run_id}/${request.work_item_id}/${request.attempt_id}`;
  const evidence = await runLiveBlenderExperiment({
    inputPath: scoped(workspace, planRef),
    outputRoot: scoped(workspace, outputRef),
    timeoutMs: Math.min(Number(request.timeout_ms) || 120_000, 300_000),
  });
  const draft = {
    contract_id: "moonmold.live-building-result.v1",
    product_id: "moonmold",
    operation: "live-building",
    plan_id: evidence.planId,
    plan_ref: planRef,
    live_evidence_ref: `${outputRef}/live-evidence.json`,
    editable_model_ref: `${outputRef}/model.blend`,
    engineering_model_ref: `${outputRef}/model.glb`,
    manufacturing_candidate_ref: `${outputRef}/model.stl`,
    presentation_ref: `${outputRef}/render.png`,
    input_digest: evidence.inputDigest,
    object_count: evidence.objectCount,
    bounds_meters: evidence.boundsMeters,
    blender: evidence.blender,
    representations: {
      editable: "editable-authoring-model",
      engineering: "engineering-model",
      presentation: "visual-styled-model",
      simulation_input: "simulation-model",
      manufacturing: "manufacturing-candidate",
    },
    lineage: [
      "editable-authoring-model modeled-from spatial-intent",
      "engineering-model modeled-from editable-authoring-model",
      "visual-styled-model styled-from engineering-model",
      "simulation-model physics-derived-from engineering-model",
      "manufacturing-candidate manufacturing-derived-from engineering-model",
    ],
    claim_ceiling: "digital-artifact",
    simulation_evidence: false,
    manufacturing_authority: false,
    physical_effects: false,
    unknowns_preserved: true,
  };
  const draftBytes = await immutableJson(workspace, draftRef, draft);
  const result = {
    result_id: `result-${request.attempt_id}-succeeded`,
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    idempotency_key: request.idempotency_key,
    product_id: "moonmold",
    external_job_id: `moonmold-${request.attempt_id}`,
    status: evidence.outcome === "idempotent-no-op" ? "idempotent-no-op" : "succeeded",
    output_digest: await declaredArtifactDigest(workspace, [draftRef]),
    output_artifacts: [draftRef],
    error_kind: "",
    compensable: true,
    recorded_at: request.created_at,
    trial_count: 1,
  };
  await immutableJson(workspace, resultRef, result);
  return result;
}

async function validateLiveEvidence(workspace, draft) {
  const evidence = await jsonAt(workspace, draft.live_evidence_ref);
  if (
    evidence.schema !== "moonmold-live-blender-evidence-v1" ||
    evidence.evidenceClass !== "live-blender" ||
    evidence.accepted !== true ||
    evidence.physicalEffects !== false ||
    evidence.planId !== draft.plan_id ||
    evidence.inputDigest !== draft.input_digest
  ) {
    throw new AdapterRejection("invalid-live-evidence", "MoonMold live evidence does not match the draft");
  }
  for (const [field, name] of [
    ["editable_model_ref", "model.blend"],
    ["engineering_model_ref", "model.glb"],
    ["manufacturing_candidate_ref", "model.stl"],
    ["presentation_ref", "render.png"],
  ]) {
    const info = await stat(scoped(workspace, draft[field]));
    if (!info.isFile() || info.size < 64 || !evidence.outputs?.[name]?.digest) {
      throw new AdapterRejection("invalid-live-evidence", `MoonMold output is invalid: ${name}`);
    }
  }
}

export async function attestFlow({ workspace, requestRef, resultRef, attestationRef, attestorId, draftRef, finalRef }) {
  const request = await jsonAt(workspace, requestRef);
  requireIdentity(request);
  const result = await jsonAt(workspace, resultRef);
  const draftBytes = await readFile(scoped(workspace, draftRef), "utf8");
  const draft = JSON.parse(draftBytes);
  if (
    result.request_id !== request.request_id ||
    result.attempt_id !== request.attempt_id ||
    result.idempotency_key !== request.idempotency_key ||
    result.product_id !== "moonmold" ||
    !["succeeded", "idempotent-no-op"].includes(result.status) ||
    result.output_digest !== await declaredArtifactDigest(workspace, [draftRef]) ||
    draft.contract_id !== "moonmold.live-building-result.v1" ||
    draft.product_id !== "moonmold" ||
    draft.operation !== "live-building" ||
    draft.claim_ceiling !== "digital-artifact" ||
    draft.simulation_evidence !== false ||
    draft.manufacturing_authority !== false ||
    draft.physical_effects !== false
  ) {
    throw new AdapterRejection("invalid-flow-result", "MoonMold Flow result identity or claim boundary is invalid");
  }
  await validateLiveEvidence(workspace, draft);
  await immutableJson(workspace, finalRef, draft);
  const attestation = {
    contract_id: "moonflow.product-attestation.v1",
    attestor_id: attestorId,
    product_id: "moonmold",
    request_id: request.request_id,
    result_id: result.result_id,
    output_digest: result.output_digest,
    accepted: true,
    native_final_artifact: finalRef,
    operation: "live-building",
  };
  await immutableJson(workspace, attestationRef, attestation);
  return attestation;
}
