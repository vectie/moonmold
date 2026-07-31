import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverBlender } from "./blender.mjs";
import {
  AdapterRejection,
  assertWorkspaceRoot,
  canonicalJson,
  digest,
  validateEnvelope,
} from "./protocol.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTER_ID = "moonmold-pack-local-v1";
const MAX_BODY = 512 * 1024;

function safeIdentity(value, field) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new AdapterRejection("invalid-identity", `${field} is malformed`);
  }
  return value;
}

function safeRef(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("://") ||
    path.isAbsolute(value) ||
    value.replaceAll("\\", "/").split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new AdapterRejection(
      "workspace-boundary",
      "operator references must be workspace-relative without traversal or URL syntax",
    );
  }
  return value;
}

function resolveRef(workspaceRoot, reference) {
  const resolved = path.resolve(workspaceRoot, safeRef(reference));
  if (!resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new AdapterRejection("workspace-boundary", "operator reference escapes workspace");
  }
  return resolved;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdapterRejection("invalid-request", `${label} must be an object`);
  }
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new AdapterRejection("unexpected-field", `${label} contains undeclared fields`, {
      extras: extras.sort(),
    });
  }
}

function semanticEnvelope(workspaceRoot, spatial) {
  exactKeys(spatial, [
    "contract_id",
    "request_id",
    "idempotency_key",
    "project_id",
    "model_id",
    "expected_parent_digest",
    "authority",
    "operation",
    "intent",
    "reference_artifacts",
    "constraints",
    "backend_preference",
  ], "spatial request");
  if (spatial.contract_id !== "moonmold.spatial-operation-request.v1") {
    throw new AdapterRejection("invalid-contract", "unsupported spatial request contract");
  }
  exactKeys(spatial.operation, ["method", "params"], "semantic operation");
  const authority = {
    Observe: "observe",
    CognitiveMaintenance: "cognitive-maintenance",
    SandboxExecution: "sandbox-execution",
    WorkspaceMutation: "workspace-mutation",
  }[spatial.authority];
  if (!authority) throw new AdapterRejection("authority-exceeded", "unsupported spatial authority");
  if (!Array.isArray(spatial.reference_artifacts ?? [])) {
    throw new AdapterRejection("invalid-reference-set", "reference_artifacts must be an array");
  }
  for (const reference of spatial.reference_artifacts ?? []) safeRef(reference);
  const params = structuredClone(spatial.operation.params);
  if (spatial.operation.method === "representation.export") {
    const [reference, outputPath] = outputReference(workspaceRoot, params.outputPath);
    params.outputPath = outputPath;
    void reference;
  }
  return validateEnvelope({
    projectId: safeIdentity(spatial.project_id, "project_id"),
    sessionId: "moonmold-operator",
    modelId: safeIdentity(spatial.model_id, "model_id"),
    requestId: safeIdentity(spatial.request_id, "request_id"),
    idempotencyKey: safeIdentity(spatial.idempotency_key, "idempotency_key"),
    expectedParentDigest: spatial.expected_parent_digest,
    workspaceRoot,
    deadlineMs: 120_000,
    authority,
    method: spatial.operation.method,
    params,
  });
}

function outputReference(workspaceRoot, value) {
  if (typeof value !== "string") {
    throw new AdapterRejection("workspace-boundary", "outputPath is required");
  }
  if (path.isAbsolute(value)) {
    const resolved = path.resolve(value);
    if (!resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new AdapterRejection("workspace-boundary", "outputPath escapes workspace");
    }
    return [path.relative(workspaceRoot, resolved), resolved];
  }
  const reference = safeRef(value);
  return [reference, resolveRef(workspaceRoot, reference)];
}

function operationPolicy(mode) {
  if (mode === "validate") {
    return {
      operation: "spatial.operation.validate",
      authority: "sandbox-execution",
      requiredClaim: "observation",
    };
  }
  if (mode === "execute") {
    return {
      operation: "spatial.operation.execute",
      authority: "workspace-mutation",
      requiredClaim: "digital-artifact",
    };
  }
  throw new AdapterRejection("invalid-operation", "mode must be validate or execute");
}

function genericRequest(spatial, mode, inputRef) {
  const policy = operationPolicy(mode);
  const suffix = mode === "execute" ? "exec" : "validation";
  return {
    request_id: `flow-${spatial.request_id}-${suffix}`,
    run_id: `operator-${spatial.project_id}`,
    book_id: `moonmold-${spatial.project_id}`,
    work_item_id: `${spatial.model_id}-${suffix}`,
    declaration_id: `${ADAPTER_ID}/${policy.operation}`,
    attempt_id: `attempt-${spatial.request_id}-${suffix}`,
    idempotency_key: `${spatial.idempotency_key}/${suffix}`,
    product_id: "moonmold",
    operation: policy.operation,
    requested_authority: policy.authority,
    acceptance_criteria: [
      "physical_authority=false",
      "representation lineage and declared losses remain inspectable",
    ],
    input_contracts: ["moonmold/spatial-operation-request@1.0.0"],
    output_contracts: ["moonmold/spatial-operation-receipt@1.0.0"],
    required_claim: policy.requiredClaim,
    input_digest: digest(spatial),
    input_artifacts: [inputRef],
    timeout_ms: 120_000,
    created_at: new Date().toISOString(),
  };
}

async function immutableJson(target, value) {
  const bytes = `${canonicalJson(value)}\n`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || await readFile(target, "utf8") !== bytes) {
      throw new AdapterRejection("immutable-output-conflict", "durable operator evidence conflicts");
    }
  }
}

async function replaceableJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runAdapter(command, workspaceRoot, requestPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "moon",
      ["run", "cmd/moonflow_adapter", "--", command, workspaceRoot, requestPath],
      { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      let payload;
      try {
        payload = JSON.parse(stdout);
      } catch {
        reject(new AdapterRejection(
          "adapter-process-failed",
          "MoonBit adapter returned an invalid response",
          { code, stderr: stderr.slice(0, 1200) },
        ));
        return;
      }
      if (code !== 0) {
        reject(new AdapterRejection(
          payload.error?.code ?? "adapter-process-failed",
          payload.error?.message ?? "MoonBit adapter failed",
          { code, path: payload.error?.path ?? "", stderr: stderr.slice(0, 1200) },
        ));
        return;
      }
      resolve(payload);
    });
  });
}

async function readJsonIfPresent(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function collectProject(workspaceRoot, spatial, flowRequest) {
  const attemptRoot = resolveRef(
    workspaceRoot,
    `.moonsuite/products/moonmold/adapter-attempts/${flowRequest.attempt_id}`,
  );
  const receipt = await readJsonIfPresent(path.join(attemptRoot, "operation-receipt.json"));
  const representations = [];
  const representationRoot = resolveRef(
    workspaceRoot,
    `.moonsuite/products/moonmold/projects/${safeIdentity(spatial.project_id, "project_id")}/${safeIdentity(spatial.model_id, "model_id")}/representations`,
  );
  try {
    for (const name of (await readdir(representationRoot)).sort()) {
      if (!/^[a-z0-9-]+\.json$/.test(name)) continue;
      const artifact = await readJsonIfPresent(path.join(representationRoot, name));
      if (artifact?.contract_id === "moonmold.spatial-artifact.v1") {
        representations.push(artifact);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const output = spatial.operation?.params?.outputPath;
  if (spatial.operation?.method === "representation.export" && typeof output === "string") {
    const [, outputPath] = outputReference(workspaceRoot, output);
    const artifact = await readJsonIfPresent(outputPath);
    if (
      artifact &&
      !representations.some((candidate) => candidate.digest === artifact.digest)
    ) {
      representations.push(artifact);
    }
  }
  const reviewRoot = resolveRef(workspaceRoot, ".moonsuite/products/moonmold/reviews");
  const reviews = [];
  try {
    for (const name of await readdir(reviewRoot)) {
      if (name.startsWith(`${flowRequest.attempt_id}-`) && name.endsWith(".json")) {
        reviews.push(JSON.parse(await readFile(path.join(reviewRoot, name), "utf8")));
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { receipt, representations, reviews };
}

async function runSpatial(workspaceRoot, body) {
  exactKeys(body, ["mode", "request"], "operator run");
  const spatial = structuredClone(body.request);
  semanticEnvelope(workspaceRoot, spatial);
  if (body.mode === "execute" && spatial.authority !== "WorkspaceMutation") {
    throw new AdapterRejection(
      "authority-mismatch",
      "execute requires WorkspaceMutation in the governed spatial request",
    );
  }
  if (body.mode === "validate") {
    // Validation observes a proposed request and does not lower its requested authority.
  }
  const inputRef = `.moonsuite/products/moonmold/operator-inputs/${safeIdentity(spatial.request_id, "request_id")}.json`;
  let flow = genericRequest(spatial, body.mode, inputRef);
  const flowRef = `.moonsuite/products/moonmold/operator-requests/${flow.attempt_id}.json`;
  const flowPath = resolveRef(workspaceRoot, flowRef);
  const existingFlow = await readJsonIfPresent(flowPath);
  if (existingFlow) {
    const replayCandidate = { ...flow, created_at: existingFlow.created_at };
    if (canonicalJson(existingFlow) !== canonicalJson(replayCandidate)) {
      throw new AdapterRejection(
        "immutable-output-conflict",
        "the durable MoonFlow request identity is already bound to different input",
      );
    }
    flow = existingFlow;
  }
  await replaceableJson(resolveRef(workspaceRoot, inputRef), spatial);
  await immutableJson(flowPath, flow);
  const result = await runAdapter("invoke", workspaceRoot, resolveRef(workspaceRoot, flowRef));
  return {
    contract_id: "moonmold.operator-run.v1",
    request: spatial,
    flow_request: flow,
    flow_request_ref: flowRef,
    result,
    ...await collectProject(workspaceRoot, spatial, flow),
  };
}

async function reconcileSpatial(workspaceRoot, body) {
  exactKeys(body, ["flow_request", "request"], "operator reconciliation");
  const flow = body.flow_request;
  const spatial = body.request;
  semanticEnvelope(workspaceRoot, spatial);
  const flowRef = `.moonsuite/products/moonmold/operator-requests/${safeIdentity(flow.attempt_id, "attempt_id")}.json`;
  await immutableJson(resolveRef(workspaceRoot, flowRef), flow);
  const report = await runAdapter(
    "reconcile-report",
    workspaceRoot,
    resolveRef(workspaceRoot, flowRef),
  );
  return {
    contract_id: "moonmold.operator-reconciliation.v1",
    request: spatial,
    flow_request: flow,
    reconciliation: report,
    result: report.result,
    ...await collectProject(workspaceRoot, spatial, flow),
  };
}

async function saveSpatial(workspaceRoot, body) {
  exactKeys(body, ["request"], "operator save");
  const spatial = structuredClone(body.request);
  semanticEnvelope(workspaceRoot, spatial);
  const reference = `.moonsuite/products/moonmold/requests/${safeIdentity(spatial.request_id, "request_id")}.json`;
  await replaceableJson(resolveRef(workspaceRoot, reference), spatial);
  return { contract_id: "moonmold.operator-request-save.v1", reference, request: spatial };
}

async function loadSpatial(workspaceRoot, body) {
  exactKeys(body, ["reference"], "operator load");
  const reference = safeRef(body.reference);
  const request = JSON.parse(await readFile(resolveRef(workspaceRoot, reference), "utf8"));
  semanticEnvelope(workspaceRoot, request);
  return { contract_id: "moonmold.operator-request-load.v1", reference, request };
}

async function recordReview(workspaceRoot, body) {
  exactKeys(body, ["attempt_id", "reviewer", "decision", "notes"], "named review");
  const attemptId = safeIdentity(body.attempt_id, "attempt_id");
  if (typeof body.reviewer !== "string" || body.reviewer.trim().length < 2) {
    throw new AdapterRejection("named-review-required", "a named human reviewer is required");
  }
  if (body.reviewer.trim().toLowerCase().includes("moonmold")) {
    throw new AdapterRejection("self-review-forbidden", "MoonMold cannot name itself as reviewer");
  }
  if (!["approve", "request-changes", "reject"].includes(body.decision)) {
    throw new AdapterRejection("invalid-review-decision", "review decision is unsupported");
  }
  const receiptRef = `.moonsuite/products/moonmold/adapter-attempts/${attemptId}/operation-receipt.json`;
  const receiptPath = resolveRef(workspaceRoot, receiptRef);
  await access(receiptPath);
  const review = {
    contract_id: "moonmold.named-review.v1",
    attempt_id: attemptId,
    reviewer: body.reviewer.trim(),
    decision: body.decision,
    notes: typeof body.notes === "string" ? body.notes : "",
    receipt_ref: receiptRef,
    receipt_digest: `sha256:${createHash("sha256").update(await readFile(receiptPath)).digest("hex")}`,
    reviewed_at: new Date().toISOString(),
    self_approved: false,
    physical_authority: false,
  };
  const identity = createHash("sha256").update(canonicalJson(review)).digest("hex").slice(0, 16);
  const reference = `.moonsuite/products/moonmold/reviews/${attemptId}-${identity}.json`;
  await immutableJson(resolveRef(workspaceRoot, reference), review);
  return { reference, review };
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AdapterRejection("request-too-large", "request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(bytes),
    "Cache-Control": "no-store",
  });
  response.end(bytes);
}

function contentType(target) {
  if (target.endsWith(".html")) return "text/html; charset=utf-8";
  if (target.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (target.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function serveStatic(response, uiRoot, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  safeRef(relative);
  let target = path.resolve(uiRoot, relative);
  if (!target.startsWith(`${uiRoot}${path.sep}`)) return false;
  try {
    if (!(await stat(target)).isFile()) return false;
  } catch {
    target = path.join(uiRoot, "index.html");
  }
  const info = await stat(target);
  response.writeHead(200, {
    "Content-Type": contentType(target),
    "Content-Length": info.size,
  });
  createReadStream(target).pipe(response);
  return true;
}

export function createOperatorServer({
  workspaceRoot,
  uiRoot = path.join(REPO, "ui/rabbita-moonmold/dist"),
} = {}) {
  const workspace = assertWorkspaceRoot(path.resolve(workspaceRoot));
  const builtUi = path.resolve(uiRoot);
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, {
          contract_id: "moonmold.operator-status.v1",
          workspace_root: workspace,
          adapter_id: ADAPTER_ID,
          protocol: "moonflow.adapter.v2",
          mock_reference: {
            available: true,
            evidence_class: "fixture-reference-only",
            production_qualified: false,
          },
          blender: discoverBlender(workspace),
          physical_authority: false,
        });
      } else if (request.method === "POST" && url.pathname === "/api/request/save") {
        sendJson(response, 200, await saveSpatial(workspace, await bodyJson(request)));
      } else if (request.method === "POST" && url.pathname === "/api/request/load") {
        sendJson(response, 200, await loadSpatial(workspace, await bodyJson(request)));
      } else if (request.method === "POST" && url.pathname === "/api/run") {
        sendJson(response, 200, await runSpatial(workspace, await bodyJson(request)));
      } else if (request.method === "POST" && url.pathname === "/api/reconcile") {
        sendJson(response, 200, await reconcileSpatial(workspace, await bodyJson(request)));
      } else if (request.method === "POST" && url.pathname === "/api/review") {
        sendJson(response, 200, await recordReview(workspace, await bodyJson(request)));
      } else if (request.method === "GET") {
        if (!await serveStatic(response, builtUi, url.pathname)) {
          sendJson(response, 404, { error: "not-found" });
        }
      } else {
        sendJson(response, 404, { error: "not-found" });
      }
    } catch (error) {
      const rejection = error instanceof AdapterRejection
        ? error
        : new AdapterRejection("operator-error", error.message);
      sendJson(response, 400, {
        contract_id: "moonmold.operator-error.v1",
        code: rejection.code,
        message: rejection.message,
        details: rejection.details,
      });
    }
  });
}
