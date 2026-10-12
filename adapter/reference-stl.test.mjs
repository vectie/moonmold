import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const ascii = await readFile(fixture("reference-tetrahedron-ascii.stl"), "utf8");
const binary = await readFile(fixture("reference-tetrahedron-binary.stl"));
const recipe = JSON.parse(await readFile(fixture("reference-placement.json"), "utf8"));
const request = bytes => ({ input_format: "stl", data_base64: bytes.toString("base64"), units: "cm" });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const coordinates = mesh => mesh.triangles.map(face => face.map(i => mesh.vertices[i]));
const near = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-10));

test("ASCII STL preserves winding, explicit units and exact original bytes while indexing shared coordinates", () => {
  const text = "\uFEFF" + ascii.replaceAll("\n", "\r\n");
  const mesh = importReferenceMesh({ input_format: "stl", text, units: "cm" });
  assert.equal(mesh.source_encoding, "ascii");
  assert.equal(mesh.source_format, "stl");
  assert.equal(mesh.source_sha256, sha(text));
  assert.deepEqual(mesh.bounds.size, [20, 30, 40]);
  assert.equal(mesh.vertex_count, 4); assert.equal(mesh.triangle_count, 4);
  assert.deepEqual(coordinates(mesh)[0], [[0, 0, 0], [0, 30, 0], [20, 0, 0]]);
  assert.deepEqual(mesh.losses, ["facet normals (recomputed from winding)", "solid name"]);
  assert.equal(mesh.physical_authority, false);
  assert.match(mesh.exports.stl, /facet normal 0 0 -1/);
  assert.deepEqual(coordinates(importReferenceMesh({ text: mesh.exports.obj, units: "mm" })), coordinates(mesh));
});

test("binary STL with a solid header is recognized by byte count and retains byte identity", () => {
  assert.match(binary.subarray(0, 80).toString(), /^solid/);
  const mesh = importReferenceMesh(request(binary));
  assert.equal(mesh.source_encoding, "binary"); assert.equal(mesh.source_sha256, sha(binary));
  assert.deepEqual(mesh.bounds.size, [20, 30, 40]);
  assert.deepEqual(coordinates(mesh), coordinates(importReferenceMesh({ text: ascii, input_format: "stl", units: "cm" })));
  assert.deepEqual(mesh.losses, ["binary header", "facet normals (recomputed from winding)"]);
  const attributed = Buffer.from(binary); attributed.writeUInt16LE(0x8001, 132);
  const colored = importReferenceMesh(request(attributed));
  assert.ok(colored.losses.includes("binary facet attributes (including possible colors)"));
  assert.deepEqual(colored.vertices, mesh.vertices);
});

test("ASCII STL imports inches, scientific notation and omitted closing names", () => {
  const text = "solid sample\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1e0 0 0\nvertex 0 +.5 0\nendloop\nendfacet\nendsolid\n";
  assert.deepEqual(importReferenceMesh({ input_format: "stl", text, units: "in" }).bounds.size, [25.4, 12.7, 0]);
});

test("STL editing and both exports remain reusable with original STL provenance", () => {
  for (const bytes of [Buffer.from(ascii), binary]) {
    const original = importReferenceMesh(request(bytes));
    const edited = transformReferenceMesh({ ...request(bytes), transform: recipe });
    near(edited.bounds.size, [40, 80, 60]); near(edited.bounds.min, [80, 10, 0]);
    assert.equal(edited.source_format, "stl"); assert.equal(edited.source_encoding, original.source_encoding);
    assert.equal(edited.source_sha256, sha(bytes)); assert.deepEqual(edited.source_bounds, original.bounds);
    for (const format of ["obj", "stl"]) {
      const roundtrip = importReferenceMesh({ text: edited.exports[format], input_format: format, units: "mm" });
      assert.deepEqual(coordinates(roundtrip), coordinates(edited));
    }
    assert.deepEqual(transformReferenceMesh(request(bytes)).vertices, original.vertices);
  }
});

test("malformed, multi-solid, missing and degenerate ASCII STL produce bounded parse errors", () => {
  for (const text of ["", "solid empty\nendsolid empty", ascii.replace("endfacet", ""), ascii.replace("outer loop", "loop"), ascii.replace("vertex 2 0 0", "vertex 0 0 0"), ascii.replace("vertex 2 0 0", "vertex NaN 0 0"), ascii.replace("vertex 2 0 0", "vertex 1e999 0 0"), ascii.replace("vertex 2 0 0", "vertex 1e9 0 0"), ascii.replace("endsolid synthetic_tetrahedron_cm", "endsolid wrong"), ascii + ascii, ascii + "call script.py\n"]) {
    assert.throws(() => importReferenceMesh({ input_format: "stl", text, units: "cm" }), { code: "invalid-reference-mesh" });
  }
});

test("truncated, trailing, inconsistent and invalid binary facets are rejected", () => {
  const count = Buffer.from(binary); count.writeUInt32LE(0xffffffff, 80);
  const nan = Buffer.from(binary); nan.writeFloatLE(NaN, 96);
  const degenerate = Buffer.from(binary); degenerate.fill(0, 96, 132);
  for (const bytes of [binary.subarray(0, 83), binary.subarray(0, -1), Buffer.concat([binary, Buffer.from([0])]), count, nan, degenerate, Buffer.alloc(84)]) {
    assert.throws(() => importReferenceMesh(request(bytes)), { code: "invalid-reference-mesh" });
  }
});

test("format, base64 and unit selection cannot silently reinterpret input", () => {
  for (const input of [{ ...request(binary), text: ascii }, { ...request(binary), data_base64: "!!!!" }, { ...request(binary), data_base64: "YR==" }, { ...request(binary), input_format: "step" }, { ...request(binary), units: undefined }, { ...request(binary), units: "constructor" }, { text: ascii, units: "cm" }, { ...request(binary), data_base64: Buffer.alloc(400001).toString("base64") }]) {
    assert.throws(() => importReferenceMesh(input), { code: "invalid-reference-mesh" });
  }
});

test("real-file CLI accepts ASCII/binary STL, saved placement, and explicit input format", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "moonmold-stl-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = new URL("../bin/moonmold-reference-mesh.mjs", import.meta.url).pathname;
  for (const name of ["reference-tetrahedron-ascii.stl", "reference-tetrahedron-binary.stl"]) {
    for (const format of ["json", "obj", "stl"]) {
      const target = path.join(dir, `${name}.${format}`);
      const args = [cli, "--input", fixture(name).pathname, "--units", "cm", "--input-format", "stl", "--transform", fixture("reference-placement.json").pathname, "--format", format, "--output", target];
      const result = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const contents = await readFile(target, "utf8");
      const mesh = format === "json" ? JSON.parse(contents) : importReferenceMesh({ input_format: format, text: contents, units: "mm" });
      near(mesh.bounds.size, [40, 80, 60]);
      const again = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(again.status, 1); assert.match(again.stderr, /EEXIST/);
      assert.equal(await readFile(target, "utf8"), contents);
    }
    const automatic = spawnSync(process.execPath, [cli, "--input", fixture(name).pathname, "--units", "cm"], { encoding: "utf8" });
    assert.equal(automatic.status, 0, automatic.stderr); assert.equal(JSON.parse(automatic.stdout).source_format, "stl");
  }
});

test("HTTP imports both STL encodings, applies placement, and accepts the full binary byte limit", async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-stl-http-"));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (operation, payload) => fetch(`${base}/api/reference-mesh/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  for (const bytes of [Buffer.from(ascii), binary]) {
    const imported = await post("import", request(bytes)); assert.equal(imported.status, 200);
    assert.equal((await imported.json()).source_sha256, sha(bytes));
    const edited = await post("transform", { ...request(bytes), transform: recipe }); assert.equal(edited.status, 200);
    near((await edited.json()).bounds.size, [40, 80, 60]);
  }
  const count = 7998, largest = Buffer.alloc(84 + count * 50);
  largest.writeUInt32LE(count, 80);
  for (let i = 0; i < count; i++) binary.copy(largest, 84 + i * 50, 84, 134);
  const full = await post("import", request(largest)); assert.equal(full.status, 200);
  assert.equal((await full.json()).triangle_count, count);
  const invalid = await post("import", request(binary.subarray(0, -1))); assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "invalid-reference-mesh");
  const html = await (await fetch(`${base}/reference-mesh`)).text();
  assert.match(html, /accept=".obj,.stl,.ply"/); assert.match(html, /ASCII and binary STL/);
  const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("UI reads raw STL bytes and retains last valid source and downloads after a failed import", async () => {
  const html = await readFile(new URL("../ui/reference-mesh/index.html", import.meta.url), "utf8");
  const elements = new Map(), blobs = [], payloads = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: "0", checked: false, disabled: false, textContent: "", children: [], handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(a) { this.children.push(a); }, removeAttribute(name) { delete this[name]; }, setPointerCapture() {} });
    return elements.get(id);
  }
  element("preview").getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  element("units").value = "cm";
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: element, querySelector: () => element("import-button"), createElement: () => ({}) },
    Blob, btoa,
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }, revokeObjectURL() {} },
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body); payloads.push(payload);
      try { return { ok: true, json: async () => transformReferenceMesh(payload) }; }
      catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; }
    },
  });
  const event = { preventDefault() {} };
  for (const bytes of [Buffer.from(ascii), binary]) {
    element("file").files = [{ name: "sample.STL", size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer }];
    await element("import-form").handlers.submit(event);
    assert.equal(payloads.at(-1).data_base64, bytes.toString("base64"));
    assert.equal(element("edits").disabled, false);
    assert.equal(JSON.parse(await blobs.at(-3).text()).source_sha256, sha(bytes));
  }
  const successfulDownloads = element("downloads").children;
  element("file").files = [{ name: "broken.stl", size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }];
  await element("import-form").handlers.submit(event);
  assert.equal(element("downloads").children, successfulDownloads);
  assert.match(element("status").textContent, /Previous successful geometry/);
  element("scale").value = "2";
  element("edit-form").handlers.submit(event); await new Promise(resolve => setImmediate(resolve));
  const edited = JSON.parse(await blobs.at(-3).text());
  assert.equal(edited.source_sha256, sha(binary)); assert.deepEqual(edited.bounds.size, [40, 60, 80]);
  element("reset").handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(await blobs.at(-3).text()).bounds.size, [20, 30, 40]);
});
