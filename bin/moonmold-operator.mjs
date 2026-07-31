#!/usr/bin/env node
import path from "node:path";
import { createOperatorServer } from "../adapter/operator-server.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const workspaceRoot = path.resolve(argument("--workspace", process.cwd()));
const port = Number(argument("--port", "4193"));
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("--port must be an integer from 1 through 65535");
}
const server = createOperatorServer({ workspaceRoot });
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      contract_id: "moonmold.operator-listener.v1",
      url: `http://127.0.0.1:${port}`,
      workspace_root: workspaceRoot,
      physical_authority: false,
    })}\n`,
  );
});
