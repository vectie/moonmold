import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createOperatorServer } from "./operator-server.mjs";
import { retainedScene, RETAINED_LIMITS } from "./retained-scene.mjs";

async function call(workspace, method, url, body) {
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
const sceneUrl = (project = "project-a", model = "model-a") => `/api/scene/retained?project_id=${project}&model_id=${model}`;
const box = (id = "shared") => ({ method: "scene.create-box", params: { objectId: id, widthMm: 10, depthMm: 20, heightMm: 30 } });
const cylinder = (id = "round") => ({ method: "scene.create-cylinder", params: { objectId: id, radiusMm: 5, heightMm: 25, sides: 9 } });
const create = { method: "scene.create-model", params: { name: "retained-model", units: "cm", coordinateFrame: "z-up-right-handed" } };

test("retained inventory verifies global lineage but filters geometry across interleaved models and projects", { timeout: 180_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-retained-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  assert.equal((await ok(workspace, "GET", sceneUrl())).status, "empty");
  let parent = "mm1-empty-scene", serial = 0;
  const execute = async (operation, project = "project-a", model = "model-a", extra = {}) => {
    serial += 1;
    const request = {
      contract_id: "moonmold.spatial-operation-request.v1", request_id: `retained-${serial}`, idempotency_key: `retained-${serial}`,
      project_id: project, model_id: model, expected_parent_digest: parent, authority: "WorkspaceMutation",
      intent: "Retained-scene regression fixture", reference_artifacts: [], constraints: ["No physical authority"], backend_preference: "mock-reference", operation, ...extra,
    };
    const run = await ok(workspace, "POST", "/api/run", { mode: "execute", request });
    if (run.receipt.outcome === "applied") parent = run.receipt.after_digest;
    return run;
  };
  await execute(create);
  assert.equal((await ok(workspace, "GET", sceneUrl())).objects.length, 0);
  const declared = await execute(box());
  await execute(cylinder());
  await execute({ method: "scene.set-transform", params: { objectId: "shared", xMm: -12, yMm: 22, zMm: 33 } });
  await execute({ method: "scene.assign-material", params: { objectId: "shared", materialId: "blue-steel" } });
  await execute(create, "project-a", "model-b");
  await execute(cylinder("shared"), "project-a", "model-b");
  await execute(create, "project-b", "model-a");
  const last = await execute(box("foreign-only"), "project-b", "model-a");
  const beforeBytes = await readFile(path.join(workspace, ".moonsuite/products/moonmold/runtime/semantic-journal.json"));
  const scene = await ok(workspace, "GET", sceneUrl());
  assert.deepEqual(scene.objects.map((o) => o.object_id), ["round", "shared"]);
  assert.equal(scene.objects[1].kind, "box");
  assert.deepEqual(scene.objects[1].translation_mm, { x: -12, y: 22, z: 33 });
  assert.equal(scene.objects[1].material_id, "blue-steel");
  assert.equal(scene.workspace_parent_digest, last.receipt.after_digest);
  assert.notEqual(scene.workspace_parent_digest, scene.source_digest);
  assert.equal(scene.model.units, "cm");
  assert.equal(scene.dimension_units, "mm");
  assert.equal((await ok(workspace, "GET", sceneUrl("project-a", "model-b"))).objects[0].kind, "cylinder");
  assert.equal((await ok(workspace, "GET", sceneUrl("project-b", "model-a"))).objects[0].object_id, "foreign-only");
  assert.deepEqual(await readFile(path.join(workspace, ".moonsuite/products/moonmold/runtime/semantic-journal.json")), beforeBytes, "GET does not mutate retained state");
  const svg = Buffer.from(scene.preview_data_url.split(",")[1], "base64").toString();
  assert.match(svg, /FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY/);
  assert.doesNotMatch(svg, /foreign-only|NaN|Infinity|<script/);
  // A replay may report its old after_digest. It must not reset geometry or
  // move the global expected parent backward after later workspace changes.
  const replay = await execute(box(), "project-a", "model-a", { idempotency_key: declared.request.idempotency_key });
  assert.equal(replay.receipt.outcome, "idempotent-no-op");
  const replayed = await ok(workspace, "GET", sceneUrl());
  assert.deepEqual(replayed.objects, scene.objects);
  assert.equal(replayed.workspace_parent_digest, parent);
  const recoveredReplay = await ok(workspace, "GET", "/api/recovery/latest");
  assert.equal(recoveredReplay.attempt_id, replay.flow_request.attempt_id);
  assert.equal(recoveredReplay.run.receipt.outcome, "idempotent-no-op");
  const replaced = await execute(cylinder("shared"));
  const replacement = await ok(workspace, "GET", sceneUrl());
  assert.equal(replacement.objects[1].kind, "cylinder");
  assert.deepEqual(replacement.objects[1].translation_mm, { x: 0, y: 0, z: 0 });
  assert.equal(replacement.objects[1].material_id, null);
  const stale = await call(workspace, "POST", "/api/run", { mode: "execute", request: {
    ...replaced.request, request_id: "stale-selection", idempotency_key: "stale-selection", expected_parent_digest: scene.workspace_parent_digest,
    operation: { method: "scene.set-transform", params: { objectId: "shared", xMm: 99, yMm: 0, zMm: 0 } },
  } });
  assert.equal(stale.status, 400);
  assert.deepEqual((await ok(workspace, "GET", sceneUrl())).objects, replacement.objects);
  await execute(create);
  assert.deepEqual((await ok(workspace, "GET", sceneUrl())).objects, [], "Create model resets only the selected model inventory");
  assert.equal((await ok(workspace, "GET", sceneUrl("project-b", "model-a"))).objects[0].object_id, "foreign-only");
  await execute(cylinder("shared"));
  await execute(cylinder("round"));
  await execute({ method: "scene.boolean-subtract", params: { targetId: "shared", cutterId: "round" } });
  const unsupported = await ok(workspace, "GET", sceneUrl());
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(unsupported.objects, []);
  assert.equal(unsupported.preview_data_url, null);
  assert.match(unsupported.message, /unsupported-delivery-operation/);
  if (process.env.MOONMOLD_RETAINED_EVIDENCE_DIR) {
    const destination = process.env.MOONMOLD_RETAINED_EVIDENCE_DIR;
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "snapshots.json"), `${JSON.stringify({ scene, replayed, recoveredReplay, replacement, unsupported, stale: stale.json() }, null, 2)}\n`);
    await cp(workspace, path.join(destination, "workspace"), { recursive: true });
  }
  const replayRoot = path.join(workspace, `.moonsuite/products/moonmold/adapter-attempts/${replay.flow_request.attempt_id}`);
  const replayBytes = await readFile(path.join(replayRoot, "operation-receipt.json"));
  const resultBytes = await readFile(path.join(replayRoot, "adapter-result.json"));
  const forgedReceipt = JSON.parse(replayBytes);
  forgedReceipt.before_digest = parent; forgedReceipt.after_digest = parent;
  const forgedBytes = JSON.stringify(forgedReceipt);
  const forgedResult = JSON.parse(resultBytes);
  forgedResult.output_digest = `sha256:${createHash("sha256").update(forgedBytes).digest("hex")}`;
  await writeFile(path.join(replayRoot, "operation-receipt.json"), forgedBytes);
  await writeFile(path.join(replayRoot, "adapter-result.json"), JSON.stringify(forgedResult));
  const forged = await call(workspace, "GET", sceneUrl());
  assert.equal(forged.status, 400);
  assert.match(forged.json().message, /replay digest is not bound/);
  await writeFile(path.join(replayRoot, "operation-receipt.json"), replayBytes);
  await writeFile(path.join(replayRoot, "adapter-result.json"), resultBytes);
  // Corrupt a foreign model's receipt: workspace-global parent must fail closed.
  const receiptPath = path.join(workspace, `.moonsuite/products/moonmold/adapter-attempts/${last.flow_request.attempt_id}/operation-receipt.json`);
  await writeFile(receiptPath, "{}\n");
  assert.equal((await call(workspace, "GET", sceneUrl())).status, 400);
});

test("retained projection bounds and concurrent changes fail closed", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-retained-bounds-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const file = path.join(workspace, ".moonsuite/products/moonmold/runtime/semantic-journal.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, " ".repeat(RETAINED_LIMITS.journal_bytes + 1));
  await assert.rejects(retainedScene(workspace, "p", "m", () => null), { code: "retained-scene-limit" });
  await writeFile(file, JSON.stringify(Array(RETAINED_LIMITS.journal_entries + 1).fill({})));
  await assert.rejects(retainedScene(workspace, "p", "m", () => null), { code: "retained-scene-limit" });
  const entry = { spatial_request: { project_id: "p", model_id: "m", operation: create }, flow_request: { attempt_id: "test", operation: "spatial.operation.execute" } };
  await writeFile(file, JSON.stringify([entry]));
  await assert.rejects(retainedScene(workspace, "p", "m", async () => {
    await writeFile(file, "[]");
    return { request: entry.spatial_request, flow_request: entry.flow_request, result: { status: "succeeded" }, receipt: {
      outcome: "applied", before_digest: "mm1-empty-scene", after_digest: "mm1-next", physical_authority: false,
      backend_qualification: { selected_backend: "deterministic-mock-reference", blender_evidence: false },
    } };
  }), { code: "retained-scene-changed" });
  assert.equal((await call(workspace, "GET", "/api/scene/retained?project_id=../bad&model_id=m")).status, 400);
  const entries = [create, ...Array.from({ length: 101 }, (_, index) => box(`object-${index}`))].map((operation, index) => ({
    spatial_request: { project_id: "p", model_id: "m", operation },
    flow_request: { attempt_id: `bound-${index}`, operation: "spatial.operation.execute" },
  }));
  await writeFile(file, JSON.stringify(entries));
  await assert.rejects(retainedScene(workspace, "p", "m", async (id) => {
    const index = Number(id.slice(6));
    return { request: entries[index].spatial_request, flow_request: entries[index].flow_request, result: { status: "succeeded" }, receipt: {
      outcome: "applied", before_digest: index === 0 ? "mm1-empty-scene" : `mm1-${index - 1}`, after_digest: `mm1-${index}`, physical_authority: false,
      backend_qualification: { selected_backend: "deterministic-mock-reference", blender_evidence: false },
    } };
  }), { code: "retained-scene-limit" });
});
