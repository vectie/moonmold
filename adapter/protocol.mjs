import { createHash } from "node:crypto";
import path from "node:path";

export const PROTOCOL_VERSION = "moonmold.blender.v1";
export const MOONSUITE_ROOT = "/Users/kq/moonsuite";
export const ALLOWED_AUTHORITIES = new Set([
  "observe",
  "cognitive-maintenance",
  "sandbox-execution",
  "workspace-mutation",
]);
export const METHODS = new Set([
  "capability.discover",
  "scene.create-model",
  "scene.create-box",
  "scene.create-cylinder",
  "scene.set-transform",
  "scene.assign-material",
  "scene.boolean-subtract",
  "scene.validate",
  "representation.export",
]);

// Match snake_case, kebab-case, and camelCase spellings. Restricting only
// token boundaries let `pythonScript` bypass the first trial.
const FORBIDDEN_PARAMETER_NAMES =
  /(script|python|shell|eval|expression|command|code)/i;

export class AdapterRejection extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AdapterRejection";
    this.code = code;
    this.details = details;
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new AdapterRejection("invalid-identity", `${field} is missing or malformed`, { field });
  }
}

function inspectParameterNames(value, trail = []) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectParameterNames(item, [...trail, index]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PARAMETER_NAMES.test(key)) {
      throw new AdapterRejection(
        "unrestricted-script-surface",
        `parameter ${[...trail, key].join(".")} is forbidden`,
      );
    }
    inspectParameterNames(child, [...trail, key]);
  }
}

export function assertWorkspaceRoot(root) {
  if (
    typeof root !== "string" ||
    (root !== MOONSUITE_ROOT && !root.startsWith(`${MOONSUITE_ROOT}${path.sep}`))
  ) {
    throw new AdapterRejection("workspace-boundary", "workspace root is outside ~/moonsuite", { root });
  }
  return path.resolve(root);
}

export function resolveScopedPath(root, candidate) {
  const resolvedRoot = assertWorkspaceRoot(root);
  if (typeof candidate !== "string" || candidate.includes("\0")) {
    throw new AdapterRejection("workspace-boundary", "output path is malformed");
  }
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new AdapterRejection("workspace-boundary", "output path escapes the declared workspace", {
      root: resolvedRoot,
      candidate,
    });
  }
  return resolved;
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new AdapterRejection("invalid-request", "request envelope must be an object");
  }
  for (const field of [
    "projectId",
    "sessionId",
    "modelId",
    "requestId",
    "idempotencyKey",
  ]) {
    assertIdentifier(envelope[field], field);
  }
  if (typeof envelope.expectedParentDigest !== "string" || !envelope.expectedParentDigest) {
    throw new AdapterRejection("invalid-parent", "expectedParentDigest is required");
  }
  assertWorkspaceRoot(envelope.workspaceRoot);
  if (
    !Number.isSafeInteger(envelope.deadlineMs) ||
    envelope.deadlineMs <= 0 ||
    envelope.deadlineMs > 120_000
  ) {
    throw new AdapterRejection("invalid-deadline", "deadlineMs must be between 1 and 120000");
  }
  if (!ALLOWED_AUTHORITIES.has(envelope.authority)) {
    throw new AdapterRejection(
      "authority-exceeded",
      "MoonMold does not accept external or physical authority",
      { authority: envelope.authority },
    );
  }
  if (!METHODS.has(envelope.method)) {
    throw new AdapterRejection("unsupported-method", "operation is not in the semantic allowlist", {
      method: envelope.method,
    });
  }
  if (!envelope.params || typeof envelope.params !== "object" || Array.isArray(envelope.params)) {
    throw new AdapterRejection("invalid-parameters", "params must be an object");
  }
  inspectParameterNames(envelope.params);
  validateMethodParameters(envelope.method, envelope.params, envelope.workspaceRoot);
  return structuredClone(envelope);
}

function positive(value, field) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AdapterRejection("invalid-geometry", `${field} must be positive`, { field, value });
  }
}

function objectId(value, field = "objectId") {
  assertIdentifier(value, field);
}

function assertExactKeys(params, allowed) {
  const extras = Object.keys(params).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new AdapterRejection(
      "unexpected-parameter",
      "semantic operations reject undeclared parameters",
      { extras: extras.sort() },
    );
  }
}

export function validateMethodParameters(method, params, root) {
  switch (method) {
    case "capability.discover":
    case "scene.validate":
      assertExactKeys(params, []);
      break;
    case "scene.create-model":
      assertExactKeys(params, ["name", "units", "coordinateFrame"]);
      assertIdentifier(params.name, "name");
      if (!["mm", "cm", "m"].includes(params.units)) {
        throw new AdapterRejection("missing-scale", "units must be mm, cm, or m");
      }
      if (!["z-up-right-handed", "y-up-right-handed"].includes(params.coordinateFrame)) {
        throw new AdapterRejection("invalid-coordinate-frame", "coordinateFrame is unsupported");
      }
      break;
    case "scene.create-box":
      assertExactKeys(params, ["objectId", "widthMm", "depthMm", "heightMm"]);
      objectId(params.objectId);
      positive(params.widthMm, "widthMm");
      positive(params.depthMm, "depthMm");
      positive(params.heightMm, "heightMm");
      break;
    case "scene.create-cylinder":
      assertExactKeys(params, ["objectId", "radiusMm", "heightMm", "sides"]);
      objectId(params.objectId);
      positive(params.radiusMm, "radiusMm");
      positive(params.heightMm, "heightMm");
      if (!Number.isSafeInteger(params.sides) || params.sides < 8 || params.sides > 256) {
        throw new AdapterRejection("invalid-geometry", "sides must be an integer from 8 through 256");
      }
      break;
    case "scene.set-transform":
      assertExactKeys(params, ["objectId", "xMm", "yMm", "zMm"]);
      objectId(params.objectId);
      for (const field of ["xMm", "yMm", "zMm"]) {
        if (!Number.isFinite(params[field])) {
          throw new AdapterRejection("invalid-transform", `${field} must be finite`);
        }
      }
      break;
    case "scene.assign-material":
      assertExactKeys(params, ["objectId", "materialId"]);
      objectId(params.objectId);
      assertIdentifier(params.materialId, "materialId");
      break;
    case "scene.boolean-subtract":
      assertExactKeys(params, ["targetId", "cutterId"]);
      objectId(params.targetId, "targetId");
      objectId(params.cutterId, "cutterId");
      if (params.targetId === params.cutterId) {
        throw new AdapterRejection("invalid-geometry", "boolean operands must be distinct");
      }
      break;
    case "representation.export":
      assertExactKeys(params, ["representation", "outputPath"]);
      if (!["editable-source", "engineering", "presentation", "simulation", "manufacturing-candidate"].includes(params.representation)) {
        throw new AdapterRejection("invalid-representation", "representation is unsupported");
      }
      resolveScopedPath(root, params.outputPath);
      break;
    default:
      throw new AdapterRejection("unsupported-method", "operation is not in the semantic allowlist");
  }
}

export function requestFingerprint(envelope) {
  return digest({
    protocol: PROTOCOL_VERSION,
    projectId: envelope.projectId,
    sessionId: envelope.sessionId,
    modelId: envelope.modelId,
    expectedParentDigest: envelope.expectedParentDigest,
    workspaceRoot: envelope.workspaceRoot,
    method: envelope.method,
    params: envelope.params,
    authority: envelope.authority,
  });
}
