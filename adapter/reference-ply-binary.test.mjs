import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { composeReferenceLayout } from "./reference-layout.mjs";
import { sectionReferenceMesh } from "./reference-section.mjs";
import { exportReferenceLayoutGlb } from "./reference-glb.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const fixtures = new URL("../fixtures/", import.meta.url);
const le = await readFile(new URL("reference-tetrahedron-le.ply", fixtures));
const be = await readFile(new URL("reference-tetrahedron-be.ply", fixtures));
const ascii = await readFile(new URL("reference-tetrahedron.ply", fixtures), "utf8");
const layout = JSON.parse(await readFile(new URL("reference-binary-ply.layout.json", fixtures), "utf8"));
const source = (bytes, units = "cm") => ({ input_format: "ply", name: "binary-reference", units, data_base64: bytes.toString("base64") });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const geometry = mesh => ({ vertices: mesh.vertices, triangles: mesh.triangles, bounds: mesh.bounds });
const coords = mesh => mesh.triangles.map(face => face.map(i => mesh.vertices[i]));
const root = process.env.MOONMOLD_PLY_TEST_ROOT ?? path.join(tmpdir(), "moonmold-binary-ply-tests");
await mkdir(root, { recursive: true });
const workdir = () => mkdtemp(path.join(root, "case-")); // Preserve actual outputs for inspection.

// Fixture bytes were independently generated with Python struct; these explicit
// expected coordinates and windings do not call the PLY decoder as an oracle.
test("both binary byte orders import independent fixtures with exact bytes, units and losses", () => {
  for (const [bytes, encoding] of [[le, "binary_little_endian"], [be, "binary_big_endian"]]) {
    const mesh = importReferenceMesh(source(bytes));
    assert.equal(mesh.source_encoding, encoding);
    assert.equal(mesh.source_sha256, sha(bytes));
    assert.equal(mesh.physical_authority, false);
    assert.deepEqual(mesh.vertices, [[0,0,0],[20,0,0],[0,30,0],[0,0,40]]);
    assert.deepEqual(mesh.triangles, [[0,2,1],[0,1,3],[0,3,2],[1,2,3]]);
    assert.deepEqual(mesh.losses, ["PLY comments and object information", "vertex colors", "vertex normals (recomputed from winding for STL)"]);
    for (const [units, size] of [["mm",2],["cm",20],["m",2000],["in",50.8]]) assert.equal(importReferenceMesh(source(bytes, units)).bounds.size[0], size);
    assert.deepEqual(geometry(mesh), geometry(importReferenceMesh({ input_format: "ply", text: ascii, units: "cm" })));
  }
  assert.notEqual(sha(le), sha(be));
  assert.deepEqual(geometry(importReferenceMesh(source(Buffer.from(ascii)))), geometry(importReferenceMesh({ input_format: "ply", text: ascii, units: "cm" })));
});

// Independent test encoder uses DataView; production uses Buffer readers.
const types = { char:[1,"setInt8"],int8:[1,"setInt8"],uchar:[1,"setUint8"],uint8:[1,"setUint8"],short:[2,"setInt16"],int16:[2,"setInt16"],ushort:[2,"setUint16"],uint16:[2,"setUint16"],int:[4,"setInt32"],int32:[4,"setInt32"],uint:[4,"setUint32"],uint32:[4,"setUint32"],float:[4,"setFloat32"],float32:[4,"setFloat32"],double:[8,"setFloat64"],float64:[8,"setFloat64"] };
function encode({ type="float", indexType="int", countType="uchar", little=true, newline="\n", vertices=[[0,0,0],[2,0,0],[0,3,0]], faces=[[0,2,1]], count=3, normal=1 } = {}) {
  const header = ["ply",`format binary_${little?"little":"big"}_endian 1.0`,`element vertex ${vertices.length}`,`property ${type} z`,"property uchar red",`property ${type} x`,`property ${type} y`,"property double nz",`element face ${faces.length}`,"property short blue",`property list ${countType} ${indexType} vertex_index`,"property float ny","end_header", ""].join(newline);
  const chunks = [Buffer.from(header)];
  const scalar = (t,v) => { const [n,method] = types[t], bytes = new Uint8Array(n); new DataView(bytes.buffer)[method](0,v,little); chunks.push(Buffer.from(bytes)); };
  for (const [x,y,z] of vertices) { scalar(type,z); scalar("uchar",240); scalar(type,x); scalar(type,y); scalar("double",normal); }
  for (const face of faces) { scalar("short",1234); scalar(countType,count); for (const v of face) scalar(indexType,v); scalar("float",1); }
  return Buffer.concat(chunks);
}
test("all scalar aliases, signed coordinates, list widths and property order decode without alignment assumptions", () => {
  for (const little of [true,false]) for (const type of Object.keys(types)) {
    const mesh = importReferenceMesh(source(encode({ type, little, newline: little?"\n":"\r\n" }), "mm"));
    assert.deepEqual(mesh.vertices, [[0,0,0],[2,0,0],[0,3,0]], `${type} ${little}`);
    assert.deepEqual(mesh.triangles, [[0,2,1]]);
    assert.deepEqual(mesh.losses, ["face colors","face normals (recomputed from winding for STL)","vertex colors","vertex normals (recomputed from winding for STL)"]);
  }
  for (const little of [true,false]) for (const type of Object.keys(types).slice(0,12)) {
    assert.deepEqual(importReferenceMesh(source(encode({ countType:type, indexType:type, little }),"mm")).triangles, [[0,2,1]]);
  }
  for (const type of ["char","short","int","float","double"]) assert.deepEqual(importReferenceMesh(source(encode({type,vertices:[[-2,0,0],[2,0,0],[0,3,0]]}),"mm")).vertices[0], [-2,0,0]);
  assert.deepEqual(importReferenceMesh(source(encode({type:"double",vertices:[[0,0,0],[1.125,0,0],[0,2.5,0]]}),"mm")).bounds.size,[1.125,2.5,0]);
});

test("truncated headers and every truncated fixture byte reject; trailing bytes and invalid geometry reject", () => {
  for (const bytes of [le,be]) for (let n=0;n<bytes.length;n++) assert.throws(() => importReferenceMesh(source(bytes.subarray(0,n))), { code:"invalid-reference-mesh" }, `length ${n}`);
  for (const bytes of [Buffer.concat([le,Buffer.from([0])]),Buffer.concat([be,Buffer.from("\n")]),encode({count:0}),encode({count:4}),encode({count:-1,countType:"char"}),encode({count:4294967295,countType:"uint"}),encode({faces:[[0,0,1]]}),encode({faces:[[0,-1,1]]}),encode({faces:[[0,3,1]]}),encode({vertices:[[0,0,0],[1,0,0],[2,0,0]]}),encode({vertices:[[0,0,0],[Infinity,0,0],[0,1,0]]}),encode({normal:NaN}),encode({normal:Infinity}),encode({type:"double",vertices:[[0,0,0],[1e10,0,0],[0,1,0]]})]) assert.throws(() => importReferenceMesh(source(bytes)), { code:"invalid-reference-mesh" });
  for (const pair of [["property float x","property float intensity"],["element face 4","element edge 4"],["property float x","property float y"],["property list uchar int","property list float int"],["format binary_little_endian 1.0","format binary_little_endian 2.0"],["element vertex 4","element vertex 40001"]]) {
    const altered = Buffer.from(le.toString("latin1").replace(...pair),"latin1");
    assert.throws(() => importReferenceMesh(source(altered)), { code:"invalid-reference-mesh" });
  }
  for (const value of [{ ...source(le),text:"ply" },{ ...source(le),data_base64:le.toString("base64")+"\n" },{ ...source(le),data_base64:"AB==" },{ ...source(le),units:undefined },{ ...source(le),part_ids:["object-1"] },{ input_format:"ply",units:"mm",text:le.toString("latin1") }]) assert.throws(() => importReferenceMesh(value),{code:"invalid-reference-mesh"});
});

test("exact 400000-byte bound preserves valid bytes while excess, point clouds and unknown properties reject", () => {
  // Long legal comment fills the byte limit without creating a large geometry.
  const prefix=Buffer.from("ply\n"), rest=le.subarray(4), padding=400000-le.length-9;
  const full=Buffer.concat([prefix,rest.subarray(0,rest.indexOf(10)+1),Buffer.from("comment "+"a".repeat(padding)+"\n"),rest.subarray(rest.indexOf(10)+1)]);
  assert.equal(full.length,400000); assert.equal(importReferenceMesh(source(full)).source_sha256,sha(full));
  assert.throws(()=>importReferenceMesh(source(Buffer.concat([full,Buffer.from([0])]))),/400000/);
  const pointCloud=Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n");
  assert.throws(()=>importReferenceMesh(source(pointCloud)),/complete header/);
});

test("place, section, compose and reopen binary sources without loss of bytes or encoding; derived OBJ STL GLB are reusable", () => {
  const result=composeReferenceLayout(layout), reopened=composeReferenceLayout(JSON.parse(result.exports.layout));
  assert.deepEqual(reopened,result); assert.deepEqual(result.bounds.size,[80,30,40]);
  for (const [i,bytes] of [le,be].entries()) {
    assert.equal(result.layout.instances[i].source.data_base64,bytes.toString("base64"));
    assert.equal(result.parts[i].source_sha256,sha(bytes));
    assert.equal(result.parts[i].source_encoding, i?"binary_big_endian":"binary_little_endian");
  }
  const edited=transformReferenceMesh({...source(be),transform:{scale:2,rotation_deg:[0,0,90],center_and_ground:true,translation_mm:[10,20,5]}});
  assert.ok(Math.abs(edited.bounds.size[0]-60)<1e-10); assert.ok(Math.abs(edited.bounds.size[1]-40)<1e-10); assert.equal(edited.bounds.size[2],80); assert.equal(edited.bounds.min[2],5);
  assert.equal(sectionReferenceMesh({...source(le),section:{axis:"z",position_mm:20}}).segment_count,3);
  for (const format of ["obj","stl"]) assert.deepEqual(coords(importReferenceMesh({input_format:format,text:result.exports[format],units:"mm"})),coords(result));
  const glb=exportReferenceLayoutGlb(layout), json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());
  assert.equal(glb.readUInt32LE(0),0x46546c67);assert.equal(glb.readUInt32LE(8),glb.length);assert.equal(json.meshes.length,2);assert.equal(json.nodes[1].name,"be-tetrahedron");
  assert.match(JSON.stringify(json),new RegExp(sha(be)));
  const changed=structuredClone(layout); changed.instances[0].source.data_base64=Buffer.from(le.toString("latin1").replace("Synthetic","synthetic"),"latin1").toString("base64");
  const revision=composeReferenceLayout(changed); assert.equal(revision.geometry_sha256,result.geometry_sha256); assert.notEqual(revision.layout_sha256,result.layout_sha256);
});

test("real CLI reads both raw encodings, applies placement, emits section and exclusive outputs; malformed input leaves no output", async () => {
  const dir=await workdir(), cli=new URL("../bin/moonmold-reference-mesh.mjs",import.meta.url).pathname;
  const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
  for (const suffix of ["le","be"]) {
    const input=new URL(`reference-tetrahedron-${suffix}.ply`,fixtures).pathname;
    const args=["--input",input,"--units","cm"];
    const report=run(args);assert.equal(report.status,0,report.stderr);assert.deepEqual(JSON.parse(report.stdout).bounds.size,[20,30,40]);
    for (const format of ["obj","stl"]) {
      const output=path.join(dir,`${suffix}.${format}`),command=[...args,"--format",format,"--transform",new URL("reference-placement.json",fixtures).pathname,"--output",output];
      const response=run(command);assert.equal(response.status,0,response.stderr);const contents=await readFile(output,"utf8");assert.equal(importReferenceMesh({input_format:format,text:contents,units:"mm"}).triangle_count,4);
      assert.equal(run(command).status,1);assert.equal(await readFile(output,"utf8"),contents);
    }
    const section=run([...args,"--section-axis","z","--section-position-mm","20","--format","svg"]);assert.equal(section.status,0,section.stderr);assert.match(section.stdout,/<svg/);await writeFile(path.join(dir,`${suffix}-section.svg`),section.stdout);
  }
  const bad=path.join(dir,"bad.ply"),output=path.join(dir,"not-created.obj");await writeFile(bad,be.subarray(0,-1));
  const failure=run(["--input",bad,"--units","mm","--format","obj","--output",output]);assert.equal(failure.status,1);assert.match(failure.stderr,/truncated/);await assert.rejects(readFile(output),{code:"ENOENT"});await writeFile(path.join(dir,"refusal.json"),failure.stderr);
  const copied=path.join(dir,"renamed.data");await writeFile(copied,le);assert.equal(run(["--input",copied,"--input-format","ply","--units","mm"]).status,0);
});

test("loopback HTTP imports, transforms, sections, saves/reopens and exports binary PLY; bad input is atomic HTTP 400", async t => {
  const dir=await workdir(),server=createOperatorServer({workspaceRoot:dir});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`, post=(route,body)=>fetch(base+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  for (const [route,input,compute] of [["/api/reference-mesh/import",source(le),importReferenceMesh],["/api/reference-mesh/transform",{...source(be),transform:{scale:2}},transformReferenceMesh],["/api/reference-mesh/section",{...source(be),section:{axis:"z",position_mm:20}},sectionReferenceMesh],["/api/reference-layout/compose",layout,composeReferenceLayout]]) {
    const response=await post(route,input);assert.equal(response.status,200);assert.deepEqual(await response.json(),compute(input));
  }
  const download=await post("/api/reference-layout/glb",layout);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),exportReferenceLayoutGlb(layout));
  const bad=await post("/api/reference-mesh/import",source(le.subarray(0,-1)));assert.equal(bad.status,400);assert.match((await bad.json()).message,/truncated/);
  const retry=await post("/api/reference-mesh/import",source(le));assert.equal(retry.status,200);assert.equal((await retry.json()).source_sha256,sha(le));
  for (const page of ["reference-mesh","reference-layout"]) assert.match(await (await fetch(`${base}/${page}`)).text(),/little-\/big-endian binary XYZ triangles/);
});

function controller(html, compute) {
  const elements=new Map(),blobs=new Map(),calls=[];let serial=0,gate=null;
  function element(id){if(!elements.has(id))elements.set(id,{value:"0",checked:false,disabled:false,textContent:"",children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);},removeAttribute(name){delete this[name];}});return elements.get(id);}
  element("preview").getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{document:{getElementById:element,querySelector:()=>element("import-button"),createElement:()=>({})},Blob,btoa,TextDecoder,
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){blobs.delete(url);}},
    fetch:async(url,options)=>{const input=JSON.parse(options.body);calls.push(input);if(gate)await gate;try{const result=compute(url,input);return{ok:true,json:async()=>result,arrayBuffer:async()=>result};}catch(error){return{ok:false,json:async()=>({message:error.message})};}}
  });
  return{element,calls,hold(){let release;gate=new Promise(resolve=>release=resolve);return()=>{gate=null;release();};},download:async(id,index=0)=>JSON.parse(await blobs.get(element(id).children[index].href).text())};
}
const event={preventDefault(){}},file=bytes=>({name:"reference.PLY",size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer,text:async()=>{throw Error("Binary PLY must not use text decoding");}});

test("actual mesh page reads raw bytes, handles repeated import/edit/reset and retains last source/download after rejection",async()=>{
  const ui=controller(await readFile(new URL("../ui/reference-mesh/index.html",import.meta.url),"utf8"),(url,input)=>url.endsWith("section")?sectionReferenceMesh(input):transformReferenceMesh(input)),el=ui.element;
  el("file").files=[file(be)];el("units").value="cm";const release=ui.hold(),pending=el("import-form").handlers.submit(event);await new Promise(resolve=>setImmediate(resolve));await el("import-form").handlers.submit(event);assert.equal(ui.calls.length,1);release();await pending;
  assert.equal(ui.calls[0].data_base64,be.toString("base64"));assert.equal((await ui.download("downloads")).source_sha256,sha(be));
  el("scale").value="2";await el("edit-form").handlers.submit(event);assert.deepEqual((await ui.download("downloads")).bounds.size,[40,60,80]);
  const old=el("downloads").children;el("file").files=[file(le.subarray(0,-1))];await el("import-form").handlers.submit(event);assert.equal(el("downloads").children,old);assert.match(el("status").textContent,/unchanged/);
  await el("reset").handlers.click();assert.deepEqual((await ui.download("downloads")).bounds.size,[20,30,40]);assert.equal(ui.calls.at(-1).data_base64,be.toString("base64"));
});

test("actual layout page reads bytes, places and saves/reopens exact sources; repeated add and failed reopen keep valid layout",async()=>{
  const ui=controller(await readFile(new URL("../ui/reference-layout/index.html",import.meta.url),"utf8"),(url,input)=>url.endsWith("glb")?exportReferenceLayoutGlb(input):composeReferenceLayout(input)),el=ui.element;
  el("mesh-file").files=[file(le)];el("source-units").value="cm";const release=ui.hold(),pending=el("add-form").handlers.submit(event);await new Promise(resolve=>setImmediate(resolve));await el("add-form").handlers.submit(event);assert.equal(ui.calls.length,1);release();await pending;
  el("tx").value="60";await el("edit-form").handlers.submit(event);const saved=await ui.download("downloads");assert.equal(saved.instances[0].source.data_base64,le.toString("base64"));assert.equal(saved.instances[0].transform.translation_mm[0],60);
  el("layout-file").files=[{size:JSON.stringify(saved).length,text:async()=>JSON.stringify(saved)}];await el("load-form").handlers.submit(event);assert.deepEqual(await ui.download("downloads"),saved);
  const old=el("downloads").children;el("layout-file").files=[{size:4,text:async()=>"nope"}];await el("load-form").handlers.submit(event);assert.equal(el("downloads").children,old);assert.match(el("status").textContent,/unchanged/);
  el("mesh-file").files=[file(be)];await el("add-form").handlers.submit(event);assert.equal((await ui.download("downloads")).instances.length,2);
  await el("glb-export").handlers.click();assert.equal(el("glb-download").children.length,1);
});

test("40000 retained vertices and unsigned high indices remain exact without welding", () => {
  const count=40000,header=Buffer.from(`ply\nformat binary_big_endian 1.0\nelement vertex ${count}\nproperty uchar x\nproperty uchar y\nproperty uchar z\nelement face 1\nproperty list uchar ushort vertex_indices\nend_header\n`),points=Buffer.alloc(count*3),face=Buffer.alloc(7);
  points[3]=2;points[(count-1)*3+1]=3;face[0]=3;face.writeUInt16BE(0,1);face.writeUInt16BE(count-1,3);face.writeUInt16BE(1,5);
  const mesh=importReferenceMesh(source(Buffer.concat([header,points,face]),"mm"));
  assert.equal(mesh.vertex_count,count);assert.deepEqual(mesh.triangles,[[0,39999,1]]);assert.deepEqual(mesh.vertices[39999],[0,3,0]);assert.deepEqual(mesh.bounds.size,[2,3,0]);
});
