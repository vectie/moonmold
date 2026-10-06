import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { adapterCommandArgs, createOperatorServer } from "./operator-server.mjs";

const sha256 = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("operator adapter commands use fixed stripped single-worker builds", () => {
  for (const command of ["invoke", "reconcile-report"]) {
    assert.deepEqual(adapterCommandArgs(command, "/tmp/model workspace", "/tmp/model workspace/request.json"), [
      "run", "--strip", "-j1", "cmd/moonflow_adapter", "--", command,
      "/tmp/model workspace", "/tmp/model workspace/request.json",
    ]);
  }
  assert.throws(() => adapterCommandArgs("unbounded-command", "/tmp/model", "request.json"), {
    code: "invalid-operation",
  });
});

test("a later model change keeps older siblings separate from its new export", { timeout: 120_000 }, async (t) => {
  const workspace = await workspaceFor(t);
  const request = spatialRequest();
  const created = await successfulCall(workspace, "POST", "/api/run", {
    mode: "execute", request,
  });
  const outputRoot = ".moonsuite/products/moonmold/projects/recovery-project/recovery-model/representations";
  const firstRequest = {
    ...request,
    request_id: "spatial-request-2",
    idempotency_key: "spatial-operation-2",
    expected_parent_digest: created.receipt.after_digest,
    operation: { method: "representation.export", params: {
      representation: "editable-source", outputPath: `${outputRoot}/editable-source-2.json`,
    } },
  };
  const first = await successfulCall(workspace, "POST", "/api/run", {
    mode: "execute", request: firstRequest,
  });
  assert.equal(first.representations.length, 1);
  assert.deepEqual(first.receipt.artifacts, [firstRequest.operation.params.outputPath]);
  assert.equal(first.representations[0].parent_digest, first.receipt.after_digest);
  const changed = await successfulCall(workspace, "POST", "/api/run", {
    mode: "execute", request: {
      ...request,
      request_id: "spatial-request-3",
      idempotency_key: "spatial-operation-3",
      expected_parent_digest: first.receipt.after_digest,
      operation: { method: "scene.create-box", params: {
        objectId: "primary-mass", widthMm: 1200, depthMm: 800, heightMm: 600,
      } },
    },
  });
  assert.notEqual(changed.receipt.after_digest, first.receipt.after_digest);
  assert.deepEqual(changed.receipt.artifacts, []);
  assert.equal(changed.representations.length, 1);
  assert.equal(changed.representations[0].parent_digest, first.receipt.after_digest);
  const nextRequest = {
    ...firstRequest,
    request_id: "spatial-request-4",
    idempotency_key: "spatial-operation-4",
    expected_parent_digest: changed.receipt.after_digest,
    operation: { method: "representation.export", params: {
      representation: "editable-source", outputPath: `${outputRoot}/editable-source-4.json`,
    } },
  };
  const next = await successfulCall(workspace, "POST", "/api/run", {
    mode: "execute", request: nextRequest,
  });
  assert.deepEqual(next.receipt.artifacts, [nextRequest.operation.params.outputPath]);
  assert.ok(next.result.output_artifacts.includes(nextRequest.operation.params.outputPath));
  assert.equal(next.representations.length, 2);
  assert.ok(next.representations.some((artifact) =>
    artifact.parent_digest === next.receipt.after_digest &&
    artifact.representation === "editable-source" && artifact.physical_authority === false));
  const recovered = await successfulCall(workspace, "GET", "/api/recovery/latest");
  assert.equal(recovered.attempt_id, next.flow_request.attempt_id);
  assert.deepEqual(recovered.run.receipt, next.receipt);
});

// Exercise the real HTTP handler and deterministic MoonBit adapter without
// opening a socket, discovering Blender, or requiring a machine-specific path.
async function call(workspace, method, url, body) {
  const server = createOperatorServer({ workspaceRoot: workspace });
  assert.equal(server.listening, false);
  assert.equal(server.address(), null);
  const request = Readable.from(body === undefined
    ? []
    : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  let status;
  let payload;
  const response = {
    writeHead(code) { status = code; },
    end(bytes) { payload = JSON.parse(bytes); },
  };
  await server.listeners("request")[0](request, response);
  assert.equal(server.listening, false);
  return { status, body: payload };
}

async function successfulCall(...args) {
  const response = await call(...args);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function workspaceFor(t, source) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-recovery-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  if (source) await cp(source, workspace, { recursive: true });
  return workspace;
}

function spatialRequest() {
  return {
    contract_id: "moonmold.spatial-operation-request.v1",
    request_id: "spatial-request-1",
    idempotency_key: "spatial-operation-1",
    project_id: "recovery-project",
    model_id: "recovery-model",
    expected_parent_digest: "mm1-empty-scene",
    authority: "WorkspaceMutation",
    intent: "Inspect exact fixture-reference recovery evidence.",
    reference_artifacts: [],
    constraints: ["No physical authority"],
    backend_preference: "mock-reference",
    operation: {
      method: "scene.create-model",
      params: {
        name: "recovery-model",
        units: "mm",
        coordinateFrame: "z-up-right-handed",
      },
    },
  };
}

function refs(run) {
  const root = `.moonsuite/products/moonmold/adapter-attempts/${run.flow_request.attempt_id}`;
  return {
    input: run.flow_request.input_artifacts[0],
    flow: run.flow_request_ref,
    attempt: `${root}/attempt.json`,
    spatial: `${root}/input.json`,
    receipt: `${root}/operation-receipt.json`,
    result: `${root}/adapter-result.json`,
  };
}

async function readJson(workspace, reference) {
  return JSON.parse(await readFile(path.join(workspace, reference), "utf8"));
}

async function writeJson(workspace, reference, value) {
  await writeFile(path.join(workspace, reference), `${JSON.stringify(value, null, 2)}\n`);
}

async function mutateJson(workspace, reference, mutate) {
  const value = await readJson(workspace, reference);
  mutate(value);
  await writeJson(workspace, reference, value);
}

async function rebindFlowInput(workspace, references) {
  const bytes = await readFile(path.join(workspace, references.input));
  await mutateJson(workspace, references.flow, (flow) => {
    flow.input_digest = sha256(`${references.input}|${sha256(bytes)}`);
  });
}

async function mutateReceipt(workspace, references, mutate) {
  await mutateJson(workspace, references.receipt, mutate);
  const bytes = await readFile(path.join(workspace, references.receipt));
  // Rebind the result so each test reaches the receipt's semantic binding,
  // rather than being rejected only by the outer result checksum.
  await mutateJson(workspace, references.result, (result) => {
    result.output_digest = sha256(bytes);
  });
}

async function rejectedRecovery(workspace, message) {
  const response = await call(workspace, "GET", "/api/recovery/latest");
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.equal(response.body.code, "recovery-integrity");
  assert.match(response.body.message, message);
}

test("actual validation recovery binds exact input bytes and all receipt subjects", { timeout: 120_000 }, async (t) => {
  const workspace = await workspaceFor(t);
  const request = spatialRequest();
  const run = await successfulCall(workspace, "POST", "/api/run", {
    mode: "validate", request,
  });
  const references = refs(run);
  const inputBytes = await readFile(path.join(workspace, references.input));
  const expectedDigest = sha256(inputBytes);
  assert.equal(run.result.status, "succeeded");
  assert.equal(run.receipt.operation_ref, "moonmold/spatial.operation.validate@0.2.0");
  assert.notEqual(expectedDigest, request.expected_parent_digest);
  assert.equal(run.receipt.before_digest, expectedDigest);
  assert.equal(run.receipt.after_digest, expectedDigest);
  assert.equal(run.receipt.validation_evidence.subject_digest, expectedDigest);
  assert.equal(run.receipt.validation_evidence.accepted, true);
  assert.equal(run.receipt.backend_qualification.evidence_class, "fixture-reference-only");
  assert.equal(run.receipt.backend_qualification.blender_evidence, false);
  assert.equal(run.receipt.backend_qualification.production_qualified, false);
  assert.equal(run.receipt.physical_authority, false);
  await assert.rejects(readFile(path.join(workspace,
    ".moonsuite/products/moonmold/runtime/semantic-journal.json")), { code: "ENOENT" });

  const recovery = await successfulCall(workspace, "GET", "/api/recovery/latest");
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.attempt_id, run.flow_request.attempt_id);
  assert.deepEqual(recovery.run.request, request);
  assert.deepEqual(recovery.run.receipt, run.receipt);
  assert.deepEqual(recovery.run.result, run.result);
  assert.deepEqual(recovery.run.reviews, []);
  assert.equal(recovery.next_request_id, "spatial-request-2");
  assert.equal(recovery.next_idempotency_key, "spatial-operation-2");
  assert.equal(recovery.physical_authority, false);
  assert.deepEqual(await successfulCall(workspace, "GET", "/api/recovery/latest"), recovery);

  await t.test("validation reconciliation returns the same receipt without replay", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const reconciled = await successfulCall(copy, "POST", "/api/reconcile", {
      flow_request: run.flow_request, request,
    });
    assert.equal(reconciled.reconciliation.decision, "recovered-succeeded");
    assert.equal(reconciled.reconciliation.retry_allowed, false);
    assert.deepEqual(reconciled.receipt, run.receipt);
    assert.deepEqual(reconciled.result, run.result);
  });

  await t.test("named review stays bound to the exact validation receipt", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const review = await successfulCall(copy, "POST", "/api/review", {
      attempt_id: run.flow_request.attempt_id,
      reviewer: "Recovery Test Reviewer",
      decision: "request-changes",
      notes: "Fixture validation does not approve execution.",
    });
    assert.equal(review.review.receipt_digest, run.result.output_digest);
    assert.equal(review.review.self_approved, false);
    const recovered = await successfulCall(copy, "GET", "/api/recovery/latest");
    assert.deepEqual(recovered.run.reviews, [review.review]);
    await mutateJson(copy, review.reference, (value) => { value.receipt_digest = "sha256:stale"; });
    await rejectedRecovery(copy, /review record is not bound/);
  });

  await t.test("changed input bytes are rejected even when JSON and aggregate digest agree", async (t) => {
    const copy = await workspaceFor(t, workspace);
    await writeFile(path.join(copy, references.input), ` \n${inputBytes.toString("utf8")}`);
    await rebindFlowInput(copy, references);
    await rejectedRecovery(copy, /operation receipt binding/);
  });

  await t.test("tampered spatial input and recomputed aggregate cannot reuse validation", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const mutate = (value) => { value.operation.params.units = "cm"; };
    await mutateJson(copy, references.input, mutate);
    await mutateJson(copy, references.spatial, mutate);
    await rebindFlowInput(copy, references);
    await rejectedRecovery(copy, /operation receipt binding/);
  });

  for (const field of ["before_digest", "after_digest", "validation_evidence.subject_digest", "operation_ref"]) {
    await t.test(`mismatched validation ${field} is rejected with a valid outer checksum`, async (t) => {
      const copy = await workspaceFor(t, workspace);
      await mutateReceipt(copy, references, (receipt) => {
        if (field === "validation_evidence.subject_digest") {
          receipt.validation_evidence.subject_digest = request.expected_parent_digest;
        } else {
          receipt[field] = field === "operation_ref"
            ? "moonmold/spatial.operation.execute@0.2.0"
            : request.expected_parent_digest;
        }
      });
      await rejectedRecovery(copy, /operation receipt binding/);
    });
  }

  for (const [label, reference, mutate, message] of [
    ["aggregate input digest", references.flow, (value) => { value.input_digest = "sha256:tampered"; }, /MoonFlow input digest/],
    ["attempt reference", references.attempt, (value) => { value.receipt_ref = references.result; }, /attempt references/],
    ["flow identity", references.flow, (value) => { value.request_id = "unrelated-request"; }, /MoonFlow request binding/],
    ["receipt identity", references.receipt, (value) => { value.source_request_id = "unrelated-request"; }, /operation receipt binding/],
    ["result digest", references.result, (value) => { value.output_digest = "sha256:tampered"; }, /adapter result binding/],
    ["result attempt", references.result, (value) => { value.attempt_id = "unrelated-attempt"; }, /adapter result binding/],
  ]) {
    await t.test(`existing ${label} integrity check remains enforced`, async (t) => {
      const copy = await workspaceFor(t, workspace);
      await mutateJson(copy, reference, mutate);
      await rejectedRecovery(copy, message);
    });
  }
});

test("actual execution recovery remains bound to the expected scene parent", { timeout: 120_000 }, async (t) => {
  const workspace = await workspaceFor(t);
  const request = spatialRequest();
  const run = await successfulCall(workspace, "POST", "/api/run", {
    mode: "execute", request,
  });
  const references = refs(run);
  assert.equal(run.result.status, "succeeded");
  assert.equal(run.receipt.operation_ref, "moonmold/spatial.operation.execute@0.2.0");
  assert.equal(run.receipt.before_digest, request.expected_parent_digest);
  assert.notEqual(run.receipt.after_digest, request.expected_parent_digest);
  assert.equal(run.receipt.physical_authority, false);
  const recovered = await successfulCall(workspace, "GET", "/api/recovery/latest");
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.run.receipt, run.receipt);

  await t.test("execution reconciliation returns the same receipt without replay", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const reconciled = await successfulCall(copy, "POST", "/api/reconcile", {
      flow_request: run.flow_request, request,
    });
    assert.equal(reconciled.reconciliation.decision, "recovered-succeeded");
    assert.equal(reconciled.reconciliation.retry_allowed, false);
    assert.deepEqual(reconciled.receipt, run.receipt);
    assert.deepEqual(reconciled.result, run.result);
  });

  await t.test("stale execution receipt scene is rejected", async (t) => {
    const copy = await workspaceFor(t, workspace);
    await mutateReceipt(copy, references, (receipt) => {
      receipt.before_digest = "mm1-stale-scene";
    });
    await rejectedRecovery(copy, /operation receipt binding/);
  });

  await t.test("input digest cannot replace execution scene-parent binding", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const digest = sha256(await readFile(path.join(copy, references.input)));
    await mutateReceipt(copy, references, (receipt) => {
      receipt.before_digest = digest;
      receipt.after_digest = digest;
      receipt.validation_evidence.subject_digest = digest;
    });
    await rejectedRecovery(copy, /operation receipt binding/);
  });

  await t.test("tampered expected scene parent is rejected after aggregate rebinding", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const mutate = (value) => { value.expected_parent_digest = "mm1-stale-scene"; };
    await mutateJson(copy, references.input, mutate);
    await mutateJson(copy, references.spatial, mutate);
    await rebindFlowInput(copy, references);
    await rejectedRecovery(copy, /operation receipt binding/);
  });

  await t.test("a new execution against an old scene fails without replacing recovery", async (t) => {
    const copy = await workspaceFor(t, workspace);
    const staleRequest = {
      ...request,
      request_id: "spatial-request-2",
      idempotency_key: "spatial-operation-2",
    };
    const response = await call(copy, "POST", "/api/run", {
      mode: "execute", request: staleRequest,
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, "semantic-execution-rejected");
    assert.match(response.body.message, /StaleParent/);
    const after = await successfulCall(copy, "GET", "/api/recovery/latest");
    assert.equal(after.attempt_id, run.flow_request.attempt_id);
    assert.deepEqual(after.run.receipt, run.receipt);
  });
});
