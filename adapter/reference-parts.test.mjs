import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { composeReferenceLayout } from "./reference-layout.mjs";
import { sectionReferenceMesh } from "./reference-section.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const fixture = new URL("../fixtures/reference-shelf-assembly.obj", import.meta.url);
const text = await readFile(fixture, "utf8");
const input = { text, input_format: "obj", units: "cm", name: "shelf" };
const sha = value => createHash("sha256").update(value).digest("hex");
const cli = (...args) => spawnSync(process.execPath, [new URL("../bin/moonmold-reference-mesh.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" });

test("inspect source object/group occurrences, repeated names and source face fan provenance", () => {
  const mesh = importReferenceMesh(input);
  assert.equal(mesh.triangle_count, 8);
  assert.equal(mesh.vertex_count, 9);
  assert.deepEqual(mesh.bounds.size, [990, 990, 990]); // Whole reference includes unused source vertex.
  assert.deepEqual(mesh.obj_parts.filter(part => part.kind === "object").map(part => [part.id, part.name]),
    [["object-1", "shelf"], ["object-2", "back"], ["object-3", "bracket"], ["object-4", "bracket"]]);
  assert.deepEqual(mesh.obj_parts.find(part => part.id === "object-1").bounds.size, [60, 40, 0]);
  assert.deepEqual(mesh.triangle_source_faces, [0,0,1,1,2,2,3,3]);
  assert.deepEqual(mesh.source_faces[1], { source_face_index: 1, source_line: 17, source_vertex_indices: [3,2,5,4], object_id: "object-2", group_ids: ["group-3", "group-4"], source_triangle_range: { start: 2, count: 2 } });
  assert.equal(mesh.source.text, text);
  assert.equal(mesh.source_sha256, sha(text));
  assert.equal(mesh.physical_authority, false);
  assert.deepEqual(mesh.losses, []);
});

test("extract union once, compact shared indices without welding, preserve bytes and canonical selection", () => {
  const original = structuredClone(input);
  const mesh = importReferenceMesh({ ...input, part_ids: ["group-4", "object-1", "object-2"] });
  assert.equal(mesh.triangle_count, 4);
  assert.equal(mesh.vertex_count, 6);
  assert.deepEqual(mesh.bounds.size, [60, 40, 30]);
  assert.deepEqual(mesh.source_vertex_indices, [0,1,2,3,4,5]);
  assert.deepEqual(mesh.triangles, [[0,1,2],[0,2,3],[3,2,5],[3,5,4]]);
  assert.deepEqual(mesh.selection, { part_ids: ["object-1", "object-2", "group-4"], source_face_count: 4, selected_face_count: 2 });
  assert.deepEqual(mesh.triangle_source_faces, [0,0,1,1]);
  assert.deepEqual(input, original);
  assert.equal(mesh.source.text, text);
  assert.equal(mesh.source_sha256, sha(text));
  assert.deepEqual(importReferenceMesh(mesh.source), mesh);
  const repeated = importReferenceMesh({ ...input, part_ids: ["object-4"] });
  assert.deepEqual(repeated.source_vertex_indices, [1,2,5,7]);
  assert.deepEqual(repeated.triangle_source_faces, [3,3]);
  const reopened = importReferenceMesh({ text: mesh.exports.obj, units: "mm" });
  assert.deepEqual(reopened.vertices, mesh.vertices);
  assert.deepEqual(reopened.triangles, mesh.triangles);
  assert.deepEqual(reopened.obj_parts.filter(part => part.kind === "object").map(part => part.name), ["shelf", "back"]);
});

test("unassigned faces, empty directives, independent object/group state, and repeated group occurrences", () => {
  const text = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\ng shared other\no first\nf 1 2 3\no first\nf 1 2 3\ng\no\nf 1 2 3\ng shared\nf 1 2 3\n";
  const mesh = importReferenceMesh({ text, units: "mm" });
  assert.deepEqual(mesh.obj_parts.find(part => part.id === "group-1").source_face_indices, [1,2]);
  assert.deepEqual(mesh.obj_parts.filter(part => part.kind === "object").map(part => [part.id, part.name]), [["object-0",null],["object-1","first"],["object-2","first"],["object-3",null]]);
  assert.deepEqual(mesh.obj_parts.find(part => part.id === "group-3").source_face_indices, [4]);
  assert.equal(importReferenceMesh({ text, units: "mm", part_ids: ["object-0"] }).triangle_count, 1);
  assert.equal(importReferenceMesh({ text, units: "mm", part_ids: ["group-1", "group-2"] }).triangle_count, 2);
});

test("selection keeps distinct coincident vertices and negative-index polygon face order", () => {
  const text = "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 0\no same\nf 1 2 3\nf -1 -2 -3\n";
  const mesh = importReferenceMesh({ text, units: "in", part_ids: ["object-1"] });
  assert.equal(mesh.vertex_count, 4);
  assert.deepEqual(mesh.vertices[0], mesh.vertices[3]);
  assert.deepEqual(mesh.source_faces[1].source_vertex_indices, [3,2,1]);
  assert.deepEqual(mesh.triangles, [[0,1,2],[3,2,1]]);
});

test("adversarial BOM/CRLF assembly keeps overlapping groups across repeated object changes", () => {
  const records = ["# mixed membership example", "v 0 0 0", "v 2 0 0", "v 2 2 0", "v 0 2 0", "v 1 1 2", "v 0 0 0", "v 99 99 99",
    "f 1 2 3 4", "o assembly", "g shared accent", "f 1 2 5", "o assembly", "f 2 3 5", "g shared", "f 3 4 5", "g", "o", "f -2 -6 -3", ""];
  const text = "\ufeff" + records.join("\r\n"), source = { text, input_format:"obj", units:"cm", name:"assembly" };
  const full = importReferenceMesh(source);
  assert.equal(full.source.text, text);
  assert.equal(full.source_sha256, sha(Buffer.from(text)));
  assert.deepEqual(full.obj_parts.map(p => [p.id,p.kind,p.name,p.source_face_indices]), [
    ["object-0","object",null,[0]], ["object-1","object","assembly",[1]],
    ["group-1","group","shared",[1,2]], ["group-2","group","accent",[1,2]],
    ["object-2","object","assembly",[2,3]], ["group-3","group","shared",[3]], ["object-3","object",null,[4]]]);
  assert.deepEqual(full.source_faces.map(face => face.source_line), [9,12,14,16,19]);
  const chosen = { ...source, part_ids:["object-3","group-2","group-1"] }, mesh = importReferenceMesh(chosen);
  assert.deepEqual(mesh.source_vertex_indices, [0,1,2,4,5]);
  assert.deepEqual(mesh.triangle_source_faces, [1,2,4]);
  assert.deepEqual(mesh.triangles, [[0,1,3],[1,2,3],[4,1,3]]);
  assert.deepEqual(mesh.vertices[0], mesh.vertices[4]);
  const transform = { scale:2, rotation_deg:[0,0,90], translation_mm:[20,30,40], center_and_ground:true };
  const placed = transformReferenceMesh({ ...chosen, transform });
  const coordinates = value => value.triangles.map(face => face.map(index => value.vertices[index]));
  for (const input_format of ["obj","stl"]) assert.deepEqual(coordinates(importReferenceMesh({ text:placed.exports[input_format], input_format, units:"mm" })), coordinates(placed));
  const layout = composeReferenceLayout({ contract_id:"moonmold.reference-layout.v1", name:"assembly", instances:[{id:"selected",source:mesh.source,transform}] });
  assert.deepEqual(coordinates(layout), coordinates(placed));
  assert.deepEqual(composeReferenceLayout(JSON.parse(layout.exports.layout)), layout);
  const section = sectionReferenceMesh({ ...chosen, section:{axis:"z",position_mm:10} });
  assert.deepEqual(section.triangle_source_faces, [1,2,4]);
  assert.ok(section.segments.every(segment => segment.triangle_ids.every(id => id >= 0 && id < 3)));
});

test("selected transforms, layout source reopen and cross-sections retain original face identity", () => {
  const source = { ...input, part_ids: ["object-2"] };
  const transform = { translation_mm: [100,0,0] };
  const mesh = transformReferenceMesh({ ...source, transform });
  assert.deepEqual(mesh.bounds.min, [100,40,0]);
  assert.deepEqual(mesh.source_vertex_indices, [2,3,4,5]);
  assert.deepEqual(mesh.triangle_source_faces, [1,1]);
  assert.equal(mesh.source.text, text);
  const layout = composeReferenceLayout({ contract_id: "moonmold.reference-layout.v1", name: "independent-panels", instances: [
    { id: "back", source, transform }, { id: "shelf", source: { ...input, part_ids: ["object-1"] } },
  ] });
  assert.equal(layout.triangle_count, 4);
  assert.deepEqual(layout.parts[0].triangle_source_faces, [1,1]);
  assert.equal(layout.layout.instances[0].source.text, text);
  assert.deepEqual(layout.layout.instances[0].source.part_ids, ["object-2"]);
  assert.deepEqual(composeReferenceLayout(JSON.parse(layout.exports.layout)), layout);
  const section = sectionReferenceMesh({ ...source, section: { axis: "z", position_mm: 15 } });
  assert.equal(section.segment_count, 2);
  assert.deepEqual(section.triangle_source_faces, [1,1]);
  assert.ok(section.segments.every(segment => segment.triangle_ids.every(id => section.triangle_source_faces[id] === 1)));
});

test("selection, labels and expansion limits fail explicitly without partial results", () => {
  for (const part_ids of [null, [], "object-1", ["object-1", "object-1"], ["missing"], ["object-0"], [1], Array(257).fill("object-1")]) {
    assert.throws(() => importReferenceMesh({ ...input, part_ids }), { code: "invalid-reference-mesh" });
  }
  assert.throws(() => importReferenceMesh({ ...input, units: undefined, part_ids: ["object-1"] }), /Explicit units/);
  assert.throws(() => importReferenceMesh({ input_format: "stl", text: "", units: "mm", part_ids: ["object-1"] }), /requires an OBJ/);
  for (const text of [input.text + "o " + "x".repeat(201), input.text + "g duplicate duplicate", input.text + "g " + Array.from({length:33},(_,i)=>`g${i}`).join(" "), input.text + "o bad\u0000name", input.text + "# \ud800"]) assert.throws(() => importReferenceMesh({ ...input, text }), { code: "invalid-reference-mesh" });
  assert.throws(() => importReferenceMesh({ ...input, text: input.text + "o repeated\n".repeat(256) }), /256 object\/group/);
  const manyGroups = "v 0 0 0\nv 1 0 0\nv 0 1 0\ng " + Array.from({length:32},(_,i)=>`g${i}`).join(" ") + "\n" + "f 1 2 3\n".repeat(3100);
  assert.throws(() => importReferenceMesh({ text: manyGroups, units: "mm" }), /100000 face-to-part/);
});

test("actual file CLI catalog, extraction, saved source, transform, overwrite refusal and strict UTF-8", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mold-parts-"));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const common = ["--input", fixture.pathname, "--units", "cm"];
  const catalog = cli(...common, "--format", "parts");
  assert.equal(catalog.status, 0, catalog.stderr);
  assert.equal(JSON.parse(catalog.stdout).obj_parts.filter(part => part.kind === "object").length, 4);
  const saved = path.join(directory, "selected.source.json"), obj = path.join(directory, "selected.obj");
  let run = cli(...common, "--parts", "object-2,object-4", "--format", "source", "--output", saved);
  assert.equal(run.status, 0, run.stderr);
  const source = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(source.text, text);
  run = cli("--source", saved, "--format", "obj", "--output", obj);
  assert.equal(run.status, 0, run.stderr);
  const reopened = importReferenceMesh({ text: await readFile(obj, "utf8"), units: "mm" });
  assert.equal(reopened.triangle_count, 4);
  assert.equal(cli("--source", saved, "--format", "obj", "--output", obj).status, 1);
  run = cli("--source", saved, "--transform", new URL("../fixtures/reference-part-placement.json", import.meta.url).pathname);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).triangle_source_faces, [1,1,3,3]);
  assert.equal(cli("--source", saved, "--units", "mm").status, 1);
  assert.equal(cli(...common, "--parts", "object-99").status, 1);
  const raw = Buffer.from("\ufeff" + text.replaceAll("\n", "\r\n"));
  const originalPath = path.join(directory, "original.obj");
  await writeFile(originalPath, raw);
  run = cli("--input", originalPath, "--units", "cm", "--parts", "object-1");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).source_sha256, sha(raw));
  assert.deepEqual(Buffer.from(JSON.parse(run.stdout).source.text), raw);
  await writeFile(path.join(directory, "bad.obj"), Buffer.concat([Buffer.from(text), Buffer.from([0xff])]));
  assert.equal(cli("--input", path.join(directory,"bad.obj"), "--units", "cm").status, 1);
});

test("real HTTP inspect, selected extraction, placement, source replay, layout and useful 400s", async t => {
  const server = createOperatorServer({ workspaceRoot: path.dirname(fixture.pathname) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (endpoint, body) => fetch(base+endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const inspected = await post("/api/reference-mesh/import", input);
  assert.equal(inspected.status, 200);
  assert.equal((await inspected.json()).obj_parts.length, 10);
  const extracted = await post("/api/reference-mesh/transform", { ...input, part_ids:["object-1"], transform:{translation_mm:[10,20,30]} });
  assert.equal(extracted.status, 200);
  const result = await extracted.json();
  assert.deepEqual(result.bounds.min, [10,20,30]);
  assert.equal(result.source.text, text);
  const replay = await post("/api/reference-mesh/import", result.source);
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).triangle_source_faces, [0,0]);
  const layout = await post("/api/reference-layout/compose", { contract_id:"moonmold.reference-layout.v1", name:"selected", instances:[{id:"shelf",source:result.source}] });
  assert.equal(layout.status, 200);
  assert.equal((await layout.json()).triangle_count, 2);
  for (const body of [{...input, part_ids:[]}, {...input, part_ids:["object-99"]}]) {
    const response = await post("/api/reference-mesh/import", body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid-reference-mesh");
  }
});
