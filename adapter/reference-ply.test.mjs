import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { sectionReferenceMesh } from "./reference-section.mjs";
import { composeReferenceLayout } from "./reference-layout.mjs";
import { sectionReferenceLayout } from "./reference-layout-section.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const file = new URL("../fixtures/reference-tetrahedron.ply", import.meta.url);
const text = await readFile(file, "utf8");
const source = { input_format: "ply", text, units: "cm", name: "colored-tetrahedron" };
const sha = value => createHash("sha256").update(value).digest("hex");
const coordinates = mesh => mesh.triangles.map(face => face.map(i => mesh.vertices[i]));
const layout = { contract_id: "moonmold.reference-layout.v1", name: "ply-layout", instances: [{ id: "ply-1", source, transform: { translation_mm: [10, 0, 0] } }] };

test("PLY XYZ triangles preserve winding, explicit units, ASCII identity and declared losses", () => {
  const mesh = importReferenceMesh(source);
  assert.equal(mesh.source_format, "ply"); assert.equal(mesh.source_encoding, "ascii");
  assert.equal(mesh.source_sha256, sha(text)); assert.equal(mesh.physical_authority, false);
  assert.deepEqual(mesh.bounds.size, [20, 30, 40]); assert.equal(mesh.triangle_count, 4);
  assert.deepEqual(mesh.triangles[0], [0, 2, 1]);
  assert.deepEqual(mesh.losses, ["PLY comments and object information", "vertex colors", "vertex normals (recomputed from winding for STL)"]);
  assert.equal(importReferenceMesh({ ...source, text: text.replaceAll("\n", "\r\n") }).source_sha256, sha(text.replaceAll("\n", "\r\n")));
  for (const [units, size] of [["mm", 2], ["cm", 20], ["m", 2000], ["in", 50.8]]) assert.equal(importReferenceMesh({ ...source, units }).bounds.size[0], size);
  for (const format of ["obj", "stl"]) assert.deepEqual(coordinates(importReferenceMesh({ input_format: format, text: mesh.exports[format], units: "mm" })), coordinates(mesh));
});

test("PLY property order, scalar aliases, face colors and vertex_index alias are honored", () => {
  const reordered = "ply\nformat ascii 1.0\nelement vertex 3\nproperty double z\nproperty float32 x\nproperty int16 y\nelement face 1\nproperty uint8 red\nproperty list uint8 int32 vertex_index\nend_header\n0 0 0\n0 1e0 0\n0 0 1\n255 3 0 1 2\n";
  const mesh = importReferenceMesh({ ...source, text: reordered, units: "mm" });
  assert.deepEqual(mesh.vertices, [[0,0,0],[1,0,0],[0,1,0]]); assert.deepEqual(mesh.losses, ["face colors"]);
});

test("PLY rejects unsupported encodings/elements/properties, malformed counts, records and geometry", () => {
  const invalid = ["", text.replace("ascii", "binary_little_endian"), text.replace("1.0", "2.0"), text.replace("end_header", "element edge 1\nend_header"), text.replace("property float nx", "property float intensity"), text.replace("vertex 4", "vertex 40001"), text.replace("vertex 4", "vertex 3"), text.replace("face 4", "face 0"), text.replace("property float x", "property float y"), text.replace("property float x", "property float128 x"), text.replace("list uchar int", "list float int"), text.replace("end_header\n", ""), text.replace("3 0 2 1", "4 0 2 1 3"), text.replace("3 0 2 1", "3 0 2 4"), text.replace("3 0 2 1", "3 -1 2 1"), text.replace("3 0 2 1", "3 0 0 1"), text.replace("3 0 2 1", "3 0 2 1.0"), text.replace("2 0 0 0", "NaN 0 0 0"), text.replace("2 0 0 0", "1e999 0 0 0"), text.replace("2 0 0 0", "1e9 0 0 0"), text.replace("2 0 0 0", "0 0 0 0"), text.replace("255 0 0", "256 0 0"), text + "3 0 1 2\n", text + "é", text.slice(0, -10)];
  for (const bad of invalid) assert.throws(() => importReferenceMesh({ ...source, text: bad }), { code: "invalid-reference-mesh" });
  for (const input of [{ ...source, units: undefined }, { ...source, units: "constructor" }, { ...source, data_base64: "AAAA" }, { ...source, text: " ".repeat(400001) }]) assert.throws(() => importReferenceMesh(input), { code: "invalid-reference-mesh" });
});

test("PLY placement, section and portable layout retain exact original payload and reopen", () => {
  const edited = transformReferenceMesh({ ...source, transform: { scale: 2, translation_mm: [10, 0, 0] } });
  assert.deepEqual(edited.bounds.min, [10, 0, 0]); assert.deepEqual(edited.bounds.size, [40, 60, 80]);
  const section = sectionReferenceMesh({ ...source, section: { axis: "z", position_mm: 20 } });
  assert.equal(section.segment_count, 3); assert.equal(section.source_sha256, sha(text));
  const result = composeReferenceLayout(layout);
  assert.equal(result.layout.instances[0].source.text, text); assert.equal(result.parts[0].source_format, "ply");
  assert.deepEqual(composeReferenceLayout(JSON.parse(result.exports.layout)), result);
  for (const format of ["obj", "stl"]) assert.deepEqual(coordinates(importReferenceMesh({ input_format: format, text: result.exports[format], units: "mm" })), coordinates(result));
});

test("documented PLY layout fixture embeds the exact standalone source and sections its placement", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/reference-ply-layout.json", import.meta.url), "utf8"));
  assert.equal(fixture.instances[0].source.text, text);
  const result = sectionReferenceLayout(fixture, { axis: "z", position_mm: 40 });
  assert.equal(result.segment_count, 3);
  assert.equal(result.parts[0].source_sha256, sha(text));
});

test("real PLY CLI detects extension, applies placement, exports section and rejects overwrite", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "moonmold-ply-"));
  const cli = new URL("../bin/moonmold-reference-mesh.mjs", import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, "--input", file.pathname, "--units", "cm", ...args], { encoding: "utf8" });
  const mesh = run([]); assert.equal(mesh.status, 0, mesh.stderr); assert.equal(JSON.parse(mesh.stdout).source_format, "ply");
  for (const format of ["obj", "stl"]) {
    const target = path.join(dir, `edited.${format}`), args = ["--input-format", "ply", "--format", format, "--output", target, "--transform", new URL("../fixtures/reference-placement.json", import.meta.url).pathname];
    const result = run(args); assert.equal(result.status, 0, result.stderr);
    const output = await readFile(target, "utf8"); assert.equal(importReferenceMesh({ input_format: format, text: output, units: "mm" }).triangle_count, 4);
    assert.equal(run(args).status, 1); assert.equal(await readFile(target, "utf8"), output);
  }
  const section = run(["--section-axis", "z", "--section-position-mm", "20", "--format", "svg"]); assert.equal(section.status, 0, section.stderr); assert.match(section.stdout, /<svg/);
});

test("real HTTP PLY import, transform, layout and section routes agree; rejects binary header with text body", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "moonmold-ply-http-"));
  const server = createOperatorServer({ workspaceRoot: dir });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [route, input, compute] of [["reference-mesh/import", source, importReferenceMesh], ["reference-mesh/transform", { ...source, transform: { scale: 2 } }, transformReferenceMesh], ["reference-mesh/section", { ...source, section: { axis: "z", position_mm: 20 } }, sectionReferenceMesh], ["reference-layout/compose", layout, composeReferenceLayout]]) {
    const response = await fetch(`${base}/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), compute(input));
  }
  const bad = await fetch(`${base}/api/reference-mesh/import`, { method: "POST", body: JSON.stringify({ ...source, text: text.replace("ascii", "binary_big_endian") }) }); assert.equal(bad.status, 400);
  for (const page of ["reference-mesh", "reference-layout"]) assert.match(await (await fetch(`${base}/${page}`)).text(), /accept=".obj,.stl,.ply"/);
});

function controller(html, compute) {
  const elements = new Map(), blobs = new Map(), calls = []; let serial = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: "0", checked: false, disabled: false, textContent: "", children: [], handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, removeAttribute(name) { delete this[name]; } });
    return elements.get(id);
  }
  element("preview").getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: element, querySelector: () => element("import-button"), createElement: () => ({}) }, Blob, btoa,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    fetch: async (url, options) => { const input = JSON.parse(options.body); calls.push(input); try { return { ok: true, json: async () => compute(url, input) }; } catch (error) { return { ok: false, json: async () => ({ message: error.message }) }; } },
  });
  return { element, calls, download: async (id, index = 0) => JSON.parse(await blobs.get(element(id).children[index].href).text()) };
}
const event = { preventDefault() {} };
const plyFile = { name: "tetrahedron.PLY", size: text.length, arrayBuffer: async () => new TextEncoder().encode(text).buffer };

test("actual mesh controller imports PLY, edits from retained source, slices, resets and preserves good downloads after rejection", async () => {
  const ui = controller(await readFile(new URL("../ui/reference-mesh/index.html", import.meta.url), "utf8"), (url, input) => url.endsWith("section") ? sectionReferenceMesh(input) : transformReferenceMesh(input));
  const el = ui.element; el("file").files = [plyFile]; el("units").value = "cm";
  await el("import-form").handlers.submit(event); assert.equal((await ui.download("downloads")).source_format, "ply");
  assert.equal(ui.calls[0].data_base64, Buffer.from(text).toString("base64")); el("scale").value = "2"; el("edit-form").handlers.submit(event); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await ui.download("downloads")).bounds.size, [40, 60, 80]);
  el("section-axis").value = "z"; el("section-position").value = "40"; await el("section-form").handlers.submit(event); assert.equal((await ui.download("section-downloads")).segment_count, 3);
  const old = el("downloads").children; el("file").files = [{ ...plyFile, arrayBuffer: async () => new TextEncoder().encode("broken").buffer }]; await el("import-form").handlers.submit(event); assert.equal(el("downloads").children, old); assert.match(el("status").textContent, /unchanged/);
  el("reset").handlers.click(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual((await ui.download("downloads")).bounds.size, [20, 30, 40]); assert.equal(ui.calls.at(-1).data_base64, Buffer.from(text).toString("base64"));
});

test("actual layout controller adds PLY, places, saves embedded payload, reopens and retains downloads after bad input", async () => {
  const ui = controller(await readFile(new URL("../ui/reference-layout/index.html", import.meta.url), "utf8"), (_url, input) => composeReferenceLayout(input));
  const el = ui.element; el("mesh-file").files = [plyFile]; el("source-units").value = "cm";
  await el("add-form").handlers.submit(event); assert.equal((await ui.download("downloads")).instances[0].source.data_base64, Buffer.from(text).toString("base64"));
  el("tx").value = "50"; await el("edit-form").handlers.submit(event); const saved = await ui.download("downloads"); assert.equal(saved.instances[0].transform.translation_mm[0], 50);
  el("layout-file").files = [{ size: JSON.stringify(saved).length, text: async () => JSON.stringify(saved) }]; await el("load-form").handlers.submit(event); assert.deepEqual(await ui.download("downloads"), saved);
  const old = el("downloads").children; el("mesh-file").files = [{ ...plyFile, arrayBuffer: async () => new TextEncoder().encode(text.replace("ascii", "binary_little_endian")).buffer }]; await el("add-form").handlers.submit(event); assert.equal(el("downloads").children, old); assert.match(el("status").textContent, /unchanged/);
});
