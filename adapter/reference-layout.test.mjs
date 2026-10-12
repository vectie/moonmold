import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { composeReferenceLayout, LAYOUT_CONTRACT } from "./reference-layout.mjs";
import { transformReferenceMesh } from "./reference-workbench.mjs";
import { importReferenceMesh } from "./reference-mesh.mjs";
import { createOperatorServer } from "./operator-server.mjs";
import { canonicalJson } from "./protocol.mjs";

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const example = JSON.parse(await readFile(fixture("reference-layout.json"), "utf8"));
const copy = value => JSON.parse(JSON.stringify(value));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const close = (a,b) => a.forEach((value,i) => assert.ok(Math.abs(value-b[i]) < 1e-9, `${a} != ${b}`));

test("compose original sources with mixed units, independent transforms, bounds and indexed parts", () => {
  const before = copy(example), result = composeReferenceLayout(example);
  assert.deepEqual(example,before); assert.equal(result.physical_authority,false);
  assert.equal(result.instance_count,3); assert.equal(result.vertex_count,9); assert.equal(result.triangle_count,3);
  close(result.bounds.min,[-22,-2e-16,0]); close(result.bounds.max,[35.4,45.4,6]); close(result.bounds.size,[57.4,45.4,6]);
  for (const [index,item] of example.instances.entries()) {
    const mesh = transformReferenceMesh({...item.source,transform:item.transform}), part = result.parts[index];
    assert.deepEqual(part.bounds,mesh.bounds); assert.deepEqual(part.source_bounds,mesh.source_bounds);
    assert.equal(part.source_sha256,mesh.source_sha256); assert.equal(part.source_units,item.source.units);
    assert.deepEqual(part.transform,mesh.transform);
    assert.deepEqual(result.vertices.slice(part.vertex_range.start,part.vertex_range.start+part.vertex_range.count),mesh.vertices);
    assert.ok(result.triangles.slice(part.triangle_range.start,part.triangle_range.start+part.triangle_range.count).flat().every(i => i >= part.vertex_range.start && i < part.vertex_range.start+part.vertex_range.count));
  }
  assert.equal(result.layout_sha256,sha(canonicalJson(result.layout)));
  assert.equal(result.geometry_sha256,sha(canonicalJson({ units: "mm", vertices: result.vertices, triangles: result.triangles })));
  assert.match(result.qualification,/No welding, boolean union, collision/);
});

test("save and reopen original bytes and normalized placements; moving one part preserves all others", () => {
  const result = composeReferenceLayout(example), saved = JSON.parse(result.exports.layout);
  assert.deepEqual(composeReferenceLayout(saved),result);
  assert.equal(saved.instances[0].source.text,example.instances[0].source.text);
  const changed = copy(saved); changed.instances[1].transform.translation_mm[0] += 100;
  const edited = composeReferenceLayout(changed);
  assert.notEqual(edited.layout_sha256,result.layout_sha256); assert.notEqual(edited.geometry_sha256,result.geometry_sha256);
  assert.deepEqual(edited.vertices.slice(0,3),result.vertices.slice(0,3)); assert.deepEqual(edited.vertices.slice(6),result.vertices.slice(6));
  assert.equal(edited.parts[1].source_sha256,result.parts[1].source_sha256);
  changed.instances[1].transform = saved.instances[1].transform;
  assert.deepEqual(composeReferenceLayout(changed),result);
  changed.instances[0].source.text += "# revised original\n";
  const newSource = composeReferenceLayout(changed);
  assert.notEqual(newSource.layout_sha256,result.layout_sha256); assert.equal(newSource.geometry_sha256,result.geometry_sha256);
  assert.notEqual(newSource.parts[0].source_sha256,result.parts[0].source_sha256);
});

test("coincident duplicates are concatenated without welding or boolean union; OBJ and STL round-trip", () => {
  const item = copy(example.instances[0]);
  const result = composeReferenceLayout({contract_id:LAYOUT_CONTRACT,name:"overlapping",instances:[item,{...copy(item),id:"duplicate"}]});
  assert.equal(result.vertex_count,6); assert.equal(result.triangle_count,2);
  assert.deepEqual(result.triangles,[[0,1,2],[3,4,5]]);
  assert.match(result.exports.obj,/o base-triangle\nf 1 2 3\no duplicate\nf 4 5 6/);
  const obj = importReferenceMesh({text:result.exports.obj,units:"mm"});
  assert.deepEqual(obj.vertices,result.vertices); assert.deepEqual(obj.triangles,result.triangles);
  const stl = importReferenceMesh({text:result.exports.stl,input_format:"stl",units:"mm"});
  assert.equal(stl.triangle_count,2); assert.deepEqual(stl.bounds,result.bounds);
  assert.doesNotMatch(result.exports.stl,/NaN|Infinity/);
});

test("ASCII and binary STL preserve exact byte lineage and share composition with OBJ", async () => {
  for (const file of ["reference-tetrahedron-ascii.stl","reference-tetrahedron-binary.stl"]) {
    const bytes = await readFile(fixture(file));
    const input = copy(example);
    input.instances.push({id:"stl-placement",source:{input_format:"stl",units:"cm",data_base64:bytes.toString("base64")},transform:{translation_mm:[-100,0,0]}});
    const result = composeReferenceLayout(input), part = result.parts.at(-1);
    assert.equal(part.source_sha256,sha(bytes)); assert.equal(part.source_encoding,file.includes("binary")?"binary":"ascii");
    assert.deepEqual(part.bounds.size,[20,30,40]); assert.deepEqual(part.bounds.min,[-100,0,0]);
    assert.equal(result.layout.instances.at(-1).source.data_base64,bytes.toString("base64"));
    assert.deepEqual(composeReferenceLayout(JSON.parse(result.exports.layout)),result);
  }
});

test("source orphan vertices remain in displayed bounds and OBJ; STL loss is disclosed", () => {
  const input = copy(example); input.instances = [input.instances[0]];
  input.instances[0].source.text += "v 100 100 100\n";
  const result = composeReferenceLayout(input);
  assert.deepEqual(result.bounds.max,[100,100,100]);
  const obj = importReferenceMesh({text:result.exports.obj,units:"mm"});
  const stl = importReferenceMesh({text:result.exports.stl,input_format:"stl",units:"mm"});
  assert.deepEqual(obj.bounds,result.bounds); assert.deepEqual(stl.bounds.max,[2,3,0]);
  assert.ok(result.losses.some(loss=>loss.includes("unreferenced vertices")));
});

test("bounded manifest rejects malformed identities, hidden source alternatives and invalid transforms", () => {
  for (const mutate of [
    input => input.contract_id = "future", input => input.name = "../outside", input => input.instances = [],
    input => input.instances[1].id = input.instances[0].id, input => input.instances[0].id = "<script>",
    input => input.instances[0].source.units = undefined, input => input.instances[0].source.input_format = undefined,
    input => input.instances[0].source.url = "https://example.com/model.obj", input => input.instances[0].source.path = "mesh.obj",
    input => input.instances[0].transform = {scale:0}, input => input.instances[0].transform = null,
    input => input.instances[0].transform = {translation_mm:[0,0,Infinity]}, input => input.instances[0].transform = {weld:true},
    input => input.instances[0].unexpected = true, input => input.extra = true,
    input => input.instances[0].source.data_base64 = "AAAA", input => input.instances[0].source.text = "v 0 0 0",
  ]) { const input = copy(example); mutate(input); assert.throws(() => composeReferenceLayout(input),{code:"invalid-reference-layout"}); }
  for (const input of [null,[],{},"layout"]) assert.throws(() => composeReferenceLayout(input),{code:"invalid-reference-layout"});
  const max = {...copy(example),instances:Array.from({length:16},(_,i)=>({...copy(example.instances[0]),id:`part-${i}`}))};
  assert.equal(composeReferenceLayout(max).instance_count,16);
  max.instances.push({...copy(example.instances[0]),id:"part-17"}); assert.throws(() => composeReferenceLayout(max),/1 through 16/);
  const oversized = copy(example); oversized.instances[0].source.text = "x".repeat(2_000_000);
  assert.throws(() => composeReferenceLayout(oversized),/compact JSON bytes/);
  const many = "v 0 0 0\nv 1 0 0\nv 0 1 0\n"+"v 0 0 0\n".repeat(20_000)+"f 1 2 3\n";
  const dense = {...copy(example),instances:["a","b"].map(id=>({id,source:{input_format:"obj",units:"mm",text:many}}))};
  assert.throws(() => composeReferenceLayout(dense),/40000 vertices/);
});

test("CLI creates real layout, report, OBJ and STL files; reloads; rejects overwrite and bad flags", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(),"moonmold-layout-cli-")); t.after(() => rm(dir,{recursive:true,force:true}));
  const cli = new URL("../bin/moonmold-reference-layout.mjs",import.meta.url).pathname;
  const result = composeReferenceLayout(example), run = args => spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
  for (const format of ["json","layout","obj","stl"]) {
    const file = path.join(dir,`export.${format}`), args = ["--input",fixture("reference-layout.json").pathname,"--format",format,"--output",file];
    const command = run(args); assert.equal(command.status,0,command.stderr);
    const bytes = await readFile(file,"utf8"); assert.equal(bytes,format === "json" ? JSON.stringify(result,null,2)+"\n" : result.exports[format]);
    assert.equal(run(args).status,1); assert.equal(await readFile(file,"utf8"),bytes);
    if (format === "layout") { const reopened = run(["--input",file]); assert.equal(reopened.status,0,reopened.stderr); assert.deepEqual(JSON.parse(reopened.stdout),result); }
  }
  for (const flags of [[],["--unknown","x"],["--input"],["--input",fixture("reference-layout.json").pathname,"--format","svg"],["--input","a","--input","b"]]) assert.equal(run(flags).status,1);
  const bad = path.join(dir,"invalid.json"); await writeFile(bad,"{broken"); assert.equal(run(["--input",bad]).status,1);
  await writeFile(bad," ".repeat(3_000_001)); assert.match(run(["--input",bad]).stderr,/exceeds 3000000/);
});

test("real HTTP compose, edit, reopen and errors with served workbench syntax", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(),"moonmold-layout-http-")); const server = createOperatorServer({workspaceRoot:dir});
  await new Promise((resolve,reject) => {server.once("error",reject); server.listen(0,"127.0.0.1",resolve);});
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(base+"/api/reference-layout/compose",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const response = await send(example); assert.equal(response.status,200); const result = await response.json(); assert.deepEqual(result,composeReferenceLayout(example));
  const changed = copy(result.layout); changed.instances[0].transform.translation_mm = [100,0,0];
  const edit = await send(changed); assert.equal(edit.status,200); assert.deepEqual((await edit.json()).parts[0].bounds.min,[100,0,0]);
  const reopened = await send(JSON.parse(result.exports.layout)); assert.deepEqual(await reopened.json(),result);
  changed.instances[0].source.units = "unknown"; const bad = await send(changed); assert.equal(bad.status,400); assert.equal((await bad.json()).code,"invalid-reference-layout");
  assert.equal((await send({...example,instances:[]})).status,400);
  const large = await fetch(base+"/api/reference-layout/compose",{method:"POST",body:" ".repeat(3_000_001)}); assert.equal(large.status,400);
  const html = await (await fetch(base+"/reference-layout")).text();
  for (const marker of ["Save editable layout","Duplicate selected","Remove selected","/api/reference-layout/compose"]) assert.ok(html.includes(marker));
  assert.match(await (await fetch(base+"/reference-mesh")).text(),/href="\/reference-layout"/);
  const syntax = spawnSync(process.execPath,["--input-type=module","--check"],{input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:"utf8"}); assert.equal(syntax.status,0,syntax.stderr);
});

test("served UI adds, edits, duplicates, reloads and removes while retaining good outputs on failure", async () => {
  const html = await readFile(new URL("../ui/reference-layout/index.html",import.meta.url),"utf8");
  const elements = new Map(), blobs = new Map(), revoked = [], calls = []; let serial = 0, fail = false, hold = null;
  function element(id) {
    if (!elements.has(id)) elements.set(id,{value:"0",checked:false,disabled:false,textContent:"",children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);}});
    return elements.get(id);
  }
  element("preview").getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
  element("preview").width=1000; element("preview").height=400;
  element("yaw").value="35"; element("pitch").value="25"; element("source-units").value="mm";
  element("mesh-file").files=[{name:"sample.obj",size:100,text:async()=>example.instances[0].source.text}];
  runInNewContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:element,createElement:()=>({})},Blob,Uint8Array,btoa:bytes=>Buffer.from(bytes,"binary").toString("base64"),
    URL:{createObjectURL(blob){const url=`blob:${++serial}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(hold)await new Promise(resolve=>{hold=resolve;});if(fail)return{ok:false,json:async()=>({message:"synthetic failure"})};try{return{ok:true,json:async()=>composeReferenceLayout(JSON.parse(options.body))};}catch(error){return{ok:false,json:async()=>({message:error.message})};}},
  });
  const event={preventDefault(){}}, saved=async()=>JSON.parse(await blobs.get(element("downloads").children[0].href).text());
  await element("add-form").handlers.submit(event);
  assert.equal((await saved()).instances.length,1); assert.equal(element("edit-controls").disabled,false);
  element("tx").value="30"; element("scale").value="2"; await element("edit-form").handlers.submit(event);
  assert.deepEqual((await saved()).instances[0].transform.translation_mm,[30,0,0]);
  await element("duplicate").handlers.click(); const duplicated=await saved(); assert.equal(duplicated.instances.length,2); assert.equal(duplicated.instances[1].id,"reference-2");
  assert.deepEqual(duplicated.instances[0].transform,duplicated.instances[1].transform);
  element("tx").value="70"; await element("edit-form").handlers.submit(event); const moved=await saved(); assert.equal(moved.instances[0].transform.translation_mm[0],30); assert.equal(moved.instances[1].transform.translation_mm[0],70);
  const oldUrl=element("downloads").children[0].href;
  fail=true; element("tx").value="90"; await element("edit-form").handlers.submit(event); assert.equal(element("downloads").children[0].href,oldUrl); assert.match(element("status").textContent,/unchanged/); fail=false;
  hold=true; const pending=element("edit-form").handlers.submit(event), count=calls.length; await element("duplicate").handlers.click(); assert.equal(calls.length,count); assert.equal(element("load-controls").disabled,true); hold(); hold=null; await pending; assert.ok(revoked.includes(oldUrl));
  element("selected").value="reference-1"; element("selected").handlers.change(); assert.equal(element("tx").value,"30");
  await element("reset").handlers.click(); assert.equal((await saved()).instances[0].transform.scale,1); assert.equal((await saved()).instances[1].transform.translation_mm[0],90);
  element("layout-file").files=[{size:1000,text:async()=>JSON.stringify(moved)}]; await element("load-form").handlers.submit(event); assert.deepEqual(await saved(),moved);
  element("layout-file").files=[{size:6,text:async()=>"broken"}]; await element("load-form").handlers.submit(event); assert.deepEqual(await saved(),moved);
  await element("remove").handlers.click(); assert.equal((await saved()).instances.length,1); await element("remove").handlers.click(); assert.equal(element("downloads").children.length,0); assert.equal(element("edit-controls").disabled,true); assert.match(element("status").textContent,/empty/);
  const binary=await readFile(fixture("reference-tetrahedron-binary.stl")); element("mesh-file").files=[{name:"binary.stl",size:binary.length,arrayBuffer:async()=>binary}]; element("source-units").value="cm";
  await element("add-form").handlers.submit(event); assert.equal((await saved()).instances[0].source.data_base64,binary.toString("base64"));
  assert.match(element("part-status").textContent,/STL \(binary\).*cm/);
});
