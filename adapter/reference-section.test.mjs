import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sectionReferenceMesh } from "./reference-section.mjs";
import { sectionSvg, sectionCsv } from "./reference-section-export.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { canonicalJson } from "./protocol.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const cube = { text: await readFile(fixture("reference-section-cube.obj"), "utf8"), units: "mm", name: "cube" };
const tetra = { text: await readFile(fixture("reference-tetrahedron.obj"), "utf8"), units: "cm" };
const slice = (input, axis = "z", position_mm = 10) => sectionReferenceMesh({ ...input, section: { axis, position_mm } });
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual-expected) < tolerance, `${actual} != ${expected}`);

test("cube midpoint along every axis has 8 finite segments, 20×20 mm bounds and 80 mm length sum", () => {
  for (const axis of ["x", "y", "z"]) {
    const result = slice(cube, axis);
    assert.equal(result.segment_count, 8);
    assert.equal(result.point_contact_count, 0);
    assert.deepEqual(result.bounds_uv_mm, { min: [0, 0], max: [20, 20], size: [20, 20] });
    near(result.segment_length_sum_mm, 80);
    assert.deepEqual(result.plane.projected_axes, ["x", "y", "z"].filter(n => n !== axis));
    for (const line of result.segments) {
      assert.equal(line.start_mm[["x", "y", "z"].indexOf(axis)], 10);
      assert.equal(line.end_mm[["x", "y", "z"].indexOf(axis)], 10);
      assert.equal(line.triangle_ids.length, 1);
      assert.ok(line.length_mm > 0);
    }
    assert.equal(result.physical_authority, false);
    assert.match(result.qualification, /No closed contour/);
    assert.equal(result.diagnostics.coplanar_triangles, 0);
  }
});

test("tetrahedron gives the known triangle, outside planes are empty, and apex is a point contact", () => {
  const middle = slice(tetra, "z", 20);
  assert.equal(middle.segment_count, 3);
  assert.deepEqual(middle.bounds_uv_mm, { min: [0, 0], max: [10, 15], size: [10, 15] });
  near(middle.segment_length_sum_mm, 25+Math.hypot(10, 15));
  for (const position of [-1, 41]) {
    const result = slice(tetra, "z", position);
    assert.equal(result.status, "empty");
    assert.equal(result.segment_count, 0);
    assert.equal(result.bounds_uv_mm, null);
    assert.match(result.exports.svg, /No triangle intersection/);
    assert.equal(result.exports.csv.trim().split("\r\n").length, 2);
  }
  const apex = slice(tetra, "z", 40);
  assert.equal(apex.status, "point-contact");
  assert.equal(apex.segment_count, 0);
  assert.equal(apex.point_contact_count, 1);
  assert.deepEqual(apex.point_contacts[0].point_mm, [0, 0, 40]);
  assert.equal(apex.point_contacts[0].triangle_ids.length, 3);
  assert.match(apex.exports.svg, /<circle/);
});

test("coplanar facets are counted and omitted, while neighboring on-plane edges remain", () => {
  const bottom = slice(cube, "z", 0);
  assert.equal(bottom.diagnostics.coplanar_triangles, 2);
  assert.equal(bottom.segment_count, 4);
  near(bottom.segment_length_sum_mm, 80);
  const planar = { text: "v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3", units: "mm" };
  const result = slice(planar, "z", 0);
  assert.equal(result.status, "coplanar-only");
  assert.equal(result.segment_count, 0);
  assert.equal(result.diagnostics.coplanar_triangles, 1);
  assert.match(result.exports.svg, /Coplanar triangles omitted/);
});

test("vertex crossings and edge tangencies preserve segments without forcing closure", () => {
  const crossing = slice({ text: "v 0 0 0\nv 2 0 -2\nv 0 2 2\nf 1 2 3", units: "mm" }, "z", 0);
  assert.equal(crossing.segment_count, 1);
  assert.deepEqual(crossing.segments[0].start_mm, [0, 0, 0]);
  assert.deepEqual(crossing.segments[0].end_mm, [1, 1, 0]);
  const tangent = slice({ text: "v 0 0 0\nv 3 0 0\nv 0 2 1\nf 1 2 3\nf 2 1 3", units: "mm" }, "z", 0);
  assert.equal(tangent.segment_count, 1);
  assert.deepEqual(tangent.segments[0].triangle_ids, [0, 1]);
  assert.equal(tangent.diagnostics.merged_duplicate_segments, 1);
  assert.equal(tangent.diagnostics.on_plane_edge_triangles, 2);
  assert.equal(tangent.segment_length_sum_mm, 3);
});

test("tolerance is finite, disclosed, axis-relative and distinguishes near-plane observations", () => {
  const almost = slice(cube, "z", -1e-10);
  assert.equal(almost.diagnostics.coplanar_triangles, 2);
  assert.equal(almost.tolerance_mm, 2e-9);
  assert.ok(almost.segments.every(line => line.start_mm[2] === -1e-10));
  assert.equal(slice(cube, "z", -1e-5).status, "empty");
  const far = slice({ ...cube, transform: { translation_mm: [0, 0, 900000000] } }, "z", 900000010);
  assert.ok(Number.isFinite(far.tolerance_mm));
  near(far.segment_length_sum_mm, 80);
  assert.doesNotMatch(far.exports.svg, /NaN|Infinity/);
});

test("section uses final scale, rotation, grounding and translation with stable exact identities", () => {
  const transform = { scale: 2, rotation_deg: [90, 0, 0], center_and_ground: true, translation_mm: [100, 50, 0] };
  const result = slice({ ...tetra, transform }, "z", 30);
  assert.equal(result.segment_count, 3);
  near(result.bounds_uv_mm.min[0], 80); near(result.bounds_uv_mm.max[0], 100);
  near(result.bounds_uv_mm.min[1], 50); near(result.bounds_uv_mm.max[1], 90);
  assert.deepEqual(result.transform, transform);
  assert.equal(result.source_units, "cm"); assert.equal(result.units, "mm");
  assert.equal(result.source_sha256, createHash("sha256").update(tetra.text).digest("hex"));
  const mesh = transformReferenceMesh({ ...tetra, transform });
  assert.equal(result.transformed_mesh_sha256, createHash("sha256").update(canonicalJson({ units: "mm", vertices: mesh.vertices, triangles: mesh.triangles })).digest("hex"));
  const { exports, section_sha256, ...data } = result;
  assert.equal(section_sha256, createHash("sha256").update(canonicalJson(data)).digest("hex"));
  assert.deepEqual(result, slice({ ...tetra, transform }, "z", 30));
  assert.notEqual(result.section_sha256, slice({ ...tetra, transform }, "z", 31).section_sha256);
  assert.equal(result.transform_sha256, slice({ ...tetra, transform }, "z", 31).transform_sha256);
  assert.notEqual(result.transformed_mesh_sha256, slice(tetra, "z", 30).transformed_mesh_sha256);
  assert.ok(exports.svg.includes(section_sha256));
});

test("binary and ASCII STL use the same section path while retaining byte-source identity", async () => {
  for (const file of ["reference-tetrahedron-ascii.stl", "reference-tetrahedron-binary.stl"]) {
    const bytes = await readFile(fixture(file));
    const result = slice({ input_format: "stl", data_base64: bytes.toString("base64"), units: "cm" }, "z", 20);
    assert.equal(result.segment_count, 3);
    assert.deepEqual(result.bounds_uv_mm.size, [10, 15]);
    assert.equal(result.source_sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.source_format, "stl");
    assert.ok(result.source_encoding);
  }
});

test("SVG escapes text and metadata; CSV preserves exact numeric values and quoted recipe", () => {
  const result = slice(cube);
  const escaped = sectionSvg({ ...result, name: 'mesh<&"\'><script>alert(1)</script>' });
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(escaped, /&amp;/);
  assert.match(escaped, /&quot;/);
  const csv = sectionCsv(result);
  assert.equal(csv.trim().split("\r\n").length, result.segment_count+2);
  const rows = csv.trim().split("\r\n").slice(1).map(line => line.match(/"(?:[^"]|"")*"/g).map(cell => cell.slice(1, -1).replaceAll('""', '"')));
  assert.ok(rows.every(row => row.length === 22));
  assert.deepEqual(rows[1].slice(13, 19).map(Number), [...result.segments[0].start_mm, ...result.segments[0].end_mm]);
  assert.deepEqual(JSON.parse(rows[1][21]), result.transform);
  assert.ok(csv.includes(`"${result.source_sha256}"`));
  assert.ok(csv.includes('"metadata"'));
  assert.ok(csv.includes('""translation_mm""'));
  assert.doesNotMatch(csv, /NaN|Infinity/);
  assert.throws(() => slice({ ...cube, name: '<script>' }), { code: "invalid-reference-mesh" });
});

test("invalid section choices fail explicitly", () => {
  for (const section of [null, [], {}, { axis: "Z", position_mm: 0 }, { axis: "x", position_mm: "1" }, { axis: "x", position_mm: NaN }, { axis: "x", position_mm: Infinity }, { axis: "x", position_mm: 1e10 }, { axis: "z", position_mm: 0, fill: true }]) {
    assert.throws(() => sectionReferenceMesh({ ...cube, section }), { code: "invalid-reference-section" });
  }
});

test("CLI writes real section siblings, accepts recipes, rejects malformed flags and refuses overwrite", async () => {
  const root = process.env.MOONMOLD_SECTION_TEST_ROOT ?? os.tmpdir();
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(path.join(root, "moonmold-section-")); // Retain output evidence.
  const base = [new URL("../bin/moonmold-reference-mesh.mjs", import.meta.url).pathname, "--input", fixture("reference-section-cube.obj").pathname, "--units", "mm"];
  for (const format of ["json", "svg", "csv"]) {
    const file = path.join(temp, `section.${format}`);
    const args = [...base, "--section-axis", "z", "--section-position-mm", "10", "--format", format, "--output", file];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const bytes = await readFile(file, "utf8");
    const expected = slice({ ...cube, name: "reference" });
    assert.equal(bytes, format === "json" ? JSON.stringify(expected, null, 2)+"\n" : expected.exports[format]);
    if (format === "json") assert.equal(JSON.parse(bytes).segment_count, 8);
    if (format === "svg") assert.match(bytes, /<svg/);
    if (format === "csv") assert.match(bytes, /^record_type,/);
    assert.equal(spawnSync(process.execPath, args).status, 1);
    assert.equal(await readFile(file, "utf8"), bytes);
  }
  for (const extra of [["--section-axis", "z"], ["--section-position-mm", "10"], ["--section-axis", "z", "--section-position-mm", "0x10"], ["--section-axis", "z", "--section-position-mm", "10", "--format", "obj"]]) assert.equal(spawnSync(process.execPath, [...base, ...extra]).status, 1);
  const placed = spawnSync(process.execPath, [base[0], "--input", fixture("reference-tetrahedron.obj").pathname, "--units", "cm", "--transform", fixture("reference-placement.json").pathname, "--section-axis", "z", "--section-position-mm", "30"], { encoding: "utf8" });
  assert.equal(placed.status, 0, placed.stderr);
  assert.equal(JSON.parse(placed.stdout).segment_count, 3);
});

test("real HTTP section route and served JavaScript syntax work without a native adapter", async t => {
  const root = process.env.MOONMOLD_SECTION_TEST_ROOT ?? os.tmpdir();
  await mkdir(root, { recursive: true });
  const workspace = await mkdtemp(path.join(root, "moonmold-section-http-"));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = section => fetch(base+"/api/reference-mesh/section", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...cube, section }) });
  const response = await request({ axis: "z", position_mm: 10 });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), slice(cube));
  assert.equal((await request({ axis: "z", position_mm: null })).status, 400);
  const html = await (await fetch(base+"/reference-mesh")).text();
  for (const marker of ["section-form", "Calculate section", "Use mesh midpoint", "/api/reference-mesh/section"]) assert.ok(html.includes(marker));
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const check = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: script, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("served UI sections the applied mesh, preserves failed attempts, and invalidates changed geometry", async () => {
  const html = await readFile(new URL("../ui/reference-mesh/index.html", import.meta.url), "utf8");
  const elements = new Map(), blobs = new Map(), revoked = [], requests = [];
  let fail = false, hold = null, serial = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: "0", checked: false, disabled: false, hidden: true, children: [], handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, removeAttribute(name) { delete this[name]; }, setPointerCapture() {} });
    return elements.get(id);
  }
  element("preview").getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} });
  element("file").files = [{ name: "cube.obj", size: cube.text.length, text: async () => cube.text }];
  element("units").value = "mm"; element("section-axis").value = "z";
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: element, querySelector: () => element("import-button"), createElement: () => ({}) }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => {
      const input = JSON.parse(options.body); requests.push({ url, input });
      if (hold) await new Promise(resolve => { hold = resolve; });
      if (fail) return { ok: false, json: async () => ({ message: "synthetic failed request" }) };
      const result = url.endsWith("/section") ? sectionReferenceMesh(input) : transformReferenceMesh(input);
      return { ok: true, json: async () => result };
    },
  });
  const event = { preventDefault() {} }, settle = () => new Promise(resolve => setImmediate(resolve));
  await element("import-form").handlers.submit(event);
  assert.equal(element("section-controls").disabled, false);
  element("section-middle").handlers.click();
  assert.equal(element("section-position").value, 10);
  element("section-position").value = "10"; // Browser number-input values are strings.
  element("scale").value = "3"; // Unapplied edit must not affect this slice.
  await element("section-form").handlers.submit(event);
  assert.equal(requests.at(-1).input.transform.scale, 1);
  const download = element("section-downloads").children[0];
  assert.equal(JSON.parse(await blobs.get(download.href).text()).segment_count, 8);
  assert.equal(element("section-preview").hidden, false);
  const priorPreview = element("section-preview").src;
  fail = true;
  await element("section-form").handlers.submit(event);
  assert.equal(element("section-preview").src, priorPreview);
  assert.match(element("section-status").textContent, /Previous calculated section/);
  fail = false; hold = true;
  const pending = element("section-form").handlers.submit(event);
  const before = requests.length;
  await element("section-form").handlers.submit(event);
  assert.equal(requests.length, before);
  assert.equal(element("section-controls").disabled, true);
  hold(); hold = null; await pending;
  assert.ok(revoked.includes(priorPreview));
  element("edit-form").handlers.submit(event); await settle();
  assert.equal(element("section-preview").hidden, true);
  assert.equal(element("section-downloads").children.length, 0);
  element("section-position").value = "30";
  await element("section-form").handlers.submit(event);
  const edited = JSON.parse(await blobs.get(element("section-downloads").children[0].href).text());
  assert.deepEqual(edited.bounds_uv_mm.size, [60, 60]);
  element("reset").handlers.click(); await settle();
  assert.equal(element("section-downloads").children.length, 0);
  assert.equal(element("section-preview").hidden, true);
});
