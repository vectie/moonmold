import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createOperatorServer } from "./operator-server.mjs";
import { canonicalJson } from "./protocol.mjs";
import { readableDeliveryReports } from "./delivery-reader.mjs";
import { verifiedDelivery } from "./delivery.mjs";

const fixture = fileURLToPath(new URL("../fixtures/reader-workspace", import.meta.url));
const root = ".moonsuite/products/moonmold";
const id = "delivery-0fdcfc3d7688f03bbea847145c9480f6a33d886a7aa9b5200a3b7fda715d80a5";
const sha = (v) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
async function hashes(directory, prefix = "", result = {}) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(prefix, item.name);
    if (item.isDirectory()) await hashes(path.join(directory, item.name), name, result);
    else result[name] = sha(await readFile(path.join(directory, item.name)));
  }
  return result;
}
async function serve(t, workspace) {
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, json: () => JSON.parse(text) };
  };
}
async function copy(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "mold-reader-"));
  await cp(fixture, workspace, { recursive: true });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return workspace;
}
async function rewritten(workspace, name, content) {
  const prior = await verifiedDelivery(workspace, id);
  const { package_id, ...base } = prior.manifest;
  const files = prior.files.map((file) => file.name === name ? { ...file, text: content, bytes: Buffer.byteLength(content), sha256: sha(content) } : file);
  base.files = files.map(({ text, ...file }) => file);
  const next = `delivery-${sha(canonicalJson(base)).slice(7)}`;
  const directory = path.join(workspace, root, "deliveries", next);
  await mkdir(directory, { recursive: true });
  for (const file of files) await writeFile(path.join(directory, file.name), file.text);
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ...base, package_id: next }));
  return next;
}

test("real HTTP retained reader verifies exact member downloads and never changes package, scene, reviews or journal", async (t) => {
  const workspace = await copy(t);
  const get = await serve(t, workspace);
  const retained = await verifiedDelivery(workspace, id);
  // Explicit fixture setup, separate from all reader actions under test.
  const review = await get("/api/review", { attempt_id: retained.manifest.attempt_id,
    delivery_id: id, delivery_digest: retained.manifest_digest, reviewer: "Synthetic reader-test reviewer",
    decision: "request-changes", notes: "Automated fixture, not customer or human acceptance" });
  assert.equal(review.status, 200, review.text);
  const before = await hashes(workspace);
  const response = await get(`/api/delivery/${id}`);
  assert.equal(response.status, 200, response.text);
  const projection = response.json();
  assert.equal(projection.stale, true);
  assert.equal(projection.reports.length, 3);
  assert.equal(projection.review_status, "request-changes");
  assert.equal(projection.reviews.length, 1);
  const snapshots = [projection];
  for (const report of projection.reports) {
    assert.equal(report.status, "available", report.name);
    const member = await get(`/api/delivery/${id}/file/${report.name}`);
    assert.equal(member.status, 200);
    assert.equal(sha(member.text), report.sha256);
    const expected = readableDeliveryReports(await verifiedDelivery(workspace, id)).find((x) => x.name === report.name);
    assert.deepEqual(report.rows, expected.rows);
  }
  const bundle = await get(projection.download_url);
  assert.equal(bundle.status, 200);
  assert.deepEqual(await hashes(workspace), before);
  if (process.env.MOONMOLD_READER_EVIDENCE_DIR) {
    await mkdir(process.env.MOONMOLD_READER_EVIDENCE_DIR, { recursive: true });
    await writeFile(path.join(process.env.MOONMOLD_READER_EVIDENCE_DIR, "http-snapshots.json"), JSON.stringify(snapshots));
    await writeFile(path.join(process.env.MOONMOLD_READER_EVIDENCE_DIR, "workspace-before.json"), JSON.stringify(before, null, 2));
    await writeFile(path.join(process.env.MOONMOLD_READER_EVIDENCE_DIR, "workspace-after.json"), JSON.stringify(await hashes(workspace), null, 2));
    await writeFile(path.join(process.env.MOONMOLD_READER_EVIDENCE_DIR, "exact-bundle.json"), bundle.text);
  }
});

test("changed dimension, material, position, removed object and mixed primitive fields stay complete", async () => {
  const delivery = await verifiedDelivery(fixture, id);
  const source = JSON.parse(delivery.files.find((x) => x.name === "editable-source.json").text);
  const before = source.model.objects.find((x) => x.kind === "box");
  const after = { ...before, dimensions_mm: { ...before.dimensions_mm, width: 1234 }, translation_mm: { x: -999, y: 2, z: 3 }, material_id: 'revised-material' };
  const report = { ...JSON.parse(delivery.files.find((x) => x.name === "change-report.json").text), removed: ["cylinder-b"], changed: [{ object_id: before.object_id, before, after }] };
  const files = delivery.files.map((file) => file.name === "change-report.json" ? { ...file, text: JSON.stringify(report) } : file);
  const result = readableDeliveryReports({ ...delivery, files })[0];
  assert.equal(result.status, "available");
  assert.equal(result.rows.find((x) => x.label === "changed.0.after.dimensions_mm.width").value, "1234");
  assert.equal(result.rows.find((x) => x.label === "changed.0.after.material_id").value, after.material_id);
  assert.equal(result.rows.find((x) => x.label === "removed.0").value, "cylinder-b");
});

test("malformed unsupported hostile and overbound retained reports fail interpretation but keep exact HTTP downloads", async (t) => {
  const workspace = await copy(t);
  const get = await serve(t, workspace);
  const delivery = await verifiedDelivery(workspace, id);
  const loss = JSON.parse(delivery.files.find((x) => x.name === "loss-report.json").text);
  for (const content of ["{", JSON.stringify({ ...loss, contract_id: "future.v2" }), JSON.stringify({ ...loss, known_losses: [false] }), JSON.stringify({ ...loss, known_losses: ["x".repeat(16385)] }), JSON.stringify({ ...loss, known_losses: Array(2100).fill("bounded") }), " ".repeat(262145)]) {
    const selected = await rewritten(workspace, "loss-report.json", content);
    const projection = (await get(`/api/delivery/${selected}`)).json();
    assert.equal(projection.reports[1].status, "unavailable");
    assert.deepEqual(projection.reports[1].rows, []);
    assert.equal((await get(`/api/delivery/${selected}/file/loss-report.json`)).text, content);
  }
});

test("missing, altered members and altered manifest reject the entire HTTP response", async (t) => {
  for (const kind of ["missing", "changed", "manifest"]) {
    const workspace = await copy(t);
    const get = await serve(t, workspace);
    const directory = path.join(workspace, root, "deliveries", id);
    if (kind === "missing") await rm(path.join(directory, "validation.json"));
    if (kind === "changed") await writeFile(path.join(directory, "validation.json"), "{}");
    if (kind === "manifest") {
      const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
      manifest.brief_revision++;
      await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    }
    const response = await get(`/api/delivery/${id}`);
    assert.equal(response.status, 400, response.text);
    assert.equal(response.json().reports, undefined);
  }
});

test("closed historical nested schemas reject each wrong-shaped field over real HTTP and preserve exact downloads", async (t) => {
  const workspace = await copy(t);
  const get = await serve(t, workspace);
  const delivery = await verifiedDelivery(workspace, id);
  const member = (name) => JSON.parse(delivery.files.find((x) => x.name === name).text);
  const validation = member("validation.json");
  // Native types.mbt derives these exact uppercase string variants; the pinned
  // serialization probe is retained alongside R44 verification automation.
  validation.adapter_receipt.validation_evidence.findings = ["Info", "Warning", "Error"].map((severity) => ({
    code: "synthetic-finding", severity, message: '<script>hostile()</script> & 中文', criterion: "Recorded fixture criterion",
  }));
  validation.adapter_receipt.changed_objects = ["primary-mass"];
  const source = member("editable-source.json");
  const [cylinder, box] = [source.model.objects.find((x) => x.kind === "cylinder"), source.model.objects.find((x) => x.kind === "box")];
  const changes = { ...member("change-report.json"), previous_package_id: id, previous_source_digest: delivery.manifest.source_digest,
    added: ["new-object"], removed: ["removed-object"], changed: [
      { object_id: box.object_id, before: box, after: { ...box, material_id: null, dimensions_mm: { width: 11, depth: 22, height: 33 } } },
      { object_id: cylinder.object_id, before: cylinder, after: { ...cylinder, sides: 32 } },
    ] };
  const loss = member("loss-report.json");
  loss.known_losses.push('<img src=x onerror="hostile()"> complete retained text');
  const legacy = structuredClone(validation);
  delete legacy.cylinder_count; delete legacy.object_count; delete legacy.bounds_scope;
  const legacyLoss = structuredClone(loss); delete legacyLoss.cylinder_tessellation;
  const supported = [["validation.json", validation], ["validation.json", legacy], ["change-report.json", changes], ["loss-report.json", loss], ["loss-report.json", legacyLoss]];
  const bridgeSnapshots = [];
  for (const [name, value] of supported) {
    const text = JSON.stringify(value);
    const selected = await rewritten(workspace, name, text);
    const projection = (await get(`/api/delivery/${selected}`)).json();
    assert.equal(projection.reports.find((x) => x.name === name).status, "available", name);
    assert.equal((await get(`/api/delivery/${selected}/file/${name}`)).text, text);
    if (name !== "loss-report.json") bridgeSnapshots.push(projection);
  }
  let cases = 0;
  const wrongValues = (value) => {
    if (value === null) return [[], 1];
    if (Array.isArray(value)) return [{ wrong: "not an array" }];
    if (typeof value === "object") return [[]];
    if (typeof value === "string") return [[value], false];
    if (typeof value === "number") return [String(value), null];
    return [String(value), 1];
  };
  const paths = (value, path = []) => [
    ...path.length ? [[path, value]] : [],
    ...value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => paths(child, [...path, key])) : [],
  ];
  for (const [name, valid] of supported) {
    for (const [path, value] of paths(valid)) {
      for (const wrong of wrongValues(value)) {
        const malformed = structuredClone(valid);
        let target = malformed;
        for (const key of path.slice(0, -1)) target = target[key];
        target[path.at(-1)] = wrong;
        const text = JSON.stringify(malformed);
        const selected = await rewritten(workspace, name, text);
        const response = await get(`/api/delivery/${selected}`);
        assert.equal(response.status, 200, response.text);
        assert.equal(response.json().reports.find((x) => x.name === name).status, "unavailable", `${name}:${path.join(".")}`);
        assert.equal((await get(`/api/delivery/${selected}/file/${name}`)).text, text);
        cases++;
      }
    }
  }
  for (const malformed of [
    { ...legacy, object_count: "bad", bounds_scope: false },
    { ...legacy, cylinder_count: 1 }, { ...legacy, bounds_scope: "unsupported partial variant" },
    { ...validation, future_extension: true },
    { ...validation, adapter_result: { ...validation.adapter_result, future_extension: true } },
    { ...validation, adapter_receipt: { ...validation.adapter_receipt, validation_evidence: { ...validation.adapter_receipt.validation_evidence, findings: [{ code: "bad", severity: "PASSED", message: "bad", criterion: "bad" }] } } },
  ]) {
    const text = JSON.stringify(malformed);
    const selected = await rewritten(workspace, "validation.json", text);
    assert.equal((await get(`/api/delivery/${selected}`)).json().reports[2].status, "unavailable");
    assert.equal((await get(`/api/delivery/${selected}/file/validation.json`)).text, text);
    cases++;
  }
  assert.ok(cases > 300);
  if (process.env.MOONMOLD_READER_EVIDENCE_DIR) {
    const filename = path.join(process.env.MOONMOLD_READER_EVIDENCE_DIR, "http-snapshots.json");
    const initial = JSON.parse(await readFile(filename, "utf8"));
    await writeFile(filename, JSON.stringify([...initial, ...bridgeSnapshots]));
  }
  console.log(`MOONMOLD_READER_NESTED_HTTP_MUTATIONS=${cases}; supported variants=${supported.length}`);
});
