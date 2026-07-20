import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverBlender } from "./blender.mjs";
import { runLiveBlenderExperiment } from "./live-blender.mjs";
import { createMcpHandler } from "./mcp.mjs";

const LIVE = process.env.MOONMOLD_LIVE_BLENDER === "1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workspace Blender manifest is discoverable", () => {
  const blender = discoverBlender();
  assert.equal(blender.available, true);
  assert.equal(blender.source, "workspace-tool-manifest");
  assert.match(blender.version, /Blender 4\.5\.11 LTS/);
  assert.equal(blender.workspaceManifest.physical_effects, false);
});

test("live Blender creates validated evidence for all qualified structures", { skip: !LIVE }, async () => {
  for (const [fixture, output] of [
    ["habitat-a.json", ".tmp/live-blender-habitat"],
    ["tower-b.json", ".tmp/live-blender-tower"],
    ["city-hall-image-referenced.json", ".tmp/live-blender-city-hall"],
  ]) {
    const outputRoot = path.join(ROOT, output);
    await rm(outputRoot, { recursive: true, force: true });
    const evidence = await runLiveBlenderExperiment({
      workspaceRoot: ROOT,
      inputPath: path.join(ROOT, "fixtures", fixture),
      outputRoot,
    });
    assert.equal(evidence.accepted, true);
    assert.equal(evidence.evidenceClass, "live-blender");
    assert.equal(evidence.physicalEffects, false);
    assert.equal(evidence.unrestrictedScripts, false);
    for (const name of ["model.blend", "model.glb", "model.stl", "render.png"]) {
      assert.ok(evidence.outputs[name].size > 64);
      assert.match(evidence.outputs[name].digest, /^sha256:[a-f0-9]{64}$/);
    }
    const repeated = await runLiveBlenderExperiment({
      workspaceRoot: ROOT,
      inputPath: path.join(ROOT, "fixtures", fixture),
      outputRoot,
    });
    assert.equal(repeated.outcome, "idempotent-no-op");
  }
});

test("MCP live tool returns attributable Blender receipt", { skip: !LIVE }, async () => {
  const outputRoot = path.join(ROOT, ".tmp/mcp-live-blender");
  await rm(outputRoot, { recursive: true, force: true });
  const handle = createMcpHandler();
  const response = await handle({
    jsonrpc: "2.0",
    id: 41,
    method: "tools/call",
    params: {
      name: "moonmold_live_building",
      arguments: {
        requestId: "mcp-live-41",
        idempotencyKey: "mcp-live-city-hall-v1",
        workspaceRoot: ROOT,
        inputPath: path.join(ROOT, "fixtures/city-hall-image-referenced.json"),
        outputRoot,
        timeoutMs: 120000,
        authority: "workspace-mutation"
      }
    }
  });
  assert.equal(response.result.structuredContent.requestId, "mcp-live-41");
  assert.equal(response.result.structuredContent.evidence.evidenceClass, "live-blender");
  assert.equal(response.result.structuredContent.evidence.physicalEffects, false);
});
