import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";

const CANDIDATES = [
  process.env.MOONMOLD_BLENDER,
  "/Applications/Blender.app/Contents/MacOS/Blender",
  "/usr/local/bin/blender",
  "/opt/homebrew/bin/blender",
].filter(Boolean);

export function discoverBlender() {
  for (const executable of CANDIDATES) {
    try {
      accessSync(executable, constants.X_OK);
      const output = execFileSync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return {
        available: true,
        executable,
        version: output.split("\n")[0],
        executionMode: "fixed-semantic-bridge-only",
      };
    } catch {
      // Discovery continues without broadening the executable search path.
    }
  }
  return {
    available: false,
    executable: null,
    version: null,
    executionMode: "mock-reference-runtime",
  };
}

