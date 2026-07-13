import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  if (!Array.isArray(plan.components) || plan.components.length < 2) {
    throw new AdapterRejection("weak-spatial-intent", "at least two components are required");
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
    representations: report.output.representations
  };
}

export async function runBuildingExperiment({ inputPath, outputRoot }) {
  const workspaceRoot = "/Users/kq/moonsuite";
  const resolvedOutput = resolveScopedPath(workspaceRoot, outputRoot);
  const plan = validateBuildingPlan(JSON.parse(await readFile(inputPath, "utf8")));
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
      unknowns: plan.unknowns
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
