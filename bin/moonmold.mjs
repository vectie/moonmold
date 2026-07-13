#!/usr/bin/env node
import { runBuildingExperiment } from "../adapter/experiment.mjs";
import { runLiveBlenderExperiment } from "../adapter/live-blender.mjs";
import { attestFlow, executeFlow } from "../adapter/flow.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

const command = process.argv[2];
const subcommand = process.argv[3];
if (command !== "build" && command !== "live-blender" && command !== "flow-adapter") {
  process.stderr.write(
    "usage: moonmold <build|live-blender|flow-adapter execute|flow-adapter attest> [options]\n",
  );
  process.exitCode = 2;
} else {
  try {
    if (command === "build") {
      const report = await runBuildingExperiment({
        inputPath: argument("--input"),
        outputRoot: argument("--output")
      });
      process.stdout.write(`${JSON.stringify({
        accepted: report.output.accepted,
        planId: report.input.planId,
        finalSceneDigest: report.output.finalSceneDigest,
        operationCount: report.output.operationCount,
        procedureId: report.procedureId
      }, null, 2)}\n`);
      if (!report.output.accepted) process.exitCode = 1;
    } else if (command === "live-blender") {
      const evidence = await runLiveBlenderExperiment({
        inputPath: argument("--input"),
        outputRoot: argument("--output")
      });
      process.stdout.write(`${JSON.stringify({
        accepted: evidence.accepted,
        outcome: evidence.outcome,
        evidenceClass: evidence.evidenceClass,
        planId: evidence.planId,
        objectCount: evidence.objectCount,
        outputs: Object.keys(evidence.outputs),
        physicalEffects: evidence.physicalEffects
      }, null, 2)}\n`);
      if (!evidence.accepted) process.exitCode = 1;
    } else if (subcommand === "execute") {
      await executeFlow({
        workspace: argument("--workspace"),
        requestRef: argument("--request"),
        resultRef: argument("--result"),
        draftRef: argument("--artifact"),
      });
    } else if (subcommand === "attest") {
      await attestFlow({
        workspace: argument("--workspace"),
        requestRef: argument("--request"),
        resultRef: argument("--result"),
        attestationRef: argument("--attestation"),
        attestorId: argument("--attestor-id"),
        draftRef: argument("--draft"),
        finalRef: argument("--final"),
      });
    } else {
      throw new Error("flow-adapter requires execute or attest");
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      accepted: false,
      code: error.code ?? "unexpected-error",
      message: error.message
    })}\n`);
    process.exitCode = 1;
  }
}
