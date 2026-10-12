import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { sectionReferenceLayout } from "./reference-layout-section.mjs";
import { sectionReferenceMesh } from "./reference-section.mjs";
import { composeReferenceLayout, LAYOUT_CONTRACT } from "./reference-layout.mjs";
import { canonicalJson } from "./protocol.mjs";

const cube = { input_format: "obj", units: "mm", text: await readFile(new URL("../fixtures/reference-section-cube.obj", import.meta.url), "utf8"), name: "cube" };
const layout = (...instances) => ({ contract_id: LAYOUT_CONTRACT, name: "section-study", instances });
const part = (id, transform = {}) => ({ id, source: structuredClone(cube), transform });
const slice = (input, axis = "z", position_mm = 10) => sectionReferenceLayout(input, { axis, position_mm });
const sha = value => createHash("sha256").update(canonicalJson(value)).digest("hex");

test("X/Y/Z sections preserve coincident instances and local/global triangle lineage", () => {
  for (const axis of ["x", "y", "z"]) {
    const input = layout(part("first"), part("second")), before = structuredClone(input);
    const result = slice(input, axis);
    assert.deepEqual(input, before);
    assert.equal(result.segment_count, 16);
    assert.equal(result.segment_length_sum_mm, 160);
    assert.equal(result.parts.length, 2);
    assert.equal(result.physical_authority, false);
    assert.match(result.qualification, /No collision, clearance/);
    assert.deepEqual(result.bounds_uv_mm, { min: [0, 0], max: [20, 20], size: [20, 20] });
    for (const line of result.segments) {
      const offset = line.instance_id === "second" ? 12 : 0;
      assert.deepEqual(line.layout_triangle_ids, line.triangle_ids.map(n => n + offset));
      assert.equal(line.source_sha256, result.parts[0].source_sha256);
      assert.equal(line.start_mm[["x", "y", "z"].indexOf(axis)], 10);
    }
    const { exports, section_sha256, ...hashed } = result;
    assert.equal(section_sha256, sha(hashed));
    assert.match(exports.svg, /data-instance-id="first"/);
    assert.match(exports.svg, /data-instance-id="second"/);
    assert.ok(exports.svg.includes(result.layout_sha256));
    assert.equal(exports.csv.trim().split("\r\n").length, 19);
    assert.deepEqual(slice(input, axis), result);
  }
});

test("placed mixed-unit sections match the independent source workflow and saved layout", () => {
  const a = part("rotated", { scale: 2, rotation_deg: [30, 15, 90], center_and_ground: true, translation_mm: [5, -10, 2] });
  const b = part("inch", { translation_mm: [0, 0, -100] }); b.source.units = "in";
  const input = layout(a, b), result = slice(input);
  for (const [index, instance] of input.instances.entries()) {
    const { exports, ...expected } = sectionReferenceMesh({ ...instance.source, transform: instance.transform, section: { axis: "z", position_mm: 10 } });
    const { instance_id, triangle_range, ...actual } = result.parts[index];
    assert.deepEqual(actual, expected);
  }
  assert.deepEqual(slice(JSON.parse(composeReferenceLayout(input).exports.layout)), result);
  const edited = structuredClone(input); edited.instances[0].transform.translation_mm[0]++;
  const moved = slice(edited);
  assert.notEqual(moved.layout_sha256, result.layout_sha256);
  assert.notEqual(moved.section_sha256, result.section_sha256);
  assert.deepEqual(moved.parts[1], result.parts[1]);
  edited.instances[0].transform = input.instances[0].transform;
  edited.instances[0].source.text += "# source-only revision\n";
  const revision = slice(edited);
  assert.equal(revision.geometry_sha256, result.geometry_sha256);
  assert.notEqual(revision.layout_sha256, result.layout_sha256);
});

test("point contacts and coplanar omissions remain per instance, including empty exports", () => {
  const source = text => ({ input_format: "obj", units: "mm", text });
  const input = layout(
    { id: "contact", source: source("v 0 0 0\nv 1 0 2\nv 0 1 2\nf 1 2 3\n") },
    { id: "coplanar", source: source("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n") },
    part("outside", { translation_mm: [0, 0, 100] }),
  );
  const result = slice(input, "z", 0);
  assert.deepEqual(result.parts.map(p => p.status), ["point-contact", "coplanar-only", "empty"]);
  assert.equal(result.segment_count, 0); assert.equal(result.point_contact_count, 1);
  assert.equal(result.diagnostics.coplanar_triangles, 1);
  assert.match(result.exports.svg, /circle data-instance-id="contact"/);
  assert.match(result.exports.csv, /"point-contact"/);
  assert.equal(result.exports.csv.trim().split("\r\n").length, 5);
  const empty = slice(input, "z", -10);
  assert.equal(empty.status, "empty"); assert.equal(empty.bounds_uv_mm, null);
  assert.equal(empty.exports.csv.trim().split("\r\n").length, 4);
  assert.doesNotMatch(empty.exports.svg, /NaN|Infinity|undefined/);
});

test("binary STL keeps exact source bytes and independent IDs beside OBJ", async () => {
  const bytes = await readFile(new URL("../fixtures/reference-tetrahedron-binary.stl", import.meta.url));
  const binary = { id: "binary", source: { input_format: "stl", units: "cm", data_base64: bytes.toString("base64") }, transform: { translation_mm: [30, 0, 0] } };
  const result = slice(layout(part("obj"), binary), "z", 20);
  assert.equal(result.parts[1].source_encoding, "binary");
  assert.equal(result.parts[1].source_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.parts[1].segment_count, 3);
  assert.deepEqual(result.parts[1].bounds_uv_mm, { min: [30, 0], max: [40, 15], size: [10, 15] });
  assert.equal(result.parts[0].diagnostics.coplanar_triangles, 2);
});

test("malformed planes/layouts reject and large separated parts retain independent tolerance", () => {
  const input = layout(part("small"), part("far", { translation_mm: [0, 0, 900000000] }));
  for (const plane of [null, {}, { axis: "Z", position_mm: 0 }, { axis: "z", position_mm: Infinity }, { axis: "z", position_mm: "0" }, { axis: "z", position_mm: 1e9 + 1 }, { axis: "z", position_mm: 0, script: "x" }]) assert.throws(() => sectionReferenceLayout(input, plane));
  assert.throws(() => slice(layout(part("dup"), part("dup"))));
  assert.throws(() => slice({ ...input, extra: true }));
  const result = slice(input);
  assert.equal(result.parts[0].segment_count, 8);
  assert.equal(result.parts[1].status, "empty");
  assert.ok(result.parts[0].tolerance_mm < result.parts[1].tolerance_mm);
});

test("CLI emits JSON/SVG/CSV, rejects malformed options, and never replaces existing files", async () => {
  // Preserve evidence; batch authors can select a private external output root.
  const directory = await mkdtemp(process.env.MOONMOLD_LAYOUT_SECTION_TEST_ROOT ? `${process.env.MOONMOLD_LAYOUT_SECTION_TEST_ROOT}/case-` : new URL("../evidence/layout-section-test-", import.meta.url));
  const inputPath = `${directory}/input.json`;
  await writeFile(inputPath, JSON.stringify(layout(part("cube"))));
  const cli = new URL("../bin/moonmold-reference-layout.mjs", import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, "--input", inputPath, ...args], { encoding: "utf8" });
  const plane = ["--section-axis", "z", "--section-position", "10"];
  for (const format of ["json", "svg", "csv"]) {
    const output = `${directory}/section.${format}`;
    const executed = run([...plane, "--format", format, "--output", output]);
    assert.equal(executed.status, 0, executed.stderr);
    const bytes = await readFile(output, "utf8");
    if (format === "json") assert.equal(JSON.parse(bytes).segment_count, 8);
    assert.equal(run([...plane, "--format", format, "--output", output]).status, 1);
    assert.equal(await readFile(output, "utf8"), bytes);
  }
  for (const args of [["--section-axis", "z"], ["--section-position", "10"], [...plane, "--format", "obj"], ["--format", "svg"], ["--section-axis", "z", "--section-position", " "], ["--section-axis", "z", "--section-position", "0x10"], [...plane, "--section-axis", "x"]]) assert.equal(run(args).status, 1);
  assert.equal(run([...plane, "--output", inputPath]).status, 1);
  assert.equal(JSON.parse(await readFile(inputPath, "utf8")).contract_id, LAYOUT_CONTRACT);
});
