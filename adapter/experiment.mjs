import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { SemanticAdapterRuntime } from "./runtime.mjs";
import { AdapterRejection, canonicalJson, digest, resolveScopedPath } from "./protocol.mjs";

export function validateBuildingPlan(plan) {
  if (plan?.schema !== "moonmold-building-plan-v1") {
    throw new AdapterRejection("invalid-plan", "building plan schema is missing");
  }
  if (!plan.scaleEvidence || typeof plan.scaleEvidence.source !== "string") {
    throw new AdapterRejection("missing-scale-evidence", "scale evidence is required");
  }
  if (!Array.isArray(plan.unknowns)) {
    throw new AdapterRejection("implicit-unknowns", "unknowns must be explicitly listed");
  }
  if (
    typeof plan.recordedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(plan.recordedAt)
  ) {
    throw new AdapterRejection("missing-recorded-at", "recordedAt must be canonical UTC");
  }
  if (!Array.isArray(plan.components) || plan.components.length < 2) {
    throw new AdapterRejection("weak-spatial-intent", "at least two components are required");
  }
  if (plan.referenceBundle !== undefined) {
    const bundle = plan.referenceBundle;
    if (
      typeof bundle.imageRef !== "string" ||
      !bundle.imageRef.startsWith("moonsuite-input://") ||
      !/^sha256:[a-f0-9]{64}$/.test(bundle.sourceDigest ?? "") ||
      !Array.isArray(bundle.observedCues) || bundle.observedCues.length === 0 ||
      !Array.isArray(bundle.estimates) ||
      !Array.isArray(bundle.occlusions) || bundle.occlusions.length === 0 ||
      !Array.isArray(bundle.unknowns) || bundle.unknowns.length === 0 ||
      !Array.isArray(bundle.intendedConsumers) || bundle.intendedConsumers.length === 0
    ) {
      throw new AdapterRejection(
        "incomplete-reference-bundle",
        "reference intake must separate cues, estimates, occlusions, unknowns, and consumers",
      );
    }
    if (
      !bundle.suppliedScale ||
      !Number.isFinite(bundle.suppliedScale.valueMm) ||
      bundle.suppliedScale.valueMm <= 0 ||
      bundle.suppliedScale.derivedFromPixels !== false ||
      plan.scaleEvidence?.derivedFromPixels !== false ||
      plan.scaleEvidence?.valueMm !== bundle.suppliedScale.valueMm
    ) {
      throw new AdapterRejection(
        "unqualified-image-scale",
        "pixels cannot supply dimensions; explicit matching scale evidence is required",
      );
    }
    const provenance = plan.referenceProvenance.find((item) =>
      item.source === bundle.imageRef
    );
    if (!provenance || provenance.digest !== bundle.sourceDigest) {
      throw new AdapterRejection(
        "reference-provenance-mismatch",
        "reference bundle digest must match tracked provenance",
      );
    }
  }
  const ids = new Set();
  for (const component of plan.components) {
    if (ids.has(component.id)) {
      throw new AdapterRejection("duplicate-object", "component identities must be unique");
    }
    ids.add(component.id);
    if (!["box", "cylinder"].includes(component.kind)) {
      throw new AdapterRejection("unsupported-primitive", "only box and cylinder primitives are supported");
    }
    if (!component.position || !component.materialId) {
      throw new AdapterRejection("incomplete-component", "position and material are required");
    }
  }
  return structuredClone(plan);
}

/// Verify workspace-local reference bytes separately from semantic validation.
export async function verifyReferenceInputs(plan) {
  const bundle = plan.referenceBundle;
  if (!bundle) return [];
  const relative = bundle.imageRef.slice("moonsuite-input://".length);
  const sourcePath = resolveScopedPath(
    "/Users/kq/moonsuite/inputs",
    path.join("/Users/kq/moonsuite/inputs", relative),
  );
  const bytes = await readFile(sourcePath);
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== bundle.sourceDigest) {
    throw new AdapterRejection("reference-byte-mismatch", "reference image digest changed");
  }
  return [{
    imageRef: bundle.imageRef,
    sourceDigest: actual,
    byteLength: bytes.length,
    observedCues: bundle.observedCues,
    suppliedScale: bundle.suppliedScale,
    estimates: bundle.estimates,
    occlusions: bundle.occlusions,
    unknowns: bundle.unknowns,
    intendedConsumers: bundle.intendedConsumers,
  }];
}

function operationSequence(plan, outputRoot) {
  const operations = [
    {
      method: "scene.create-model",
      params: {
        name: plan.id,
        units: plan.units,
        coordinateFrame: plan.coordinateFrame
      }
    }
  ];
  for (const component of plan.components) {
    operations.push({
      method: component.kind === "box" ? "scene.create-box" : "scene.create-cylinder",
      params: component.kind === "box"
        ? {
            objectId: component.id,
            widthMm: component.dimensions.widthMm,
            depthMm: component.dimensions.depthMm,
            heightMm: component.dimensions.heightMm
          }
        : {
            objectId: component.id,
            radiusMm: component.dimensions.radiusMm,
            heightMm: component.dimensions.heightMm,
            sides: component.dimensions.sides
          }
    });
    operations.push({
      method: "scene.set-transform",
      params: {
        objectId: component.id,
        xMm: component.position.xMm,
        yMm: component.position.yMm,
        zMm: component.position.zMm
      }
    });
    operations.push({
      method: "scene.assign-material",
      params: { objectId: component.id, materialId: component.materialId }
    });
  }
  operations.push({ method: "scene.validate", params: {} });
  for (const representation of [
    "editable-source",
    "engineering",
    "presentation",
    "simulation",
    "manufacturing-candidate"
  ]) {
    operations.push({
      method: "representation.export",
      params: {
        representation,
        outputPath: path.join(outputRoot, `${representation}.moonmold.json`)
      }
    });
  }
  return operations;
}

function reportIdentity(report) {
  return {
    schema: report.schema,
    procedureId: report.procedureId,
    inputDigest: report.input.digest,
    finalSceneDigest: report.output.finalSceneDigest,
    accepted: report.output.accepted,
    representations: report.output.representations,
    portableContracts: report.output.portableContracts
  };
}

const PORTABLE_REPRESENTATION = {
  "spatial-intent": "spatial-intent",
  "editable-source": "editable-authoring-model",
  engineering: "engineering-model",
  presentation: "visual-styled-model",
  simulation: "simulation-model",
  "manufacturing-candidate": "manufacturing-candidate"
};

const PORTABLE_POLICY = {
  "editable-source": {
    lineage: "modeled-from",
    operation: "compile-editable-authoring-model",
    consumers: ["moonmold", "moondesk"],
    forbidden: ["moonrobo", "moonmoon", "fabrication"],
    claim: "digital-artifact"
  },
  engineering: {
    lineage: "modeled-from",
    operation: "derive-engineering-model",
    consumers: ["moonrobo"],
    forbidden: ["moontown-presentation", "fabrication"],
    claim: "digital-artifact"
  },
  presentation: {
    lineage: "styled-from",
    operation: "derive-presentation-model",
    consumers: ["moontown", "moondesk"],
    forbidden: ["moonrobo", "moonmoon", "fabrication"],
    claim: "digital-artifact"
  },
  simulation: {
    lineage: "physics-derived-from",
    operation: "derive-simulation-model",
    consumers: ["moonmoon"],
    forbidden: ["moonrobo-engineering", "fabrication"],
    claim: "digital-artifact"
  },
  "manufacturing-candidate": {
    lineage: "manufacturing-derived-from",
    operation: "prepare-manufacturing-candidate",
    consumers: ["manufacturing-review"],
    forbidden: ["moontown", "moonrobo", "moonmoon", "fabrication-execution"],
    claim: "digital-artifact"
  }
};

async function writeExactImmutable(outputPath, value) {
  const bytes = `${canonicalJson(value)}\n`;
  await writeFile(outputPath, bytes, { encoding: "utf8", flag: "wx" }).catch(
    async (error) => {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(outputPath, "utf8").catch(() => null);
      if (existing !== bytes) {
        throw new AdapterRejection(
          "immutable-portable-contract-conflict",
          "existing portable contract differs from deterministic output",
        );
      }
    },
  );
}

async function writePortableContracts({
  plan,
  operations,
  receipts,
  outputRoot,
}) {
  const exports = new Map();
  for (const [index, operation] of operations.entries()) {
    const representation = operation.params?.representation;
    if (representation) {
      exports.set(representation, {
        digest: receipts[index].outputHashes[0].digest,
        payloadRef: receipts[index].outputHashes[0].uri.replace("moonsuite://", "")
      });
    }
  }
  const summaries = [];
  for (const representation of [
    "editable-source",
    "engineering",
    "presentation",
    "simulation",
    "manufacturing-candidate"
  ]) {
    const child = exports.get(representation);
    const parentRepresentation = representation === "editable-source"
      ? "spatial-intent"
      : representation === "engineering"
        ? "editable-source"
        : "engineering";
    const parent = representation === "editable-source"
      ? { digest: digest(plan) }
      : exports.get(parentRepresentation);
    const policy = PORTABLE_POLICY[representation];
    const artifactId = `${plan.id}:${PORTABLE_REPRESENTATION[representation]}`;
    const parentArtifactId =
      representation === "editable-source"
        ? `${plan.id}:spatial-intent`
        : `${plan.id}:${PORTABLE_REPRESENTATION[parentRepresentation]}`;
    const assumptions = plan.unknowns.map((gap) => `unverified: ${gap}`);
    const manifest = {
      contract_id: "moonmold.spatial-artifact.v1",
      artifact_id: artifactId,
      project_id: `moonbook-${plan.id}`,
      representation: PORTABLE_REPRESENTATION[representation],
      parent_artifact_ids: [parentArtifactId],
      digest: child.digest,
      payload_ref: child.payloadRef,
      units: plan.units,
      coordinate_system: "cartesian",
      up_axis: plan.coordinateFrame.startsWith("z-up") ? "z" : "y",
      handedness: plan.coordinateFrame.endsWith("right-handed") ? "right" : "unknown",
      source_refs: plan.referenceProvenance.map((source) =>
        `books/${plan.id}/references/${source.referenceId}.json`
      ),
      backend_id: "moonmold-mock-reference",
      backend_version: "0.1.0",
      procedure_ref:
        `books/${plan.id}/procedures/parametric-building-from-explicit-spatial-intent-v1.json`,
      authority_envelope_id: `authority-moonmold-${plan.id}`,
      assumptions,
      unresolved_gaps: plan.unknowns,
      validation_refs: [`books/${plan.id}/evidence/${representation}-validation.json`],
      intended_consumers: policy.consumers,
      forbidden_consumers: policy.forbidden,
      claim_ceiling: policy.claim,
      recorded_at: plan.recordedAt
    };
    const transform = {
      contract_id: "moonmold.representation-transform.v1",
      transform_id: `transform-${plan.id}-${representation}-v1`,
      parent_artifact_id: parentArtifactId,
      parent_digest: parent.digest,
      parent_representation: PORTABLE_REPRESENTATION[parentRepresentation],
      child_artifact_id: artifactId,
      child_digest: child.digest,
      child_representation: PORTABLE_REPRESENTATION[representation],
      lineage_relation: policy.lineage,
      operation: policy.operation,
      parameters_digest: digest({
        plan: plan.id,
        representation,
        procedure: "parametric-building-from-explicit-spatial-intent-v1"
      }),
      tool_id: "moonmold-semantic-adapter",
      tool_version: "0.1.0",
      authority_ref: `authority-moonmold-${plan.id}`,
      declared_losses: representation === "engineering"
        ? []
        : representationPolicyLosses(representation),
      validation_refs: manifest.validation_refs,
      recorded_at: plan.recordedAt
    };
    const envelope = {
      schema: "moonmold-portable-ingestion-v1",
      manifest,
      transform
    };
    const portablePath = path.join(outputRoot, `${representation}.portable.json`);
    await writeExactImmutable(portablePath, envelope);
    summaries.push({
      representation,
      artifact_id: artifactId,
      digest: child.digest,
      parent_digest: parent.digest,
      lineage_relation: policy.lineage,
      claim_ceiling: policy.claim,
      path: `moonsuite://${path.relative("/Users/kq/moonsuite", portablePath)}`
    });
  }
  return summaries;
}

function representationPolicyLosses(representation) {
  switch (representation) {
    case "presentation":
      return ["engineering material fidelity", "collision fidelity"];
    case "simulation":
      return ["measured mass properties absent", "environment calibration absent"];
    case "manufacturing-candidate":
      return [
        "watertightness not independently measured",
        "fabrication tolerance unqualified",
        "material and process assumptions unresolved"
      ];
    default:
      return [];
  }
}

export async function runBuildingExperiment({ inputPath, outputRoot }) {
  const workspaceRoot = "/Users/kq/moonsuite";
  const resolvedOutput = resolveScopedPath(workspaceRoot, outputRoot);
  const plan = validateBuildingPlan(JSON.parse(await readFile(inputPath, "utf8")));
  const verifiedReferences = await verifyReferenceInputs(plan);
  await mkdir(resolvedOutput, { recursive: true });
  const runtime = new SemanticAdapterRuntime();
  const receipts = [];
  const operations = operationSequence(plan, resolvedOutput);
  for (const [index, operation] of operations.entries()) {
    const envelope = {
      projectId: `moonbook-${plan.id}`,
      sessionId: `experiment-${plan.id}`,
      modelId: plan.id,
      requestId: `${plan.id}-request-${index + 1}`,
      idempotencyKey: `${plan.id}-operation-${index + 1}`,
      expectedParentDigest: runtime.sceneDigest,
      workspaceRoot,
      deadlineMs: 30_000,
      authority: "workspace-mutation",
      ...operation
    };
    receipts.push(await runtime.execute(envelope));
  }
  const representationReceipt = (name) => receipts.find((receipt, index) =>
    operations[index].params?.representation === name
  );
  const engineering = representationReceipt("engineering");
  const presentation = representationReceipt("presentation");
  const simulation = representationReceipt("simulation");
  const manufacturing = representationReceipt("manufacturing-candidate");
  const report = {
    schema: "moonmold-experiment-report-v1",
    procedureId: "parametric-building-from-explicit-spatial-intent-v1",
    input: {
      planId: plan.id,
      digest: digest(plan),
      scaleEvidence: plan.scaleEvidence,
      referenceProvenance: plan.referenceProvenance,
      unknowns: plan.unknowns,
      referenceBundle: plan.referenceBundle ?? null,
      verifiedReferences
    },
    output: {
      finalSceneDigest: runtime.sceneDigest,
      operationCount: operations.length,
      accepted: receipts.every((receipt) => receipt.validation.accepted),
      representations: [
        {
          class: "engineering",
          digest: engineering.outputHashes[0].digest,
          relation: "modeled-from",
          knownLosses: [],
          claimCeiling: "digital-engineering-candidate"
        },
        {
          class: "presentation",
          digest: presentation.outputHashes[0].digest,
          parentDigest: engineering.outputHashes[0].digest,
          relation: "styled-from",
          knownLosses: ["engineering material fidelity", "collision fidelity"],
          claimCeiling: "presentation-only"
        },
        {
          class: "simulation",
          digest: simulation.outputHashes[0].digest,
          parentDigest: engineering.outputHashes[0].digest,
          relation: "physics-derived-from",
          knownLosses: ["measured mass properties absent", "environment calibration absent"],
          claimCeiling: "simulation-input-candidate"
        },
        {
          class: "manufacturing-candidate",
          digest: manufacturing.outputHashes[0].digest,
          parentDigest: engineering.outputHashes[0].digest,
          relation: "manufacturing-derived-from",
          knownLosses: [
            "watertightness not independently measured",
            "fabrication tolerance unqualified",
            "material and process assumptions unresolved"
          ],
          claimCeiling: "analysis-only-no-machine-authority"
        }
      ]
    },
    quality: {
      explicitUnits: plan.units,
      explicitCoordinateFrame: plan.coordinateFrame,
      uniqueObjectIdentity: true,
      deterministicProcedure: true,
      visualAndEngineeringReviewSeparated: true,
      physicalReadinessClaimed: false,
      unresolvedUnknownCount: plan.unknowns.length
    },
    receipts
  };
  report.output.portableContracts = await writePortableContracts({
    plan,
    operations,
    receipts,
    outputRoot: resolvedOutput
  });
  const reportPath = path.join(resolvedOutput, "experiment-report.json");
  let persisted = report;
  await writeFile(
    reportPath,
    `${canonicalJson(report)}\n`,
    { encoding: "utf8", flag: "wx" }
  ).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(reportPath, "utf8"));
    if (canonicalJson(reportIdentity(existing)) !== canonicalJson(reportIdentity(report))) {
      throw new AdapterRejection(
        "immutable-report-conflict",
        "existing experiment report belongs to different semantic evidence",
      );
    }
    persisted = existing;
  });
  return persisted;
}
