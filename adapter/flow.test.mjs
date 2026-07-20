import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { attestFlow, executeFlow } from "./flow.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO, ".tmp/flow-adapter-test");
const PLAN = path.join(REPO, "fixtures/habitat-a.json");

async function fixture() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(path.join(ROOT, "inputs"), { recursive: true });
  await mkdir(path.join(ROOT, "runtime"), { recursive: true });
  await mkdir(path.join(ROOT, "drafts"), { recursive: true });
  await mkdir(path.join(ROOT, "outputs"), { recursive: true });
  await writeFile(path.join(ROOT, "inputs/plan.json"), await readFile(PLAN));
  await writeFile(path.join(ROOT, "runtime/request.json"), `${JSON.stringify({
    request_id: "request-flow-moonmold-1",
    run_id: "flow-moonmold-1",
    book_id: "moonmold-flow-test",
    work_item_id: "model-habitat",
    declaration_id: "model-habitat",
    attempt_id: "attempt-model-habitat-1",
    idempotency_key: "flow-moonmold-1/model-habitat/1/input",
    product_id: "moonmold",
    operation: "live-building",
    requested_authority: "workspace-mutation",
    acceptance_criteria: ["real Blender output remains digital-only"],
    input_contracts: ["moonmold-building-plan-v1"],
    output_contracts: ["moonmold.live-building-result.v1"],
    required_claim: "digital-artifact",
    input_digest: "sha256:input",
    input_artifacts: ["inputs/plan.json"],
    timeout_ms: 120000,
    created_at: "2026-07-13T00:00:00Z",
  }, null, 2)}\n`);
}

test("Flow owns live Blender execution, immutable replay, and native attestation", async () => {
  await fixture();
  const args = {
    workspace: ROOT,
    requestRef: "runtime/request.json",
    resultRef: "runtime/result.json",
    draftRef: "drafts/model.json",
  };
  const first = await executeFlow(args);
  const repeated = await executeFlow(args);
  assert.equal(first.output_digest, repeated.output_digest);
  assert.ok(["succeeded", "idempotent-no-op"].includes(first.status));
  const attestation = await attestFlow({
    workspace: ROOT,
    requestRef: "runtime/request.json",
    resultRef: "runtime/result.json",
    attestationRef: "runtime/attestation.json",
    attestorId: "moonmold-native-attestor-v1",
    draftRef: "drafts/model.json",
    finalRef: "outputs/model.json",
  });
  assert.equal(attestation.accepted, true);
  const final = JSON.parse(await readFile(path.join(ROOT, "outputs/model.json"), "utf8"));
  assert.equal(final.claim_ceiling, "digital-artifact");
  assert.equal(final.physical_effects, false);
  assert.equal(final.simulation_evidence, false);
  assert.equal(final.manufacturing_authority, false);
  assert.equal(final.blender.source, "workspace-tool-manifest");
  assert.equal(final.execution_provenance.evidence_class, "live-blender");
  assert.equal(final.execution_provenance.unrestricted_scripts, false);
  assert.ok(final.preserved_unknowns.length >= 3);
  for (const name of ["model.blend", "model.glb", "model.stl", "render.png"]) {
    assert.match(final.verified_outputs[name].digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(final.verified_outputs[name].size >= 64);
  }
});

test("Flow rejects a draft that overclaims physical authority", async () => {
  await fixture();
  await executeFlow({
    workspace: ROOT,
    requestRef: "runtime/request.json",
    resultRef: "runtime/result.json",
    draftRef: "drafts/model.json",
  });
  const draftPath = path.join(ROOT, "drafts/model.json");
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  draft.physical_effects = true;
  await writeFile(draftPath, `${JSON.stringify(draft)}\n`);
  await assert.rejects(attestFlow({
    workspace: ROOT,
    requestRef: "runtime/request.json",
    resultRef: "runtime/result.json",
    attestationRef: "runtime/attestation.json",
    attestorId: "moonmold-native-attestor-v1",
    draftRef: "drafts/model.json",
    finalRef: "outputs/model.json",
  }), /invalid/i);
});
