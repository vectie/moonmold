#!/usr/bin/env node
import { readFile, writeFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { importReferenceMesh } from "../adapter/reference-mesh.mjs";
import { transformReferenceMesh } from "../adapter/reference-workbench.mjs";
import { sectionReferenceMesh } from "../adapter/reference-section.mjs";

// A local file converter, separate from semantic execution and review.
try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!["--input", "--input-format", "--units", "--name", "--format", "--output", "--transform", "--section-axis", "--section-position-mm", "--parts", "--source", "--nodes"].includes(key) || !process.argv[i+1] || key in options) throw new Error("usage: moonmold-reference-mesh (--input mesh.obj|mesh.stl|mesh.ply|scene.glb --units mm|cm|m|in [--parts object-1,group-2] | --source saved.source.json) [--input-format obj|stl|ply|glb] [--nodes 0,2] [--name reference] [--transform recipe.json] [--section-axis x|y|z --section-position-mm number] [--format json|obj|stl|source|parts (mesh) or json|svg|csv|dxf (section)] [--output new-file]");
    options[key] = process.argv[i+1];
  }
  let input;
  const decode = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (options["--source"]) {
    if (["--input", "--input-format", "--units", "--name", "--parts", "--nodes"].some(key => options[key] !== undefined)) throw new Error("--source cannot be combined with source overrides; edit the saved source explicitly");
    if ((await stat(options["--source"])).size > 2_500_000) throw new Error("Saved source exceeds 2500000 bytes");
    input = JSON.parse(decode(await readFile(options["--source"])));
    if (!input || typeof input !== "object" || Array.isArray(input) || !["obj", "glb"].includes(input.input_format) || Object.keys(input).some(key => !["input_format", "units", "name", "text", "part_ids", "data_base64", "node_ids"].includes(key))) throw new Error("Saved source must be an OBJ or GLB source object with original data and units");
  } else {
    if (!options["--input"]) throw new Error("--input or --source is required");
    const extension = extname(options["--input"]).toLowerCase().slice(1);
    const input_format = options["--input-format"] ?? (["stl", "ply", "glb"].includes(extension) ? extension : "obj");
    if ((await stat(options["--input"])).size > 400_000) throw new Error("Reference input exceeds 400000 bytes");
    const bytes = await readFile(options["--input"]);
    input = { ...(["stl", "ply", "glb"].includes(input_format) ? { data_base64: bytes.toString("base64") } : { text: decode(bytes) }), input_format, units: options["--units"], name: options["--name"] };
    if (options["--nodes"] !== undefined) {
      if (!/^(0|[1-9][0-9]*)(,(0|[1-9][0-9]*))*$/.test(options["--nodes"])) throw new Error("--nodes requires comma-separated zero-based node indices");
      input.node_ids = options["--nodes"].split(",").map(Number);
    }
    if (options["--parts"] !== undefined) input.part_ids = options["--parts"].split(",");
  }
  if (options["--transform"]) input.transform = JSON.parse(await readFile(options["--transform"], "utf8"));
  const slicing = options["--section-axis"] !== undefined || options["--section-position-mm"] !== undefined;
  if (slicing) {
    const position = options["--section-position-mm"];
    if (!position || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(position)) throw new Error("--section-position-mm requires a finite decimal number and --section-axis");
    input.section = { axis: options["--section-axis"], position_mm: Number(position) };
  }
  const mesh = slicing ? sectionReferenceMesh(input) : input.transform ? transformReferenceMesh(input) : importReferenceMesh(input);
  const format = options["--format"] ?? "json";
  const formats = slicing ? ["json", "svg", "csv", "dxf"] : ["json", "obj", "stl", "source", "parts"];
  if (!formats.includes(format)) throw new Error(`--format must be ${formats.join(", ")} for this operation`);
  if (format === "parts" && !mesh.obj_parts) throw new Error("--format parts requires OBJ input");
  if (format === "source" && !mesh.source) throw new Error("--format source requires OBJ or GLB input");
  const data = format === "source" ? mesh.source : format === "parts" ? { source_sha256: mesh.source_sha256, source_units: mesh.source_units, catalog_units: "mm", obj_parts: mesh.obj_parts } : mesh;
  const output = ["json", "source", "parts"].includes(format) ? JSON.stringify(data, null, 2)+"\n" : mesh.exports[format];
  if (options["--output"]) await writeFile(options["--output"], output, { flag: "wx" });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code ?? "reference-mesh-error", message: error.message })}\n`);
  process.exitCode = 1;
}
