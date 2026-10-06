import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createOperatorServer } from "./operator-server.mjs";
import { boxVertices, modelBounds, reconstructBoxes, renderObj, renderSvg } from "./delivery-geometry.mjs";

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const op = (method, params) => ({ method, params });
const create = op("scene.create-model", { name: "delivery-model", units: "cm", coordinateFrame: "z-up-right-handed" });
const box = op("scene.create-box", { objectId: "primary-mass", widthMm: 1200, depthMm: 800, heightMm: 600 });
const transform = op("scene.set-transform", { objectId: "primary-mass", xMm: 200, yMm: -100, zMm: 300 });
const brief = (revision = 1, width = 1200) => ({
  contract_id: "moonmold.digital-brief.v1", commitment_ref: "fixture-client-brief", revision,
  project_id: "delivery-project", model_id: "delivery-model", intended_use: "Fixture-only digital box visualization",
  units: "cm", coordinate_frame: "z-up-right-handed", dimensions_mm: { width, depth: 800, height: 600 },
  constraints: ["Digital-only; tolerance and physical use are not qualified"],
  deliverables: ["editable-source", "presentation"], review_criteria: ["Check exact box dimensions, translations, source and losses"], physical_authority: false,
});

function parseObj(bytes) {
  const vertices = [], faces = [];
  for (const line of bytes.split("\n")) {
    const [kind, ...values] = line.split(" ");
    if (kind === "v") vertices.push(values.map(Number));
    if (kind === "f") faces.push(values.map(Number));
  }
  for (const vertex of vertices) assert.ok(vertex.length === 3 && vertex.every(Number.isFinite));
  for (const face of faces) assert.ok(face.length === 4 && face.every((n) => Number.isInteger(n) && n >= 1 && n <= vertices.length));
  return { vertices, faces };
}

test("box renderer preserves dimensions, translations, units and outward OBJ faces", () => {
  const model = reconstructBoxes([create, box, transform]);
  assert.deepEqual(modelBounds(model), { min: [-400, -500, 0], max: [800, 300, 600], units: "mm", coordinate_frame: "z-up-right-handed" });
  const obj = renderObj(model, "sha256:fixture");
  const parsed = parseObj(obj);
  assert.equal(parsed.vertices.length, 8);
  assert.equal(parsed.faces.length, 6);
  assert.deepEqual(parsed.vertices, boxVertices(model.objects[0]).map((vertex) => vertex.map((n) => n / 10)));
  const center = [20, -10, 30];
  for (const face of parsed.faces) {
    const [a, b, c] = face.map((i) => parsed.vertices[i - 1]);
    const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(normal.reduce((sum, n, i) => sum + n * (a[i] - center[i]), 0) > 0);
  }
  assert.match(obj, /units cm; coordinate_frame z-up-right-handed/);
  assert.match(obj, /fixture-reference-only/);
  const meters = reconstructBoxes([{ ...create, params: { ...create.params, units: "m" } }, box]);
  assert.deepEqual(parseObj(renderObj(meters, "sha256:fixture")).vertices[0], [-0.6, -0.4, -0.3]);
  const svg = renderSvg(model, "sha256:fixture");
  assert.equal((svg.match(/<polygon /g) ?? []).length, 3);
  assert.match(svg, /FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY/);
  assert.doesNotMatch(svg, /NaN|Infinity|<script/);
});

test("unsupported modeling stays explicit instead of inventing geometry", () => {
  for (const method of ["scene.create-cylinder", "scene.boolean-subtract", "printer.start"]) {
    assert.throws(() => reconstructBoxes([create, box, op(method, {})]), { code: "unsupported-delivery-operation" });
  }
  assert.throws(() => reconstructBoxes([{ ...create, params: { ...create.params, coordinateFrame: "y-up-right-handed" } }, box]), { code: "unsupported-delivery-frame" });
  assert.throws(() => reconstructBoxes([create]), { code: "missing-editable-source" });
  assert.throws(() => reconstructBoxes([create, transform]), { code: "unknown-delivery-object" });
});

async function call(workspace, method, url, body) {
  const server = createOperatorServer({ workspaceRoot: workspace });
  assert.equal(server.listening, false);
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method; request.url = url;
  let status, headers, bytes;
  const response = { writeHead(code, value) { status = code; headers = value; }, end(value) { bytes = String(value); } };
  await server.listeners("request")[0](request, response);
  assert.equal(server.address(), null);
  return { status, headers, text: bytes, json: () => JSON.parse(bytes) };
}

async function ok(...args) {
  const response = await call(...args);
  assert.equal(response.status, 200, response.text);
  return response.json();
}

async function rejected(workspace, method, url, body, code) {
  const response = await call(workspace, method, url, body);
  assert.equal(response.status, 400, response.text);
  assert.equal(response.json().code, code, response.text);
}

async function workspaceFor(t, source) {
  const root = await mkdtemp(path.join(os.tmpdir(), "moonmold-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (source) await cp(source, root, { recursive: true });
  return root;
}

test("actual native adapter produces two reusable, exact-reviewed digital package revisions", { timeout: 180_000 }, async (t) => {
  const workspace = await workspaceFor(t);
  let revision = 0, parent = "mm1-empty-scene";
  const frozen = await ok(workspace, "POST", "/api/delivery/brief", { brief: brief() });
  assert.deepEqual(await ok(workspace, "POST", "/api/delivery/brief", { brief: brief() }), frozen);
  await rejected(workspace, "POST", "/api/delivery/brief", { brief: brief(1, 1000) }, "immutable-output-conflict");
  let activeBrief = frozen.reference;
  const execute = async (operation) => {
    revision++;
    const request = {
      contract_id: "moonmold.spatial-operation-request.v1", request_id: `spatial-request-${revision}`,
      idempotency_key: `spatial-operation-${revision}`, project_id: "delivery-project", model_id: "delivery-model",
      expected_parent_digest: parent, authority: "WorkspaceMutation", intent: "Fixture-only box delivery",
      reference_artifacts: [activeBrief], constraints: ["No physical authority"], backend_preference: "mock-reference", operation,
    };
    const validation = await ok(workspace, "POST", "/api/run", { mode: "validate", request });
    assert.equal(validation.receipt.validation_evidence.accepted, true);
    const run = await ok(workspace, "POST", "/api/run", { mode: "execute", request });
    parent = run.receipt.after_digest;
    return run;
  };
  await execute(create);
  const shape = await execute(box);
  await rejected(workspace, "POST", "/api/delivery/build", { attempt_id: shape.flow_request.attempt_id, brief_ref: activeBrief }, "delivery-export-required");
  await execute(transform);
  const noOp = await ok(workspace, "POST", "/api/run", {
    mode: "execute", request: {
      ...shape.request, request_id: "spatial-request-replayed-box",
      expected_parent_digest: shape.receipt.after_digest,
    },
  });
  assert.equal(noOp.receipt.outcome, "idempotent-no-op");
  const exportRun = await execute(op("representation.export", { representation: "presentation", outputPath: ".moonsuite/products/moonmold/projects/delivery-project/delivery-model/representations/presentation-1.json" }));
  const first = await ok(workspace, "POST", "/api/delivery/build", { attempt_id: exportRun.flow_request.attempt_id, brief_ref: activeBrief });
  assert.equal(first.review_status, "pending");
  assert.equal(first.stale, false);
  assert.equal(first.manifest.backend.blender_evidence, false);
  assert.equal(first.manifest.files.length, 8);
  const download = await call(workspace, "GET", first.download_url);
  assert.match(download.headers["Content-Disposition"], /attachment/);
  const bundle = download.json();
  assert.equal(bundle.contract_id, "moonmold.digital-delivery-bundle.v1");
  for (const file of bundle.file_contents) {
    assert.equal(sha(file.text), file.sha256);
    const individual = await call(workspace, "GET", first.files.find((item) => item.name === file.name).url);
    assert.equal(individual.status, 200, individual.text);
    assert.equal(individual.text, file.text);
  }
  const source = JSON.parse(bundle.file_contents.find((file) => file.name === "editable-source.json").text);
  assert.deepEqual(source.model.objects[0].translation_mm, { x: 200, y: -100, z: 300 });
  assert.equal(source.operations.length, 3);
  assert.equal(source.provenance.filter((item) => item.outcome === "idempotent-no-op").length, 1);
  assert.deepEqual(parseObj(bundle.file_contents.find((file) => file.name === "presentation.obj").text).vertices[0], [-40, -50, 0]);
  const loss = JSON.parse(bundle.file_contents.find((file) => file.name === "loss-report.json").text);
  assert.ok(loss.known_losses.some((value) => value.includes("No Blender")));
  assert.equal(loss.source_digest, first.manifest.source_digest);
  assert.equal(first.manifest.receipt_digest, exportRun.result.output_digest);

  const reviewBody = {
    attempt_id: exportRun.flow_request.attempt_id, reviewer: "Fixture Test Reviewer", decision: "approve",
    notes: "Automated test fixture only; not an actual person's acceptance", delivery_id: first.manifest.package_id, delivery_digest: first.manifest_digest,
  };
  await rejected(workspace, "POST", "/api/review", { ...reviewBody, delivery_digest: "sha256:stale" }, "stale-delivery-review");
  const reviewed = await ok(workspace, "POST", "/api/review", reviewBody);
  assert.equal(reviewed.review.delivery_digest, first.manifest_digest);
  assert.equal(reviewed.review.receipt_digest, first.manifest.receipt_digest);
  assert.equal((await ok(workspace, "GET", `/api/delivery/${first.manifest.package_id}`)).review_status, "approve");
  const recoveredFirst = await ok(workspace, "GET", "/api/recovery/latest");
  assert.equal(recoveredFirst.delivery.manifest_digest, first.manifest_digest);
  assert.equal(recoveredFirst.delivery.review_status, "approve");
  assert.match(recoveredFirst.delivery.download_url, /\/reviewed\/[a-f0-9]{64}$/);
  const reviewedDownload = await call(workspace, "GET", recoveredFirst.delivery.download_url);
  assert.deepEqual(reviewedDownload.json().reviews, [reviewed.review]);
  assert.equal((await call(workspace, "GET", first.download_url)).text, download.text);
  assert.deepEqual(await ok(workspace, "POST", "/api/delivery/build", { attempt_id: exportRun.flow_request.attempt_id, brief_ref: activeBrief }), recoveredFirst.delivery);
  await ok(workspace, "POST", "/api/run", {
    mode: "execute", request: {
      ...shape.request, request_id: "spatial-request-replayed-after-package",
      expected_parent_digest: shape.receipt.after_digest,
    },
  });
  assert.equal((await ok(workspace, "GET", `/api/delivery/${first.manifest.package_id}`)).stale, false);
  await execute(op("scene.set-transform", { ...transform.params, xMm: 300 }));
  const replayedExport = await ok(workspace, "POST", "/api/run", {
    mode: "execute", request: {
      ...exportRun.request, request_id: "spatial-request-replayed-export",
      expected_parent_digest: exportRun.receipt.after_digest,
    },
  });
  assert.equal(replayedExport.receipt.outcome, "idempotent-no-op");
  await rejected(workspace, "POST", "/api/delivery/build", {
    attempt_id: replayedExport.flow_request.attempt_id, brief_ref: activeBrief,
  }, "delivery-export-required");

  for (const filename of ["editable-source.json", "loss-report.json"]) {
    await t.test(`missing ${filename} blocks incomplete package download and review`, async (t) => {
      const copy = await workspaceFor(t, workspace);
      await rm(path.join(copy, ".moonsuite/products/moonmold/deliveries", first.manifest.package_id, filename));
      await rejected(copy, "GET", first.download_url, undefined, "incomplete-delivery");
      await rejected(copy, "POST", "/api/review", reviewBody, "incomplete-delivery");
    });
  }
  await t.test("changed derived bytes are not served under the old digest", async (t) => {
    const copy = await workspaceFor(t, workspace);
    await writeFile(path.join(copy, ".moonsuite/products/moonmold/deliveries", first.manifest.package_id, "presentation.obj"), "v 0 0 0\n");
    await rejected(copy, "GET", first.download_url, undefined, "delivery-integrity");
  });

  const frozen2 = await ok(workspace, "POST", "/api/delivery/brief", { brief: brief(2, 1500) });
  activeBrief = frozen2.reference;
  await execute(op("scene.create-box", { ...box.params, widthMm: 1500 }));
  const oldProjection = await ok(workspace, "GET", `/api/delivery/${first.manifest.package_id}`);
  assert.equal(oldProjection.stale, true);
  assert.equal(oldProjection.review_status, "approve");
  assert.equal((await ok(workspace, "GET", "/api/recovery/latest")).delivery.stale, true);
  const secondExport = await execute(op("representation.export", { representation: "presentation", outputPath: ".moonsuite/products/moonmold/projects/delivery-project/delivery-model/representations/presentation-2.json" }));
  const second = await ok(workspace, "POST", "/api/delivery/build", { attempt_id: secondExport.flow_request.attempt_id, brief_ref: activeBrief });
  assert.notEqual(second.manifest_digest, first.manifest_digest);
  assert.equal(second.review_status, "pending");
  assert.equal(second.reviews.length, 0);
  const secondBundle = await ok(workspace, "GET", second.download_url);
  const changes = JSON.parse(secondBundle.file_contents.find((file) => file.name === "change-report.json").text);
  assert.equal(changes.previous_package_id, first.manifest.package_id);
  assert.equal(changes.changed[0].before.dimensions_mm.width, 1200);
  assert.equal(changes.changed[0].after.dimensions_mm.width, 1500);
  assert.deepEqual(changes.changed[0].after.translation_mm, { x: 0, y: 0, z: 0 });
  assert.deepEqual((await ok(workspace, "GET", first.download_url)).file_contents, bundle.file_contents);
  assert.equal((await call(workspace, "GET", first.download_url)).text, download.text);
  assert.equal((await call(workspace, "GET", recoveredFirst.delivery.download_url)).text, reviewedDownload.text);
  await rejected(workspace, "POST", "/api/review", { ...reviewBody, attempt_id: secondExport.flow_request.attempt_id, delivery_id: second.manifest.package_id }, "stale-delivery-review");
  await ok(workspace, "POST", "/api/review", { ...reviewBody, attempt_id: secondExport.flow_request.attempt_id, delivery_id: second.manifest.package_id, delivery_digest: second.manifest_digest, decision: "request-changes" });
  assert.equal((await ok(workspace, "GET", `/api/delivery/${second.manifest.package_id}`)).review_status, "request-changes");
  assert.equal((await ok(workspace, "GET", `/api/delivery/${first.manifest.package_id}`)).review_status, "approve");

  const frozenLate = await ok(workspace, "POST", "/api/delivery/brief", { brief: brief(3, 1500) });
  await rejected(workspace, "POST", "/api/delivery/build", { attempt_id: secondExport.flow_request.attempt_id, brief_ref: frozenLate.reference }, "brief-not-frozen-before-work");
  await rejected(workspace, "POST", "/api/run", { mode: "execute", request: { ...secondExport.request, request_id: "physical-attempt", operation: op("printer.start", {}) } }, "unsupported-method");
  assert.equal((await call(workspace, "GET", first.download_url)).status, 200);
  if (process.env.MOONMOLD_DELIVERY_EVIDENCE_DIR) {
    await mkdir(process.env.MOONMOLD_DELIVERY_EVIDENCE_DIR, { recursive: true });
    await cp(workspace, path.join(process.env.MOONMOLD_DELIVERY_EVIDENCE_DIR, "workspace"), { recursive: true });
    await writeFile(path.join(process.env.MOONMOLD_DELIVERY_EVIDENCE_DIR, "first-bundle.json"), reviewedDownload.text);
    const latestSecond = await ok(workspace, "GET", `/api/delivery/${second.manifest.package_id}`);
    const latestDownload = await call(workspace, "GET", latestSecond.download_url);
    await writeFile(path.join(process.env.MOONMOLD_DELIVERY_EVIDENCE_DIR, "second-bundle.json"), latestDownload.text);
    await writeFile(path.join(process.env.MOONMOLD_DELIVERY_EVIDENCE_DIR, "preview.svg"), bundle.file_contents.find((file) => file.name === "preview.svg").text);
  }
});
