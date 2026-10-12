import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createOperatorServer } from "./operator-server.mjs";
import { objectMesh, reconstructModel } from "./delivery-geometry.mjs";

const assignments = JSON.parse(await readFile(new URL("../fixtures/typed-material-controls.json", import.meta.url), "utf8"));
const sceneUrl = (model = "model-a") => `/api/scene/retained?project_id=material-project&model_id=${model}`;
const create = { method: "scene.create-model", params: { name: "material-fixture", units: "mm", coordinateFrame: "z-up-right-handed" } };
const box = { method: "scene.create-box", params: { objectId: "primary-mass", widthMm: 10, depthMm: 20, heightMm: 30 } };
const cylinder = { method: "scene.create-cylinder", params: { objectId: "cylinder-b", radiusMm: 5, heightMm: 25, sides: 9 } };

async function call(workspace, method, url, body) {
  // Each call creates a fresh host, exercising durable state rather than a
  // retained server instance. No listener, Blender or provider is started.
  const server = createOperatorServer({ workspaceRoot: workspace });
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method; request.url = url;
  let status, text;
  await server.listeners("request")[0](request, { writeHead(code) { status = code; }, end(value) { text = String(value); } });
  assert.equal(server.address(), null);
  return { status, text, json: () => JSON.parse(text) };
}
async function ok(...args) {
  const response = await call(...args);
  assert.equal(response.status, 200, response.text);
  return response.json();
}

test("typed material IDs round-trip through native receipts retained selection recovery and delivery without geometry changes", { timeout: 240_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-material-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const journalPath = path.join(workspace, ".moonsuite/products/moonmold/runtime/semantic-journal.json");
  const brief = await ok(workspace, "POST", "/api/delivery/brief", { brief: {
    contract_id: "moonmold.digital-brief.v1", commitment_ref: "material-fixture", revision: 1,
    project_id: "material-project", model_id: "model-a", intended_use: "Semantic material identity delivery fixture",
    units: "mm", coordinate_frame: "z-up-right-handed", dimensions_mm: { width: 10, depth: 20, height: 30 },
    constraints: ["Semantic labels only; no physical properties"], deliverables: ["editable-source", "presentation"],
    review_criteria: ["Exact material identity and unchanged primitive geometry"], physical_authority: false,
  } });
  let parent = "mm1-empty-scene", serial = 0;
  const request = (operation, model = "model-a", overrides = {}) => ({
    contract_id: "moonmold.spatial-operation-request.v1", request_id: `material-${++serial}`, idempotency_key: `material-${serial}`,
    project_id: "material-project", model_id: model, expected_parent_digest: parent, authority: "WorkspaceMutation",
    intent: "Semantic identity regression fixture", reference_artifacts: [brief.reference], constraints: ["No physical authority"], backend_preference: "mock-reference", operation, ...overrides,
  });
  const execute = async (operation, model = "model-a", overrides = {}) => {
    const run = await ok(workspace, "POST", "/api/run", { mode: "execute", request: request(operation, model, overrides) });
    assert.equal(run.receipt.physical_authority, false);
    assert.equal(run.receipt.backend_qualification.blender_evidence, false);
    if (run.receipt.outcome === "applied") parent = run.receipt.after_digest;
    return run;
  };
  await execute(create);
  await execute(box);
  await execute(cylinder);
  await execute({ method: "scene.set-transform", params: { objectId: "primary-mass", xMm: -12, yMm: 22, zMm: 33 } });
  await execute({ method: "scene.set-transform", params: { objectId: "cylinder-b", xMm: 42, yMm: -5, zMm: 9 } });
  const before = await ok(workspace, "GET", sceneUrl());
  const geometry = before.objects.map(objectMesh);
  const runs = [];
  for (const operation of assignments) {
    const draft = request(operation);
    const saved = await ok(workspace, "POST", "/api/request/save", { request: draft });
    const loaded = await ok(workspace, "POST", "/api/request/load", { reference: saved.reference });
    assert.deepEqual(loaded.request, draft);
    const bytes = await readFile(journalPath);
    const validation = await ok(workspace, "POST", "/api/run", { mode: "validate", request: draft });
    assert.equal(validation.receipt.validation_evidence.accepted, true);
    assert.deepEqual(await readFile(journalPath), bytes, "validation never applies assignment");
    const run = await ok(workspace, "POST", "/api/run", { mode: "execute", request: draft });
    assert.equal(run.receipt.outcome, "applied");
    parent = run.receipt.after_digest;
    runs.push(run);
  }
  const scene = await ok(workspace, "GET", sceneUrl());
  for (const operation of assignments) assert.equal(scene.objects.find((object) => object.object_id === operation.params.objectId).material_id, operation.params.materialId);
  assert.deepEqual(scene.objects.map(objectMesh), geometry);
  assert.deepEqual(scene.objects.map(({ material_id, ...object }) => object), before.objects.map(({ material_id, ...object }) => object));
  const recovery = await ok(workspace, "GET", "/api/recovery/latest");
  assert.deepEqual(recovery.run.request.operation, assignments[1]);
  const replay = await execute(assignments[0], "model-a", { idempotency_key: runs[0].request.idempotency_key });
  assert.equal(replay.receipt.outcome, "idempotent-no-op");
  assert.deepEqual((await ok(workspace, "GET", sceneUrl())).objects, scene.objects);
  const failures = [];
  const stable = await readFile(journalPath);
  for (const materialId of ["", "bad label", "../bad", "-bad", "a/b", "a\nb", "é", "a".repeat(129)]) {
    const response = await call(workspace, "POST", "/api/run", { mode: "execute", request: request({ method: "scene.assign-material", params: { objectId: "primary-mass", materialId } }) });
    assert.equal(response.status, 400); failures.push(response.json());
  }
  for (const mode of ["validate", "execute"]) {
    const response = await call(workspace, "POST", "/api/run", { mode, request: request({ method: "scene.assign-material", params: { objectId: "missing", materialId: "blue" } }) });
    assert.equal(response.status, 400); assert.equal(response.json().code, "unknown-material-object"); failures.push(response.json());
  }
  assert.deepEqual(await readFile(journalPath), stable, "invalid assignments leave journal bytes unchanged");
  // An interleaved foreign model advances the native workspace-global parent.
  // The selected model's geometry digest must never stand in for that parent.
  await execute(create, "model-b");
  await execute({ ...box, params: { ...box.params, objectId: "foreign-only" } }, "model-b");
  const globalScene = await ok(workspace, "GET", sceneUrl());
  assert.deepEqual(globalScene.objects, scene.objects);
  assert.equal(globalScene.workspace_parent_digest, parent);
  assert.notEqual(globalScene.workspace_parent_digest, scene.workspace_parent_digest);
  assert.equal(globalScene.source_digest, scene.source_digest);
  const stale = await call(workspace, "POST", "/api/run", { mode: "execute", request: request(assignments[0], "model-a", { expected_parent_digest: scene.workspace_parent_digest }) });
  assert.equal(stale.status, 400); failures.push(stale.json());
  const foreign = await call(workspace, "POST", "/api/run", { mode: "execute", request: request({ method: "scene.assign-material", params: { objectId: "foreign-only", materialId: "blue" } }) });
  assert.equal(foreign.status, 400); assert.equal(foreign.json().code, "unknown-material-object"); failures.push(foreign.json());
  assert.deepEqual((await ok(workspace, "GET", sceneUrl())).objects, scene.objects);
  const exported = await execute({ method: "representation.export", params: { representation: "presentation", outputPath: ".moonsuite/products/moonmold/projects/material-project/model-a/representations/material.json" } });
  const delivery = await ok(workspace, "POST", "/api/delivery/build", { attempt_id: exported.flow_request.attempt_id, brief_ref: brief.reference });
  const bundle = await ok(workspace, "GET", delivery.download_url);
  for (const file of bundle.file_contents) assert.equal(file.sha256, `sha256:${createHash("sha256").update(file.text).digest("hex")}`);
  const source = JSON.parse(bundle.file_contents.find((file) => file.name === "editable-source.json").text);
  assert.deepEqual(source.model.objects, scene.objects);
  assert.deepEqual(source.operations.filter((operation) => operation.method === "scene.assign-material"), assignments);
  assert.deepEqual(reconstructModel(source.operations).objects, scene.objects);
  await execute(box);
  await execute(cylinder);
  const replacement = await ok(workspace, "GET", sceneUrl());
  assert.deepEqual(replacement.objects.map((object) => object.material_id), [null, null]);
  assert.deepEqual(replacement.objects.map((object) => object.translation_mm), [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]);
  const frozenBundle = await ok(workspace, "GET", delivery.download_url);
  assert.deepEqual(frozenBundle, bundle, "later replacements cannot rewrite the frozen assigned delivery");
  if (process.env.MOONMOLD_MATERIAL_EVIDENCE_DIR) {
    const destination = process.env.MOONMOLD_MATERIAL_EVIDENCE_DIR;
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "snapshots.json"), `${JSON.stringify({ before, scene, globalScene, recovery, replacement, assignments, failures, source, delivery, runs }, null, 2)}\n`);
    await writeFile(path.join(destination, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
    await cp(workspace, path.join(destination, "workspace"), { recursive: true });
  }
});
