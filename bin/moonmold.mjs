#!/usr/bin/env node
import { runBuildingExperiment } from "../adapter/experiment.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

if (process.argv[2] !== "build") {
  process.stderr.write("usage: moonmold build --input PLAN.json --output WORKSPACE_PATH\n");
  process.exitCode = 2;
} else {
  try {
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
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      accepted: false,
      code: error.code ?? "unexpected-error",
      message: error.message
    })}\n`);
    process.exitCode = 1;
  }
}

