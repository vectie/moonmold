#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { composeReferenceLayout, LAYOUT_MAX_FILE_BYTES } from "../adapter/reference-layout.mjs";
import { exportReferenceLayoutGlb } from "../adapter/reference-glb.mjs";
import { exportReferencePlacements, applyReferencePlacements, PLACEMENTS_MAX_BYTES } from "../adapter/reference-placements.mjs";
import { sectionReferenceLayout } from "../adapter/reference-layout-section.mjs";

try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!["--input", "--format", "--output", "--section-axis", "--section-position", "--placements"].includes(key) || !process.argv[i + 1] || key in options) throw new Error("usage: moonmold-reference-layout --input layout.json [--placements edited.csv] [--section-axis x|y|z --section-position mm] [--format json|layout|obj|stl|glb|placements-csv|svg|csv|dxf] [--output new-file]");
    options[key] = process.argv[i + 1];
  }
  if (!options["--input"]) throw new Error("--input is required");
  const format = options["--format"] ?? "json";
  const isSection = "--section-axis" in options || "--section-position" in options;
  if (options["--placements"] && (isSection || format === "placements-csv")) throw new Error("Apply --placements with json, layout, obj, stl or glb output; section and table export must be separate");
  if (isSection && (!("--section-axis" in options) || !("--section-position" in options))) throw new Error("Both --section-axis and --section-position are required");
  if (!(isSection ? ["json", "svg", "csv", "dxf"] : ["json", "layout", "obj", "stl", "glb", "placements-csv"]).includes(format)) throw new Error(isSection ? "Section format must be json, svg, csv or dxf" : "Layout format must be json, layout, obj, stl, glb or placements-csv");
  if (isSection && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(options["--section-position"])) throw new Error("--section-position must be a decimal number in mm");
  if ((await stat(options["--input"])).size > LAYOUT_MAX_FILE_BYTES) throw new Error("Layout file exceeds 3000000 bytes");
  const text = await readFile(options["--input"], "utf8");
  if (Buffer.byteLength(text) > LAYOUT_MAX_FILE_BYTES) throw new Error("Layout file exceeds 3000000 bytes");
  let input = JSON.parse(text), edited;
  if (options["--placements"]) {
    if ((await stat(options["--placements"])).size > PLACEMENTS_MAX_BYTES) throw new Error("Placement CSV exceeds 16000 bytes");
    const csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(options["--placements"]));
    edited = applyReferencePlacements({ layout: input, csv }); input = edited.layout;
  }
  const result = format === "placements-csv" ? exportReferencePlacements(input) : format === "glb" ? exportReferenceLayoutGlb(input) : isSection ? sectionReferenceLayout(input, { axis: options["--section-axis"], position_mm: Number(options["--section-position"]) }) : (edited ?? composeReferenceLayout(input));
  const output = format === "placements-csv" ? result.csv : format === "glb" ? result : format === "json" ? JSON.stringify(result, null, 2) + "\n" : result.exports[format];
  if (options["--output"]) await writeFile(options["--output"], output, { flag: "wx" });
  else process.stdout.write(output);
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? "reference-layout-error", message: error.message }) + "\n");
  process.exitCode = 1;
}
