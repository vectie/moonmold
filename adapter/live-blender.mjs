import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverBlender } from "./blender.mjs";
import { validateBuildingPlan, verifyReferenceInputs } from "./experiment.mjs";
import {
  AdapterRejection,
  canonicalJson,
  digest,
  resolveScopedPath,
} from "./protocol.mjs";

const ROOT = "/Users/kq/moonsuite";
const BRIDGE = fileURLToPath(new URL("./blender_bridge.py", import.meta.url));

async function hashFile(file) {
  const bytes = await readFile(file);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function validateOutput(file, kind) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 64) {
    throw new AdapterRejection("invalid-blender-output", `${kind} output is missing or empty`);
  }
  const prefix = await readFile(file).then((bytes) => bytes.subarray(0, 16));
  if (kind === "blend" && prefix.subarray(0, 7).toString() !== "BLENDER") {
    throw new AdapterRejection("invalid-blender-output", "blend signature is invalid");
  }
  if (kind === "glb" && prefix.subarray(0, 4).toString() !== "glTF") {
    throw new AdapterRejection("invalid-blender-output", "GLB signature is invalid");
  }
  if (kind === "png" && prefix.subarray(1, 4).toString() !== "PNG") {
    throw new AdapterRejection("invalid-blender-output", "PNG signature is invalid");
  }
  return { size: info.size, digest: await hashFile(file) };
}

function runBounded(executable, args, { timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-100_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-100_000);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code, childSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new AdapterRejection("cancelled", "Blender execution was cancelled"));
      } else if (timedOut) {
        reject(new AdapterRejection("deadline-exceeded", "Blender execution exceeded its deadline"));
      } else if (code !== 0) {
        reject(new AdapterRejection("blender-failed", "fixed Blender bridge failed", {
          code,
          signal: childSignal,
          stderr: stderr.slice(-4_000),
        }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function validateEvidence(outputRoot, plan, inputDigest) {
  const bridgeManifestPath = path.join(outputRoot, "bridge-manifest.json");
  const manifest = JSON.parse(await readFile(bridgeManifestPath, "utf8"));
  if (
    manifest.schema !== "moonmold-live-blender-bridge-v1" ||
    manifest.planId !== plan.id ||
    manifest.objectCount !== plan.components.length ||
    manifest.physicalEffects !== false
  ) {
    throw new AdapterRejection("invalid-blender-evidence", "bridge manifest does not match input");
  }
  const outputs = {};
  for (const [name, kind] of [
    ["model.blend", "blend"],
    ["model.glb", "glb"],
    ["model.stl", "stl"],
    ["render.png", "png"],
  ]) {
    outputs[name] = await validateOutput(path.join(outputRoot, name), kind);
  }
  outputs["bridge-manifest.json"] = await validateOutput(bridgeManifestPath, "json");
  return {
    schema: "moonmold-live-blender-evidence-v1",
    evidenceClass: "live-blender",
    accepted: true,
    outcome: "applied",
    planId: plan.id,
    inputDigest,
    objectCount: manifest.objectCount,
    boundsMeters: manifest.boundsMeters,
    outputs,
    physicalEffects: false,
  };
}

export async function runLiveBlenderExperiment({
  inputPath,
  outputRoot,
  timeoutMs = 120_000,
  signal,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new AdapterRejection("invalid-deadline", "live Blender deadline must be 1..300000ms");
  }
  const resolvedOutput = resolveScopedPath(ROOT, outputRoot);
  const plan = validateBuildingPlan(JSON.parse(await readFile(inputPath, "utf8")));
  const verifiedReferences = await verifyReferenceInputs(plan);
  const inputDigest = digest(plan);
  const evidencePath = path.join(resolvedOutput, "live-evidence.json");
  try {
    const existing = JSON.parse(await readFile(evidencePath, "utf8"));
    if (existing.inputDigest !== inputDigest || existing.planId !== plan.id) {
      throw new AdapterRejection(
        "immutable-live-evidence-conflict",
        "live evidence output belongs to another input",
      );
    }
    const validated = await validateEvidence(resolvedOutput, plan, inputDigest);
    return { ...existing, ...validated, outcome: "idempotent-no-op" };
  } catch (error) {
    if (error instanceof AdapterRejection) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const blender = discoverBlender();
  if (!blender.available) {
    throw new AdapterRejection("backend-unavailable", "workspace Blender runtime is unavailable");
  }
  await mkdir(resolvedOutput, { recursive: true });
  const planPath = path.join(resolvedOutput, "input-plan.json");
  const planBytes = `${canonicalJson(plan)}\n`;
  await writeFile(planPath, planBytes, { encoding: "utf8", flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(planPath, "utf8") !== planBytes) {
      throw new AdapterRejection("immutable-live-input-conflict", "existing live input differs");
    }
  });
  await runBounded(
    blender.executable,
    [
      "--background",
      "--factory-startup",
      "--python",
      BRIDGE,
      "--",
      "--input",
      planPath,
      "--output",
      resolvedOutput,
    ],
    { timeoutMs, signal },
  );
  const evidence = await validateEvidence(resolvedOutput, plan, inputDigest);
  const complete = {
    ...evidence,
    blender: {
      version: blender.version,
      source: blender.source,
      executable: blender.executable,
      workspaceManifest: blender.workspaceManifest,
    },
    bridgeDigest: await hashFile(BRIDGE),
    authority: "workspace-digital-modeling-only",
    unrestrictedScripts: false,
    verifiedReferences,
  };
  await writeFile(evidencePath, `${canonicalJson(complete)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return complete;
}
