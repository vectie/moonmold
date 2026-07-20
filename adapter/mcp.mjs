import { AdapterRejection, PROTOCOL_VERSION } from "./protocol.mjs";
import { SemanticAdapterRuntime } from "./runtime.mjs";
import { runLiveBlenderExperiment } from "./live-blender.mjs";

export function createMcpHandler(runtime = new SemanticAdapterRuntime()) {
  const cancellations = new Map();
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
            runtimeCapabilities: runtime.capabilities(),
            initialSceneDigest: runtime.sceneDigest,
          },
        };
      }
      if (message.method === "notifications/cancelled") {
        cancellations.get(message.params?.requestId)?.abort();
        return null;
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
              },
              {
                name: "moonmold_live_building",
                description: "Run the fixed, audited Blender bridge for one workspace-local building plan",
                inputSchema: {
                  type: "object",
                  properties: {
                    requestId: { type: "string" },
                    idempotencyKey: { type: "string" },
                    workspaceRoot: { type: "string" },
                    inputPath: { type: "string" },
                    outputRoot: { type: "string" },
                    timeoutMs: {
                      type: "integer",
                      minimum: 1,
                      maximum: 300000
                    },
                    authority: {
                      type: "string",
                      enum: ["workspace-mutation"]
                    }
                  },
                  required: [
                    "requestId",
                    "idempotencyKey",
                    "workspaceRoot",
                    "inputPath",
                    "outputRoot",
                    "timeoutMs",
                    "authority"
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
      if (
        message.params?.name !== "moonmold_semantic_operation" &&
        message.params?.name !== "moonmold_live_building"
      ) {
        throw new AdapterRejection("unsupported-tool", "tool is not allowlisted");
      }
      let receipt;
      if (message.params.name === "moonmold_semantic_operation") {
        receipt = await runtime.execute(message.params.arguments);
      } else {
        const args = message.params.arguments;
        if (
          !args || typeof args !== "object" ||
          typeof args.requestId !== "string" ||
          typeof args.idempotencyKey !== "string" ||
          args.authority !== "workspace-mutation" ||
          Object.keys(args).some((key) => ![
            "requestId",
            "idempotencyKey",
            "workspaceRoot",
            "inputPath",
            "outputRoot",
            "timeoutMs",
            "authority"
          ].includes(key))
        ) {
          throw new AdapterRejection(
            "invalid-live-request",
            "live building request does not match its exact schema",
          );
        }
        const controller = new AbortController();
        cancellations.set(id, controller);
        try {
          const evidence = await runLiveBlenderExperiment({
            workspaceRoot: args.workspaceRoot,
            inputPath: args.inputPath,
            outputRoot: args.outputRoot,
            timeoutMs: args.timeoutMs,
            signal: controller.signal,
          });
          receipt = {
            requestId: args.requestId,
            idempotencyKey: args.idempotencyKey,
            outcome: evidence.outcome,
            evidence,
          };
        } finally {
          cancellations.delete(id);
        }
      }
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
