import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createOperatorServer } from "./operator-server.mjs";

// check_mold_brief_fixture.mbtx verifies these bytes against compiled MoonBit
// form/update output before the no-listener native adapter qualification.
const fixtures = JSON.parse(await readFile(new URL("../fixtures/structured-brief-controls.json", import.meta.url), "utf8"));
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function call(workspace, method, url, body) {
  const server = createOperatorServer({ workspaceRoot: workspace });
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method; request.url = url;
  let status, bytes;
  await server.listeners("request")[0](request, { writeHead(code) { status = code; }, end(value) { bytes = String(value); } });
  assert.equal(server.address(), null, "Fixture never opens a browser or listener");
  return { status, text: bytes, json: () => JSON.parse(bytes) };
}

async function ok(...args) {
  const result = await call(...args);
  assert.equal(result.status, 200, result.text);
  return result.json();
}

for (const { units, first, revised } of fixtures) {
  test(`structured brief freeze build revise recover preserves exact history in ${units}`, { timeout: 180_000 }, async (t) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-brief-controls-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    assert.equal(first.units, units); assert.equal(revised.units, units);
    assert.equal(first.revision, 1); assert.equal(revised.revision, 2);
    assert.deepEqual(first.dimensions_mm, { width: 1200, depth: 800, height: 600 });
    assert.deepEqual(revised.dimensions_mm, { width: 1500, depth: 800, height: 600 });
    let binding = await ok(workspace, "POST", "/api/delivery/brief", { brief: first });
    const firstBinding = structuredClone(binding);
    let parent = "mm1-empty-scene", sequence = 0;
    const execute = async (method, params) => {
      sequence += 1;
      const request = {
        contract_id: "moonmold.spatial-operation-request.v1", request_id: `brief-request-${sequence}`,
        idempotency_key: `brief-operation-${sequence}`, project_id: first.project_id, model_id: first.model_id,
        expected_parent_digest: parent, authority: "WorkspaceMutation", intent: "Structured brief fixture only",
        reference_artifacts: [binding.reference], constraints: ["No physical authority"], backend_preference: "mock-reference",
        operation: { method, params },
      };
      const validation = await ok(workspace, "POST", "/api/run", { mode: "validate", request });
      assert.equal(validation.receipt.validation_evidence.accepted, true);
      const run = await ok(workspace, "POST", "/api/run", { mode: "execute", request });
      assert.equal(run.receipt.physical_authority, false);
      parent = run.receipt.after_digest;
      return run;
    };
    const exportModel = () => execute("representation.export", {
      representation: "presentation", outputPath: `.moonsuite/products/moonmold/projects/${first.project_id}/${first.model_id}/representations/brief-${sequence}.json`,
    });
    const build = (run) => ok(workspace, "POST", "/api/delivery/build", { attempt_id: run.flow_request.attempt_id, brief_ref: binding.reference });
    await execute("scene.create-model", { name: first.model_id, units, coordinateFrame: "z-up-right-handed" });
    await execute("scene.create-box", { objectId: "primary-mass", widthMm: first.dimensions_mm.width, depthMm: first.dimensions_mm.depth, heightMm: first.dimensions_mm.height });
    const originalRun = await exportModel();
    const original = await build(originalRun);
    const packageId = original.manifest.package_id;
    const originalBundle = (await call(workspace, "GET", original.download_url)).text;
    const originalBriefFile = (await call(workspace, "GET", `/api/delivery/${packageId}/file/brief.json`)).text;
    assert.deepEqual(JSON.parse(originalBriefFile).brief, first);
    const briefMember = original.manifest.files.find((file) => file.name === "brief.json");
    assert.equal(sha(originalBriefFile), briefMember.sha256);
    const frozenBytes = await readFile(path.join(workspace, firstBinding.reference));
    await ok(workspace, "POST", "/api/review", {
      attempt_id: originalRun.flow_request.attempt_id, reviewer: "Synthetic fixture reviewer", decision: "approve", notes: "Fixture-only original package review",
      delivery_id: packageId, delivery_digest: original.manifest_digest,
    });
    const reviewed = await ok(workspace, "GET", `/api/delivery/${packageId}`);
    const reviewedBytes = (await call(workspace, "GET", reviewed.download_url)).text;
    assert.equal(reviewed.review_status, "approve");
    binding = await ok(workspace, "POST", "/api/delivery/brief", { brief: revised });
    assert.notEqual(binding.reference, firstBinding.reference);
    await execute("scene.create-box", { objectId: "primary-mass", widthMm: revised.dimensions_mm.width, depthMm: revised.dimensions_mm.depth, heightMm: revised.dimensions_mm.height });
    const changed = await build(await exportModel());
    assert.equal(changed.review_status, "pending");
    assert.deepEqual(changed.reviews, []);
    assert.equal(changed.manifest.brief_revision, 2);
    const bundle = await ok(workspace, "GET", changed.download_url);
    const file = (name) => bundle.file_contents.find((entry) => entry.name === name);
    for (const entry of bundle.file_contents) assert.equal(sha(entry.text), entry.sha256);
    const source = JSON.parse(file("editable-source.json").text);
    assert.deepEqual(source.model.objects[0].dimensions_mm, revised.dimensions_mm);
    const obj = file("presentation.obj").text;
    const firstVertex = obj.split("\n").find((line) => line.startsWith("v ")).split(" ").slice(1).map(Number);
    const divisor = { mm: 1, cm: 10, m: 1000 }[units];
    assert.deepEqual(firstVertex, [-750 / divisor, -400 / divisor, -300 / divisor]);
    assert.match(file("preview.svg").text, /FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY/);
    const change = JSON.parse(file("change-report.json").text);
    assert.equal(change.previous_package_id, packageId);
    assert.equal((await call(workspace, "GET", original.download_url)).text, originalBundle);
    assert.equal((await call(workspace, "GET", reviewed.download_url)).text, reviewedBytes);
    assert.deepEqual(await readFile(path.join(workspace, firstBinding.reference)), frozenBytes);
    const historical = await ok(workspace, "GET", `/api/delivery/${packageId}`);
    assert.equal(historical.stale, true);
    assert.deepEqual(historical.reviews, reviewed.reviews);
    const recovery = await ok(workspace, "GET", "/api/recovery/latest");
    assert.equal(recovery.delivery.manifest_digest, changed.manifest_digest);
    const actualBriefFile = await call(workspace, "GET", `/api/delivery/${changed.manifest.package_id}/file/brief.json`);
    assert.equal(actualBriefFile.status, 200);
    assert.deepEqual(actualBriefFile.json().brief, revised);
    assert.equal(sha(actualBriefFile.text), changed.manifest.files.find((member) => member.name === "brief.json").sha256);
    for (const invalid of [{ ...revised, units: "relative" }, { ...revised, physical_authority: true }, { ...revised, title: "not in schema" }]) {
      assert.equal((await call(workspace, "POST", "/api/delivery/brief", { brief: invalid })).status, 400);
    }
    if (process.env.MOONMOLD_BRIEF_EVIDENCE_DIR) {
      const destination = path.join(process.env.MOONMOLD_BRIEF_EVIDENCE_DIR, units);
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "host-brief-ui-bridge.json"), JSON.stringify({ delivery: recovery.delivery, record: actualBriefFile.json(), expected_brief: revised }));
      await writeFile(path.join(destination, "first-reviewed.json"), reviewedBytes);
      await writeFile(path.join(destination, "revised-bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
      await writeFile(path.join(destination, "historical-package.json"), `${JSON.stringify(historical, null, 2)}\n`);
    }
  });
}
