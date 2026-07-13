import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runBuildingExperiment, validateBuildingPlan } from "./experiment.mjs";
import { createMcpHandler } from "./mcp.mjs";
import { AdapterRejection, digest, resolveScopedPath } from "./protocol.mjs";
import { SemanticAdapterRuntime } from "./runtime.mjs";

const ROOT = "/Users/kq/moonsuite";
const REPO = path.join(ROOT, "development/sources/moonmold");
const TMP = path.join(REPO, ".tmp");

function envelope(runtime, overrides = {}) {
  return {
    projectId: "moonbook-building",
    sessionId: "session-1",
    modelId: "model-1",
    requestId: "request-1",
    idempotencyKey: "key-1",
    expectedParentDigest: runtime.sceneDigest,
    workspaceRoot: ROOT,
    deadlineMs: 30_000,
    authority: "workspace-mutation",
    method: "scene.create-model",
    params: {
      name: "building",
      units: "mm",
      coordinateFrame: "z-up-right-handed"
    },
    ...overrides
  };
}

async function rejectCode(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AdapterRejection);
    assert.equal(error.code, expected);
    return true;
  });
}

test("capability discovery declares no script or physical surface", () => {
  const capabilities = new SemanticAdapterRuntime().capabilities();
  assert.equal(capabilities.protocol, "moonmold.blender.v1");
  assert.equal(capabilities.unrestrictedScripts, false);
  assert.equal(capabilities.physicalControl, false);
  assert.ok(["fixed-semantic-bridge-only", "mock-reference-runtime"].includes(
    capabilities.blender.executionMode,
  ));
});

test("capability operation returns discovery evidence without scene mutation", async () => {
  const runtime = new SemanticAdapterRuntime();
  const before = runtime.sceneDigest;
  const receipt = await runtime.execute(envelope(runtime, {
    method: "capability.discover",
    params: {}
  }));
  assert.equal(receipt.afterDigest, before);
  assert.equal(receipt.result.unrestrictedScripts, false);
  assert.equal(receipt.result.physicalControl, false);
});

test("semantic model lifecycle returns attributable deterministic receipts", async () => {
  const runtime = new SemanticAdapterRuntime();
  const first = await runtime.execute(envelope(runtime));
  const box = await runtime.execute(envelope(runtime, {
    requestId: "request-2",
    idempotencyKey: "key-2",
    method: "scene.create-box",
    params: { objectId: "wall", widthMm: 5000, depthMm: 200, heightMm: 3000 }
  }));
  assert.equal(first.outcome, "applied");
  assert.equal(box.beforeDigest, first.afterDigest);
  assert.deepEqual(box.changedObjects, ["wall"]);
  assert.equal(box.validation.accepted, true);
});

test("identical duplicate is a no-op and conflicting duplicate fails", async () => {
  const runtime = new SemanticAdapterRuntime();
  const request = envelope(runtime);
  const first = await runtime.execute(request);
  const duplicate = await runtime.execute({ ...request, requestId: "request-duplicate" });
  assert.equal(duplicate.outcome, "idempotent-no-op");
  assert.equal(duplicate.afterDigest, first.afterDigest);
  await rejectCode(runtime.execute({
    ...request,
    requestId: "request-conflict",
    params: { ...request.params, name: "different" }
  }), "conflicting-idempotency-key");
});

test("stale parent fails without mutating current scene", async () => {
  const runtime = new SemanticAdapterRuntime();
  await runtime.execute(envelope(runtime));
  const current = runtime.sceneDigest;
  await rejectCode(runtime.execute(envelope(runtime, {
    requestId: "request-stale",
    idempotencyKey: "key-stale",
    expectedParentDigest: digest({ stale: true }),
    method: "scene.validate",
    params: {}
  })), "stale-parent");
  assert.equal(runtime.sceneDigest, current);
});

test("script, shell, eval and unknown methods fail closed", async () => {
  for (const [method, params, code] of [
    ["scene.create-model", {
      name: "building",
      units: "mm",
      coordinateFrame: "z-up-right-handed",
      pythonScript: "bpy.ops.wm.quit_blender()"
    }, "unrestricted-script-surface"],
    ["shell.run", {}, "unsupported-method"],
    ["scene.create-model", {
      name: "building",
      units: "mm",
      coordinateFrame: "z-up-right-handed",
      nested: { evalExpression: "1+1" }
    }, "unrestricted-script-surface"]
  ]) {
    const runtime = new SemanticAdapterRuntime();
    await rejectCode(runtime.execute(envelope(runtime, { method, params })), code);
  }
});

test("undeclared parameters cannot smuggle backend behavior", async () => {
  const runtime = new SemanticAdapterRuntime();
  await rejectCode(runtime.execute(envelope(runtime, {
    params: {
      name: "building",
      units: "mm",
      coordinateFrame: "z-up-right-handed",
      harmlessLookingFlag: true
    }
  })), "unexpected-parameter");
});

test("requesting live Blender cannot silently fall back to mock", async () => {
  const runtime = new SemanticAdapterRuntime({ backend: "blender" });
  await rejectCode(runtime.execute(envelope(runtime)), "backend-unavailable");
});

test("external and physical authorities are categorically rejected", async () => {
  for (const authority of ["external-effect", "physical-effect"]) {
    const runtime = new SemanticAdapterRuntime();
    await rejectCode(runtime.execute(envelope(runtime, { authority })), "authority-exceeded");
  }
});

test("deadlines and malformed geometry fail before mutation", async () => {
  const runtime = new SemanticAdapterRuntime();
  const initial = runtime.sceneDigest;
  await rejectCode(runtime.execute(envelope(runtime, { deadlineMs: 0 })), "invalid-deadline");
  await rejectCode(runtime.execute(envelope(runtime, {
    method: "scene.create-box",
    params: { objectId: "wall", widthMm: 0, depthMm: 200, heightMm: 3000 }
  })), "invalid-geometry");
  assert.equal(runtime.sceneDigest, initial);
});

test("workspace path boundary rejects traversal and foreign roots", () => {
  for (const candidate of [
    "/tmp/model.json",
    "/Users/kq/moonsuite/../escape.json",
    "/Users/kq/Workspace/model.json"
  ]) {
    assert.throws(() => resolveScopedPath(ROOT, candidate), {
      name: "AdapterRejection",
      code: "workspace-boundary"
    });
  }
  assert.throws(() => resolveScopedPath("/Users/kq/Workspace", "/Users/kq/Workspace/model.json"), {
    code: "workspace-boundary"
  });
});

test("export is immutable, workspace-scoped, and does not mutate geometry", async () => {
  const output = path.join(TMP, "export-test", "engineering.moonmold.json");
  await rm(path.dirname(output), { recursive: true, force: true });
  const runtime = new SemanticAdapterRuntime();
  await runtime.execute(envelope(runtime));
  const before = runtime.sceneDigest;
  const request = envelope(runtime, {
    requestId: "request-export",
    idempotencyKey: "key-export",
    method: "representation.export",
    params: { representation: "engineering", outputPath: output }
  });
  const receipt = await runtime.execute(request);
  assert.equal(receipt.afterDigest, before);
  assert.equal(JSON.parse(await readFile(output, "utf8")).physicalAuthority, false);
  const duplicate = await runtime.execute({ ...request, requestId: "request-export-duplicate" });
  assert.equal(duplicate.outcome, "idempotent-no-op");
  const otherRuntime = new SemanticAdapterRuntime({ initialDigest: before });
  otherRuntime.model = structuredClone(runtime.model);
  const rediscovered = await otherRuntime.execute({
    ...request,
    requestId: "request-export-overwrite",
    idempotencyKey: "key-export-overwrite"
  });
  assert.equal(rediscovered.outcome, "idempotent-no-op");
  const conflictOutput = path.join(TMP, "export-test", "conflict.moonmold.json");
  await writeFile(conflictOutput, "{}\n", "utf8");
  await rejectCode(otherRuntime.execute({
    ...request,
    requestId: "request-export-conflict",
    idempotencyKey: "key-export-conflict",
    params: { ...request.params, outputPath: conflictOutput }
  }), "immutable-output-conflict");
});

test("MCP exposes one semantic tool and rejects non-allowlisted tools", async () => {
  const handle = createMcpHandler();
  const listed = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
    "moonmold_semantic_operation",
    "moonmold_live_building"
  ]);
  for (const tool of listed.result.tools) {
    const schema = tool.inputSchema;
    assert.ok(schema.required.every((name) => schema.properties[name]));
    assert.equal(schema.additionalProperties, false);
  }
  const rejected = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "blender_python", arguments: {} }
  });
  assert.equal(rejected.error.data.moonmoldCode, "unsupported-tool");
});

test("two structurally different buildings reuse one general procedure", async () => {
  const outputA = path.join(TMP, "experiment-a");
  const outputB = path.join(TMP, "experiment-b");
  await rm(outputA, { recursive: true, force: true });
  await rm(outputB, { recursive: true, force: true });
  const a = await runBuildingExperiment({
    inputPath: path.join(REPO, "fixtures/habitat-a.json"),
    outputRoot: outputA
  });
  const b = await runBuildingExperiment({
    inputPath: path.join(REPO, "fixtures/tower-b.json"),
    outputRoot: outputB
  });
  const repeated = await runBuildingExperiment({
    inputPath: path.join(REPO, "fixtures/habitat-a.json"),
    outputRoot: outputA
  });
  assert.equal(a.output.accepted, true);
  assert.equal(repeated.output.accepted, true);
  assert.equal(repeated.output.finalSceneDigest, a.output.finalSceneDigest);
  assert.equal(b.output.accepted, true);
  assert.equal(a.procedureId, b.procedureId);
  assert.notEqual(a.input.digest, b.input.digest);
  assert.notEqual(a.output.finalSceneDigest, b.output.finalSceneDigest);
  assert.equal(a.quality.physicalReadinessClaimed, false);
  assert.equal(b.quality.physicalReadinessClaimed, false);
  const presentation = a.output.representations.find((item) => item.class === "presentation");
  const engineering = a.output.representations.find((item) => item.class === "engineering");
  assert.equal(presentation.parentDigest, engineering.digest);
  assert.ok(presentation.knownLosses.length > 0);
  const manufacturing = a.output.representations.find((item) =>
    item.class === "manufacturing-candidate"
  );
  assert.equal(manufacturing.parentDigest, engineering.digest);
  assert.equal(manufacturing.claimCeiling, "analysis-only-no-machine-authority");
  const presentationArtifact = JSON.parse(await readFile(
    path.join(outputA, "presentation.moonmold.json"),
    "utf8",
  ));
  const manufacturingArtifact = JSON.parse(await readFile(
    path.join(outputA, "manufacturing-candidate.moonmold.json"),
    "utf8",
  ));
  assert.equal(presentationArtifact.parentDigest, engineering.digest);
  assert.equal(presentationArtifact.lineageRelation, "styled-from");
  assert.equal(manufacturingArtifact.parentDigest, engineering.digest);
  assert.equal(manufacturingArtifact.physicalAuthority, false);
  assert.equal(
    manufacturingArtifact.claimCeiling,
    "analysis-only-no-machine-authority",
  );
  const engineeringPortable = JSON.parse(await readFile(
    path.join(outputA, "engineering.portable.json"),
    "utf8",
  ));
  const presentationPortable = JSON.parse(await readFile(
    path.join(outputA, "presentation.portable.json"),
    "utf8",
  ));
  const simulationPortable = JSON.parse(await readFile(
    path.join(outputA, "simulation.portable.json"),
    "utf8",
  ));
  const editablePortable = JSON.parse(await readFile(
    path.join(outputA, "editable-source.portable.json"),
    "utf8",
  ));
  const manufacturingPortable = JSON.parse(await readFile(
    path.join(outputA, "manufacturing-candidate.portable.json"),
    "utf8",
  ));
  assert.equal(
    presentationPortable.manifest.contract_id,
    "moonmold.spatial-artifact.v1",
  );
  assert.equal(
    presentationPortable.transform.contract_id,
    "moonmold.representation-transform.v1",
  );
  assert.equal(
    presentationPortable.transform.parent_digest,
    engineeringPortable.manifest.digest,
  );
  assert.equal(
    presentationPortable.transform.child_digest,
    presentationPortable.manifest.digest,
  );
  assert.equal(presentationPortable.transform.lineage_relation, "styled-from");
  assert.equal(presentationPortable.manifest.claim_ceiling, "digital-artifact");
  assert.equal(simulationPortable.manifest.representation, "simulation-model");
  assert.equal(simulationPortable.manifest.claim_ceiling, "digital-artifact");
  assert.ok(simulationPortable.manifest.assumptions.length > 0);
  assert.equal(
    editablePortable.transform.parent_artifact_id,
    "arched-lunar-habitat:spatial-intent",
  );
  assert.equal(editablePortable.transform.parent_representation, "spatial-intent");
  assert.equal(editablePortable.transform.parent_digest, a.input.digest);
  assert.equal(
    manufacturingPortable.transform.parent_digest,
    engineeringPortable.manifest.digest,
  );
  assert.equal(
    manufacturingPortable.transform.lineage_relation,
    "manufacturing-derived-from",
  );
  assert.equal(manufacturingPortable.manifest.claim_ceiling, "digital-artifact");
  assert.ok(
    manufacturingPortable.manifest.forbidden_consumers.includes(
      "fabrication-execution",
    ),
  );
  const summary = JSON.parse(await readFile(
    path.join(REPO, "evidence/qualification-summary.json"),
    "utf8",
  ));
  for (const report of [a, b]) {
    const expected = summary.experiments.find((item) =>
      item.planId === report.input.planId
    );
    assert.ok(expected);
    assert.equal(expected.inputDigest, report.input.digest);
    assert.equal(expected.finalSceneDigest, report.output.finalSceneDigest);
    assert.equal(expected.operationCount, report.output.operationCount);
    assert.equal(expected.accepted, report.output.accepted);
  }
});

test("weak plans cannot advance to modeling", () => {
  for (const [mutation, code] of [
    [(plan) => { delete plan.scaleEvidence; }, "missing-scale-evidence"],
    [(plan) => { delete plan.unknowns; }, "implicit-unknowns"],
    [(plan) => { plan.components = [plan.components[0]]; }, "weak-spatial-intent"],
    [(plan) => { plan.components[1].id = plan.components[0].id; }, "duplicate-object"],
    [(plan) => { plan.components[0].kind = "arbitrary-script"; }, "unsupported-primitive"]
  ]) {
    const plan = {
      schema: "moonmold-building-plan-v1",
      recordedAt: "2026-07-13T00:00:00Z",
      scaleEvidence: { source: "declared" },
      unknowns: [],
      components: [
        { id: "a", kind: "box", position: {}, materialId: "m" },
        { id: "b", kind: "box", position: {}, materialId: "m" }
      ]
    };
    mutation(plan);
    assert.throws(() => validateBuildingPlan(plan), { code });
  }
});

test("image reference intake separates pixels, scale, estimates and unknowns", async () => {
  const planPath = path.join(REPO, "fixtures/city-hall-image-referenced.json");
  const outputRoot = path.join(TMP, "image-reference-experiment");
  await rm(outputRoot, { recursive: true, force: true });
  const report = await runBuildingExperiment({ inputPath: planPath, outputRoot });
  assert.equal(report.output.accepted, true);
  assert.equal(report.input.verifiedReferences.length, 1);
  const reference = report.input.verifiedReferences[0];
  assert.equal(reference.suppliedScale.derivedFromPixels, false);
  assert.ok(reference.observedCues.length > 0);
  assert.ok(reference.estimates.length > 0);
  assert.ok(reference.occlusions.length > 0);
  assert.ok(reference.unknowns.length > 0);
  const original = JSON.parse(await readFile(planPath, "utf8"));
  for (const mutate of [
    (plan) => { plan.referenceBundle.observedCues = []; },
    (plan) => { plan.referenceBundle.occlusions = []; },
    (plan) => { plan.referenceBundle.unknowns = []; },
    (plan) => { plan.referenceBundle.suppliedScale.derivedFromPixels = true; },
    (plan) => { plan.scaleEvidence.valueMm = 9000; },
  ]) {
    const candidate = structuredClone(original);
    mutate(candidate);
    assert.throws(() => validateBuildingPlan(candidate), AdapterRejection);
  }
});

test("a symlinked output leaf cannot be overwritten", async () => {
  const directory = path.join(TMP, "symlink-test");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const outside = path.join(TMP, "outside-target.json");
  await rm(outside, { force: true });
  await symlink(outside, path.join(directory, "engineering.moonmold.json"));
  const runtime = new SemanticAdapterRuntime();
  await runtime.execute(envelope(runtime));
  await rejectCode(runtime.execute(envelope(runtime, {
    requestId: "request-symlink",
    idempotencyKey: "key-symlink",
    method: "representation.export",
    params: {
      representation: "engineering",
      outputPath: path.join(directory, "engineering.moonmold.json")
    }
  })), "immutable-output-conflict");
});

test("CLI rejection is visible to shell automation", () => {
  const result = spawnSync(process.execPath, [
    path.join(REPO, "bin/moonmold.mjs"),
    "build",
    "--input",
    path.join(REPO, "fixtures/does-not-exist.json"),
    "--output",
    path.join(TMP, "negative-cli")
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).accepted, false);
});

test("a symlinked output directory cannot redirect writes outside the workspace", async () => {
  const directory = path.join(TMP, "symlink-parent-test");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await symlink("/tmp/moonmold-forbidden-target", path.join(directory, "redirect"));
  const runtime = new SemanticAdapterRuntime();
  await runtime.execute(envelope(runtime));
  await rejectCode(runtime.execute(envelope(runtime, {
    requestId: "request-symlink-parent",
    idempotencyKey: "key-symlink-parent",
    method: "representation.export",
    params: {
      representation: "engineering",
      outputPath: path.join(directory, "redirect", "engineering.moonmold.json")
    }
  })), "workspace-boundary");
});
