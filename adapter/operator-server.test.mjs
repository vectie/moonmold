import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { createOperatorServer } from "./operator-server.mjs";

async function postJson(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

async function getJson(base, pathname) {
  const response = await fetch(`${base}${pathname}`);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

test("operator execution binds aggregate input digest to named review", { timeout: 30_000 }, async (t) => {
  const workspace =
    `/Users/kq/moonsuite/.tmp/moonmold-operator-server-${process.pid}-${Date.now()}`;
  await mkdir(workspace, { recursive: true });
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const request = {
    contract_id: "moonmold.spatial-operation-request.v1",
    request_id: "operator-contract-request",
    idempotency_key: "operator-contract-key",
    project_id: "operator-contract-project",
    model_id: "operator-contract-model",
    expected_parent_digest: "mm1-empty-scene",
    authority: "WorkspaceMutation",
    intent: "Create a reviewable fixture-reference digital model.",
    reference_artifacts: [],
    constraints: ["No physical authority"],
    backend_preference: "mock-reference",
    operation: {
      method: "scene.create-model",
      params: {
        name: "operator-contract-model",
        units: "mm",
        coordinateFrame: "z-up-right-handed",
      },
    },
  };
  const run = await postJson(base, "/api/run", { mode: "execute", request });
  assert.equal(run.result.status, "succeeded");
  assert.equal(run.receipt.contract_id, "moonmold.spatial-operation-receipt.v1");
  assert.equal(run.receipt.physical_authority, false);
  assert.deepEqual(run.reviews, []);
  assert.match(run.flow_request.input_digest, /^sha256:[0-9a-f]{64}$/);

  const review = await postJson(base, "/api/review", {
    attempt_id: run.flow_request.attempt_id,
    reviewer: "Contract Reviewer",
    decision: "approve",
    notes: "Accepted only the exact fixture-reference digital receipt.",
  });
  assert.equal(review.review.receipt_ref, run.result.output_artifacts[0]);
  assert.equal(review.review.receipt_digest, run.result.output_digest);
  assert.equal(review.review.physical_authority, false);

  const recovery = await getJson(base, "/api/recovery/latest");
  assert.equal(recovery.contract_id, "moonmold.operator-recovery.v1");
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.attempt_id, run.flow_request.attempt_id);
  assert.equal(recovery.run.receipt.after_digest, run.receipt.after_digest);
  assert.equal(recovery.run.reviews.length, 1);
  assert.equal(recovery.run.reviews[0].reviewer, "Contract Reviewer");
  assert.equal(recovery.run.reviews[0].receipt_digest, run.result.output_digest);
  assert.equal(recovery.next_request_id, "spatial-request-1");
  assert.equal(recovery.next_idempotency_key, "spatial-operation-1");
  assert.equal(recovery.physical_authority, false);

  await writeFile(
    path.join(workspace, review.reference),
    `${JSON.stringify({
      ...review.review,
      receipt_digest:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    })}\n`,
    "utf8",
  );
  const rejected = await fetch(`${base}/api/recovery/latest`);
  const rejection = await rejected.json();
  assert.equal(rejected.status, 400);
  assert.equal(rejection.code, "recovery-integrity");
});
