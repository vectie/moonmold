import { AdapterRejection, PROTOCOL_VERSION } from "./protocol.mjs";
import { SemanticAdapterRuntime } from "./runtime.mjs";

export function createMcpHandler(runtime = new SemanticAdapterRuntime()) {
  return async function handle(message) {
    const id = message?.id ?? null;
    try {
      if (message?.jsonrpc !== "2.0") {
        throw new AdapterRejection("invalid-jsonrpc", "jsonrpc must equal 2.0");
      }
      if (message.method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "moonmold", version: "0.1.0" },
            capabilities: { tools: {} },
            moonmoldProtocol: PROTOCOL_VERSION,
          },
        };
      }
      if (message.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "moonmold_semantic_operation",
                description: "Execute one governed, allowlisted MoonMold semantic operation",
                inputSchema: {
                  type: "object",
                  properties: {
                    projectId: { type: "string" },
                    sessionId: { type: "string" },
                    modelId: { type: "string" },
                    requestId: { type: "string" },
                    idempotencyKey: { type: "string" },
                    expectedParentDigest: { type: "string" },
                    workspaceRoot: { type: "string" },
                    deadlineMs: {
                      type: "integer",
                      minimum: 1,
                      maximum: 120000
                    },
                    authority: {
                      type: "string",
                      enum: [
                        "observe",
                        "cognitive-maintenance",
                        "sandbox-execution",
                        "workspace-mutation"
                      ]
                    },
                    method: {
                      type: "string",
                      enum: [
                        "capability.discover",
                        "scene.create-model",
                        "scene.create-box",
                        "scene.create-cylinder",
                        "scene.set-transform",
                        "scene.assign-material",
                        "scene.boolean-subtract",
                        "scene.validate",
                        "representation.export"
                      ]
                    },
                    params: { type: "object" }
                  },
                  required: [
                    "projectId",
                    "sessionId",
                    "modelId",
                    "requestId",
                    "idempotencyKey",
                    "expectedParentDigest",
                    "workspaceRoot",
                    "deadlineMs",
                    "authority",
                    "method",
                    "params"
                  ],
                  additionalProperties: false
                }
              }
            ]
          }
        };
      }
      if (message.method !== "tools/call") {
        throw new AdapterRejection("unsupported-mcp-method", "only initialize, tools/list, and tools/call are available");
      }
      if (message.params?.name !== "moonmold_semantic_operation") {
        throw new AdapterRejection("unsupported-tool", "tool is not allowlisted");
      }
      const receipt = await runtime.execute(message.params.arguments);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(receipt) }],
          structuredContent: receipt,
          isError: false
        }
      };
    } catch (error) {
      const rejection = error instanceof AdapterRejection
        ? error
        : new AdapterRejection("internal-error", "adapter failed without exposing backend internals");
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: rejection.message,
          data: { moonmoldCode: rejection.code, details: rejection.details }
        }
      };
    }
  };
}
