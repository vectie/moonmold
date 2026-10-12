import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createOperatorServer } from "./operator-server.mjs";

// The MoonBit primitive_wbtest emits these exact operations. The verification
// .mbtx compares that compiled UI output with this fixture before native tests.
const typedOperations = JSON.parse(await readFile(new URL("../fixtures/typed-object-controls.json", import.meta.url), "utf8"));
const sha = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

async function call(workspace, method, url, body) {
  const server = createOperatorServer({ workspaceRoot: workspace });
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method; request.url = url;
  let status, bytes;
  const response = { writeHead(code) { status = code; }, end(value) { bytes = String(value); } };
  await server.listeners("request")[0](request, response);
  assert.equal(server.address(), null, "Synthetic handler never opens a live listener");
  return { status, text: bytes, json: () => JSON.parse(bytes) };
}

async function ok(...args) {
  const result = await call(...args);
  assert.equal(result.status, 200, result.text);
  return result.json();
}

for (const units of ["mm", "cm", "m"]) {
  test(`typed object fixture reaches native source OBJ SVG and digest parity in ${units}`, { timeout: 180_000 }, async (t) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-typed-controls-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const brief = await ok(workspace, "POST", "/api/delivery/brief", { brief: {
      contract_id: "moonmold.digital-brief.v1", commitment_ref: `typed-fixture-${units}`, revision: 1,
      project_id: "typed-project", model_id: "example-model", intended_use: "Synthetic typed editor digital geometry parity",
      units, coordinate_frame: "z-up-right-handed", dimensions_mm: { width: 1200, depth: 800, height: 600 },
      constraints: ["Fixture only; no physical authority"], deliverables: ["editable-source", "presentation"],
      review_criteria: ["Exact typed dimensions, signed absolute positions, units and file digests"], physical_authority: false,
    } });
    let parent = "mm1-empty-scene", revision = 0;
    const operations = structuredClone(typedOperations);
    operations[0].params.units = units;
    const execute = async (operation) => {
      revision += 1;
      const request = {
        contract_id: "moonmold.spatial-operation-request.v1", request_id: `typed-request-${revision}`,
        idempotency_key: `typed-operation-${revision}`, project_id: "typed-project", model_id: "example-model",
        expected_parent_digest: parent, authority: "WorkspaceMutation", intent: "Typed-control fixture only",
        reference_artifacts: [brief.reference], constraints: ["No physical authority"], backend_preference: "mock-reference", operation,
      };
      const validation = await ok(workspace, "POST", "/api/run", { mode: "validate", request });
      assert.equal(validation.receipt.validation_evidence.accepted, true);
      const run = await ok(workspace, "POST", "/api/run", { mode: "execute", request });
      assert.equal(run.receipt.physical_authority, false);
      parent = run.receipt.after_digest;
      return run;
    };
    for (const operation of operations) await execute(operation);
    const exported = await execute({ method: "representation.export", params: {
      representation: "presentation", outputPath: `.moonsuite/products/moonmold/projects/typed-project/example-model/representations/typed-${units}.json`,
    } });
    const delivery = await ok(workspace, "POST", "/api/delivery/build", { attempt_id: exported.flow_request.attempt_id, brief_ref: brief.reference });
    const bundle = await ok(workspace, "GET", delivery.download_url);
    const file = (name) => bundle.file_contents.find((entry) => entry.name === name);
    for (const entry of bundle.file_contents) assert.equal(sha(entry.text), entry.sha256);
    const source = JSON.parse(file("editable-source.json").text);
    assert.equal(source.contract_id, "moonmold.editable-primitive-source.v1");
    assert.deepEqual(source.operations, operations);
    assert.equal(source.model.units, units);
    assert.deepEqual(source.model.objects[0].translation_mm, { x: 200, y: -100, z: 300 });
    assert.deepEqual(source.model.objects[1].translation_mm, { x: -450, y: 200, z: 800 });
    const scale = { mm: 1, cm: 10, m: 1000 }[units];
    const obj = file("presentation.obj").text;
    const vertices = obj.split("\n").filter((line) => line.startsWith("v ")).map((line) => line.split(" ").slice(1).map(Number));
    assert.equal(vertices.length, 26);
    assert.equal(obj.split("\n").filter((line) => line.startsWith("f ")).length, 17);
    assert.deepEqual(vertices[0], [-400 / scale, -500 / scale, 0]);
    const minima = [0, 1, 2].map((axis) => Math.min(...vertices.map((point) => point[axis])));
    const maxima = [0, 1, 2].map((axis) => Math.max(...vertices.map((point) => point[axis])));
    const expectedMinima = [(-450 + 350 * Math.cos(8 * Math.PI / 9)) / scale, -500 / scale, 0];
    const expectedMaxima = [800 / scale, (200 + 350 * Math.sin(4 * Math.PI / 9)) / scale, 1600 / scale];
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(minima[axis] - expectedMinima[axis]) < 1e-6);
      assert.ok(Math.abs(maxima[axis] - expectedMaxima[axis]) < 1e-6);
    }
    const svg = file("preview.svg").text;
    assert.match(svg, /FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY/);
    assert.doesNotMatch(svg, /NaN|Infinity|<script/);
    assert.equal(delivery.manifest.backend.blender_evidence, false);
    const originalDownload = (await call(workspace, "GET", delivery.download_url)).text;
    const moved = await execute({ method: "scene.set-transform", params: { objectId: "support-cylinder", xMm: -500, yMm: 200, zMm: 800 } });
    assert.notEqual(moved.receipt.after_digest, exported.receipt.after_digest);
    assert.equal((await call(workspace, "GET", delivery.download_url)).text, originalDownload);
    const stale = await call(workspace, "POST", "/api/run", { mode: "execute", request: {
      ...moved.request, request_id: "typed-stale-parent", idempotency_key: "typed-stale-parent", expected_parent_digest: exported.receipt.after_digest,
    } });
    assert.equal(stale.status, 400);
    assert.equal((await call(workspace, "GET", delivery.download_url)).text, originalDownload);
    if (process.env.MOONMOLD_TYPED_EVIDENCE_DIR) {
      const destination = path.join(process.env.MOONMOLD_TYPED_EVIDENCE_DIR, units);
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
      await writeFile(path.join(destination, "typed-operations.json"), `${JSON.stringify(operations, null, 2)}\n`);
      await cp(workspace, path.join(destination, "workspace"), { recursive: true });
    }
  });
}
