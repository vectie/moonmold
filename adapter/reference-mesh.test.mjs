import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const sample = await readFile(new URL("../fixtures/reference-tetrahedron.obj", import.meta.url), "utf8");
const triangle = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";

test("OBJ sample imports dimensions, identity, winding and downloadable siblings", () => {
  const mesh = importReferenceMesh({ text: sample, units: "cm" });
  assert.deepEqual(mesh.bounds, { min:[0,0,0], max:[20,30,40], size:[20,30,40] });
  assert.equal(mesh.triangle_count, 4);
  assert.deepEqual(mesh.triangles[0], [0,2,1]);
  assert.deepEqual(mesh.losses, []);
  assert.equal(mesh.obj_parts[0].name, "sample-tetrahedron");
  assert.equal(mesh.physical_authority, false);
  assert.equal(mesh.representation, "reference-set");
  assert.match(mesh.source_sha256, /^[a-f0-9]{64}$/);
  assert.equal((mesh.exports.stl.match(/facet normal/g) ?? []).length, 4);
  assert.match(mesh.exports.stl, /vertex 0 0 40/);
  const roundtrip = importReferenceMesh({ text: mesh.exports.obj, units: "mm" });
  assert.deepEqual(roundtrip.vertices, mesh.vertices);
  assert.deepEqual(roundtrip.triangles, mesh.triangles);
});

test("convex quad, relative indices, texture and normal references", () => {
  const mesh = importReferenceMesh({ text: "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\nf -4/1/1 -3/1/1 -2/1/1 -1/1/1", units: "in" });
  assert.deepEqual(mesh.triangles, [[0,1,2],[0,2,3]]);
  assert.deepEqual(mesh.bounds.size, [25.4,25.4,0]);
  assert.deepEqual(mesh.losses, ["texture coordinates", "vertex normals"]);
});

test("invalid and unsupported geometry produces explicit errors", () => {
  for (const text of ["", triangle.replace("f 1 2 3", "f 0 2 3"), triangle.replace("f 1 2 3", "f 1 2 4"), triangle.replace("f 1 2 3", "f 1 1 3"), triangle.replace("v 1 0 0", "v NaN 0 0"), triangle+"call executable\n", triangle.replace("f 1 2 3", "f 1/1 2/1 3/1"), "v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3", "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 1\nf 1 2 3 4", "v 0 0 0\nv 2 0 0\nv 1 0.5 0\nv 2 2 0\nv 0 2 0\nf 1 2 3 4 5"]) {
    assert.throws(() => importReferenceMesh({text, units:"mm"}), {code:"invalid-reference-mesh"});
  }
  assert.throws(() => importReferenceMesh({ text:triangle }), /Explicit units/);
  assert.throws(() => importReferenceMesh({ text:triangle, units:"mm", name:"../outside" }), /mesh name/);
});

test("CLI exports JSON, OBJ and STL from an actual local sample", () => {
  const executable = new URL("../bin/moonmold-reference-mesh.mjs", import.meta.url);
  for (const format of ["json", "obj", "stl"]) {
    const result = spawnSync(process.execPath, [executable.pathname, "--input", new URL("../fixtures/reference-tetrahedron.obj", import.meta.url).pathname, "--units", "cm", "--format", format], {encoding:"utf8"});
    assert.equal(result.status, 0, result.stderr);
    if (format === "json") assert.deepEqual(JSON.parse(result.stdout).bounds.size,[20,30,40]);
    else assert.match(result.stdout, format === "obj" ? /v 0 0 40/ : /vertex 0 0 40/);
  }
});

test("CLI output is reusable and never overwrites an existing file", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "moonmold-reference-cli-"));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const args = [new URL("../bin/moonmold-reference-mesh.mjs", import.meta.url).pathname, "--input", new URL("../fixtures/reference-tetrahedron.obj", import.meta.url).pathname, "--units", "cm", "--format", "obj", "--output", path.join(dir,"mesh.obj")];
  const first = spawnSync(process.execPath,args,{encoding:"utf8"});
  assert.equal(first.status,0,first.stderr);
  const output = await readFile(path.join(dir,"mesh.obj"),"utf8");
  assert.equal(importReferenceMesh({text:output,units:"mm"}).triangle_count,4);
  const second = spawnSync(process.execPath,args,{encoding:"utf8"});
  assert.equal(second.status,1);assert.match(second.stderr,/EEXIST/);
  assert.equal(await readFile(path.join(dir,"mesh.obj"),"utf8"),output);
});

test("real operator HTTP imports geometry, serves UI and reports parse failures", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "moonmold-reference-"));
  const server = createOperatorServer({workspaceRoot:workspace});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(workspace,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+"/api/reference-mesh/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:sample,units:"cm"})});
  assert.equal(response.status,200);
  const mesh=await response.json();assert.equal(mesh.triangle_count,4);assert.deepEqual(mesh.bounds.size,[20,30,40]);
  const ui=await fetch(base+"/reference-mesh");assert.equal(ui.status,200);assert.match(await ui.text(),/Download/);
  const invalid=await fetch(base+"/api/reference-mesh/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:sample})});
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,"invalid-reference-mesh");
});
