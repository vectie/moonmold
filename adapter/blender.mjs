import { accessSync, constants, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MOONSUITE_ROOT } from "./protocol.mjs";

function manifestCandidate(workspaceRoot) {
  const toolManifest = path.join(
    workspaceRoot,
    "tools/blender/runtime-manifest.json",
  );
  try {
    const manifest = JSON.parse(readFileSync(toolManifest, "utf8"));
    if (
      manifest.contract_id !== "moonsuite.workspace-tool-runtime.v1" ||
      manifest.tool_id !== "blender" ||
      manifest.physical_effects !== false ||
      typeof manifest.binary_path !== "string"
    ) return null;
    const executable = path.resolve(workspaceRoot, manifest.binary_path);
    if (!executable.startsWith(`${workspaceRoot}${path.sep}`)) return null;
    return { executable, manifest };
  } catch {
    return null;
  }
}

export function discoverBlender(workspaceRoot = MOONSUITE_ROOT) {
  const workspace = manifestCandidate(workspaceRoot);
  const candidates = [
    process.env.BLENDER_BIN
      ? { executable: process.env.BLENDER_BIN, source: "BLENDER_BIN" }
      : null,
    process.env.MOONMOLD_BLENDER
      ? { executable: process.env.MOONMOLD_BLENDER, source: "MOONMOLD_BLENDER" }
      : null,
    workspace
      ? {
          executable: workspace.executable,
          source: "workspace-tool-manifest",
          manifest: workspace.manifest,
        }
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const { executable } = candidate;
    try {
      accessSync(executable, constants.X_OK);
      const output = execFileSync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return {
        available: true,
        executable,
        source: candidate.source,
        version: output.split("\n")[0],
        executionMode: "fixed-semantic-bridge-only",
        workspaceManifest: candidate.manifest ?? null,
      };
    } catch {
      // Discovery continues without broadening the executable search path.
    }
  }
  return {
    available: false,
    executable: null,
    source: null,
    version: null,
    executionMode: "mock-reference-runtime",
  };
}
