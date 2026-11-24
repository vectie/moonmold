import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createOperatorServer } from "./operator-server.mjs";

test("validation receipt recovers without changing the expected scene parent", { timeout: 30_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "moonmold-validation-"));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = {
    contract_id: "moonmold.spatial-operation-request.v1",
    request_id: "validation-contract-request",
    idempotency_key: "validation-contract-key",
    project_id: "validation-contract-project",
    model_id: "validation-contract-model",
    expected_parent_digest: "mm1-empty-scene",
    authority: "WorkspaceMutation",
    intent: "Validate a fixture-reference digital model without mutating it.",
    reference_artifacts: [],
    constraints: ["No physical authority"],
    backend_preference: "mock-reference",
    operation: {
      method: "scene.create-model",
      params: {
        name: "validation-contract-model",
        units: "mm",
        coordinateFrame: "z-up-right-handed",
      },
    },
  };
  const response = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "validate", request }),
  });
  const run = await response.json();
  assert.equal(response.status, 200, JSON.stringify(run));
  assert.equal(run.result.status, "succeeded");
  assert.equal(run.receipt.before_digest, run.receipt.after_digest);
  assert.notEqual(run.receipt.after_digest, request.expected_parent_digest);
  const recoveredResponse = await fetch(`${base}/api/recovery/latest`);
  const recovered = await recoveredResponse.json();
  assert.equal(recoveredResponse.status, 200, JSON.stringify(recovered));
  assert.equal(recovered.run.request.expected_parent_digest, "mm1-empty-scene");
  assert.equal(recovered.run.receipt.after_digest, run.receipt.after_digest);

  const receiptPath = path.join(
    workspace,
    ".moonsuite/products/moonmold/adapter-attempts",
    run.flow_request.attempt_id,
    "operation-receipt.json",
  );
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  await writeFile(
    receiptPath,
    `${JSON.stringify({ ...receipt, before_digest: "sha256:wrong-input" })}\n`,
    "utf8",
  );
  const rejectedResponse = await fetch(`${base}/api/recovery/latest`);
  const rejected = await rejectedResponse.json();
  assert.equal(rejectedResponse.status, 400);
  assert.equal(rejected.code, "recovery-integrity");
  assert.match(rejected.message, /operation receipt binding is invalid/);
});

test("execution rejects a stale scene parent", { timeout: 30_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "moonmold-stale-parent-"));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = {
    contract_id: "moonmold.spatial-operation-request.v1",
    request_id: "stale-parent-request",
    idempotency_key: "stale-parent-key",
    project_id: "stale-parent-project",
    model_id: "stale-parent-model",
    expected_parent_digest: "mm1-wrong-parent",
    authority: "WorkspaceMutation",
    intent: "Reject a stale digital model parent.",
    reference_artifacts: [],
    constraints: ["No physical authority"],
    backend_preference: "mock-reference",
    operation: {
      method: "scene.create-model",
      params: {
        name: "stale-parent-model",
        units: "mm",
        coordinateFrame: "z-up-right-handed",
      },
    },
  };
  const response = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "execute", request }),
  });
  const rejected = await response.json();
  assert.equal(response.status, 400);
  assert.equal(rejected.code, "semantic-execution-rejected");
  assert.match(rejected.message, /StaleParent/);
});
