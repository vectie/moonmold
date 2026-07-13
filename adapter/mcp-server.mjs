import readline from "node:readline";
import { createMcpHandler } from "./mcp.mjs";

const handle = createMcpHandler();
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();

for await (const line of lines) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    })}\n`);
    continue;
  }
  const task = handle(message).then((response) => {
    if (response !== null && response !== undefined) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });
  pending.add(task);
  task.finally(() => pending.delete(task));
}

await Promise.allSettled([...pending]);
