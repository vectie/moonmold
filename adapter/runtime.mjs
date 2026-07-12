import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AdapterRejection,
  PROTOCOL_VERSION,
  canonicalJson,
  digest,
  requestFingerprint,
  resolveScopedPath,
  validateEnvelope,
} from "./protocol.mjs";
import { discoverBlender } from "./blender.mjs";

function cloneReceipt(receipt, requestId, outcome = receipt.outcome) {
  return structuredClone({ ...receipt, requestId, outcome });
}

function representationPolicy(representation, sceneDigest, exports) {
  const engineering = exports.get("engineering");
  switch (representation) {
    case "editable-source":
      return {
        parentDigest: sceneDigest,
        lineageRelation: "modeled-from",
        knownLosses: [],
        claimCeiling: "editable-digital-source"
      };
    case "engineering":
      return {
        parentDigest: sceneDigest,
        lineageRelation: "modeled-from",
        knownLosses: [],
        claimCeiling: "digital-engineering-candidate"
      };
    case "presentation":
      if (!engineering) {
        throw new AdapterRejection("missing-engineering-parent", "presentation export requires engineering parent");
      }
      return {
        parentDigest: engineering,
        lineageRelation: "styled-from",
        knownLosses: ["engineering material fidelity", "collision fidelity"],
        claimCeiling: "presentation-only"
      };
    case "simulation":
      if (!engineering) {
        throw new AdapterRejection("missing-engineering-parent", "simulation export requires engineering parent");
      }
      return {
        parentDigest: engineering,
        lineageRelation: "physics-derived-from",
        knownLosses: ["measured mass properties absent", "environment calibration absent"],
        claimCeiling: "simulation-input-candidate"
      };
    case "manufacturing-candidate":
      if (!engineering) {
        throw new AdapterRejection("missing-engineering-parent", "manufacturing export requires engineering parent");
      }
      return {
        parentDigest: engineering,
        lineageRelation: "manufacturing-derived-from",
        knownLosses: [
          "watertightness not independently measured",
          "fabrication tolerance unqualified",
          "material and process assumptions unresolved"
        ],
        claimCeiling: "analysis-only-no-machine-authority"
      };
    default:
      throw new AdapterRejection("invalid-representation", "representation policy is absent");
  }
}

async function assertNoSymlinkAncestors(root, outputPath) {
  const relative = path.relative(root, outputPath);
  let cursor = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) {
        throw new AdapterRejection(
          "workspace-boundary",
          "output path contains a symbolic-link ancestor",
          { cursor },
        );
      }
    } catch (error) {
      if (error instanceof AdapterRejection) throw error;
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
}

export class SemanticAdapterRuntime {
  constructor({ backend = "mock", initialDigest = digest({ scene: "empty" }) } = {}) {
    this.backend = backend;
    this.sceneDigest = initialDigest;
    this.model = null;
    this.objects = new Map();
    this.exports = new Map();
    this.completed = new Map();
  }

  capabilities() {
    const blender = discoverBlender();
    return {
      protocol: PROTOCOL_VERSION,
      backend: this.backend,
      semanticOperations: [
        "scene.create-model",
        "scene.create-box",
        "scene.create-cylinder",
        "scene.set-transform",
        "scene.assign-material",
        "scene.boolean-subtract",
        "scene.validate",
        "representation.export",
      ],
      unrestrictedScripts: false,
      physicalControl: false,
      blender,
    };
  }

  async execute(untrustedEnvelope) {
    if (this.backend !== "mock") {
      throw new AdapterRejection(
        "backend-unavailable",
        "live Blender execution requires the separately installed fixed semantic bridge",
        { requestedBackend: this.backend, blender: discoverBlender() },
      );
    }
    const envelope = validateEnvelope(untrustedEnvelope);
    const fingerprint = requestFingerprint(envelope);
    const prior = this.completed.get(envelope.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new AdapterRejection(
          "conflicting-idempotency-key",
          "idempotency key was already used for different semantic work",
        );
      }
      return cloneReceipt(prior.receipt, envelope.requestId, "idempotent-no-op");
    }
    if (envelope.expectedParentDigest !== this.sceneDigest) {
      throw new AdapterRejection("stale-parent", "expected parent does not match current scene", {
        expected: envelope.expectedParentDigest,
        actual: this.sceneDigest,
      });
    }
    const beforeDigest = this.sceneDigest;
    const result = await this.#apply(envelope);
    const mutatesScene = ![
      "capability.discover",
      "scene.validate",
      "representation.export",
    ].includes(envelope.method);
    const afterDigest = mutatesScene
      ? digest({
          parent: beforeDigest,
          request: fingerprint,
          scene: this.#sceneManifest(),
        })
      : beforeDigest;
    this.sceneDigest = afterDigest;
    const validation = this.#validateScene(afterDigest);
    const receipt = {
      protocol: PROTOCOL_VERSION,
      requestId: envelope.requestId,
      idempotencyKey: envelope.idempotencyKey,
      outcome: "applied",
      beforeDigest,
      afterDigest,
      changedObjects: result.changedObjects,
      warnings: result.warnings,
      outputHashes: result.outputHashes,
      result: result.result,
      validation,
      durationClass: "bounded",
      recoveryLineage: [],
    };
    this.completed.set(envelope.idempotencyKey, { fingerprint, receipt: structuredClone(receipt) });
    return receipt;
  }

  #sceneManifest() {
    return {
      model: this.model,
      objects: [...this.objects.values()].sort((a, b) => a.objectId.localeCompare(b.objectId)),
    };
  }

  #validateScene(subjectDigest = this.sceneDigest) {
    const findings = [];
    if (!this.model) {
      findings.push({
        code: "missing-model-metadata",
        severity: "error",
        message: "model units and coordinate frame are absent",
      });
    }
    if (this.objects.size === 0) {
      findings.push({
        code: "empty-scene",
        severity: "warning",
        message: "scene has no spatial objects",
      });
    }
    for (const object of this.objects.values()) {
      if (!object.materialId) {
        findings.push({
          code: "unknown-material",
          severity: "warning",
          objectId: object.objectId,
          message: "material remains an explicit unknown",
        });
      }
    }
    return {
      validator: "moonmold-semantic-validator",
      validatorVersion: "1",
      subjectDigest,
      accepted: !findings.some((finding) => finding.severity === "error"),
      findings,
    };
  }

  async #apply(envelope) {
    const { method, params } = envelope;
    const changedObjects = [];
    const warnings = [];
    const outputHashes = [];
    let result = null;
    switch (method) {
      case "capability.discover":
        warnings.push("capability discovery does not mutate geometry");
        result = this.capabilities();
        break;
      case "scene.create-model":
        if (this.model) {
          throw new AdapterRejection("model-already-exists", "create-model cannot overwrite an existing model");
        }
        this.model = {
          name: params.name,
          units: params.units,
          coordinateFrame: params.coordinateFrame,
        };
        break;
      case "scene.create-box":
      case "scene.create-cylinder": {
        if (!this.model) throw new AdapterRejection("missing-model", "create-model must run first");
        if (this.objects.has(params.objectId)) {
          throw new AdapterRejection("duplicate-object", "object identity already exists", {
            objectId: params.objectId,
          });
        }
        const object = {
          ...structuredClone(params),
          kind: method === "scene.create-box" ? "box" : "cylinder",
          transform: { xMm: 0, yMm: 0, zMm: 0 },
          materialId: null,
          booleanCuts: [],
        };
        this.objects.set(params.objectId, object);
        changedObjects.push(params.objectId);
        break;
      }
      case "scene.set-transform": {
        const object = this.#requireObject(params.objectId);
        object.transform = { xMm: params.xMm, yMm: params.yMm, zMm: params.zMm };
        changedObjects.push(params.objectId);
        break;
      }
      case "scene.assign-material": {
        const object = this.#requireObject(params.objectId);
        object.materialId = params.materialId;
        changedObjects.push(params.objectId);
        break;
      }
      case "scene.boolean-subtract": {
        const target = this.#requireObject(params.targetId);
        this.#requireObject(params.cutterId);
        target.booleanCuts.push(params.cutterId);
        changedObjects.push(params.targetId, params.cutterId);
        break;
      }
      case "scene.validate":
        break;
      case "representation.export": {
        if (!this.model) throw new AdapterRejection("missing-model", "cannot export before create-model");
        const outputPath = resolveScopedPath(envelope.workspaceRoot, params.outputPath);
        const policy = representationPolicy(
          params.representation,
          this.sceneDigest,
          this.exports,
        );
        const artifact = {
          schema: "moonmold-spatial-artifact-v1",
          artifactId: `${envelope.modelId}:${params.representation}`,
          representation: params.representation,
          sceneDigest: this.sceneDigest,
          ...policy,
          units: this.model.units,
          coordinateFrame: this.model.coordinateFrame,
          objects: this.#sceneManifest().objects,
          backend: this.backend,
          physicalAuthority: false,
        };
        await assertNoSymlinkAncestors(envelope.workspaceRoot, outputPath);
        await mkdir(path.dirname(outputPath), { recursive: true });
        const resolvedParent = await realpath(path.dirname(outputPath));
        if (!resolvedParent.startsWith(`${path.resolve(envelope.workspaceRoot)}${path.sep}`)) {
          throw new AdapterRejection("workspace-boundary", "resolved output parent escapes workspace");
        }
        const bytes = `${canonicalJson(artifact)}\n`;
        await writeFile(outputPath, bytes, { encoding: "utf8", flag: "wx" }).catch((error) => {
          if (error.code === "EEXIST") {
            throw new AdapterRejection("immutable-output-exists", "export refuses to overwrite an artifact");
          }
          throw error;
        });
        const artifactDigest = digest(artifact);
        outputHashes.push({
          uri: `moonsuite://${path.relative(envelope.workspaceRoot, outputPath)}`,
          digest: artifactDigest,
        });
        this.exports.set(params.representation, artifactDigest);
        break;
      }
      default:
        throw new AdapterRejection("unsupported-method", "semantic operation is not implemented");
    }
    return { changedObjects, warnings, outputHashes, result };
  }

  #requireObject(objectId) {
    const object = this.objects.get(objectId);
    if (!object) {
      throw new AdapterRejection("unknown-object", "operation references an unknown object", { objectId });
    }
    return object;
  }
}
