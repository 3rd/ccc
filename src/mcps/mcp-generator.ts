import type { StandardSchemaV1 } from "@standard-schema/spec";
import { FastMCP } from "fastmcp";
import type { JsonSchema, MCPInitializeResponse } from "@/types/mcp-protocol";
import type { ClaudeMCPConfig, FastMCPFactory, MCPLayerData, MCPToolFilter } from "@/types/mcps";
import { log } from "@/utils/log";
import { MCPClient } from "./mcp-client";

// xsschema (used by fastmcp) fast-path: when "jsonSchema" exists on "~standard",
// toJsonSchema() calls schema["~standard"].jsonSchema.input() directly
// instead of dispatching through a vendor-specific converter
type JsonSchemaToolParameters = StandardSchemaV1<unknown, unknown> & {
  "~standard": StandardSchemaV1.Props<unknown, unknown> & {
    jsonSchema: {
      input: (_options?: { target?: string }) => JsonSchema;
    };
  };
};

const createJsonSchemaToolParameters = (schema: JsonSchema): JsonSchemaToolParameters => {
  return {
    "~standard": {
      version: 1,
      vendor: "ccc-json-schema-proxy",
      // upstream MCP still performs authoritative validation on tool calls
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => schema,
      },
    },
  };
};

export const createMCP = (factory: FastMCPFactory): MCPLayerData => {
  return { type: "inline", config: factory };
};

export const setInstanceId = (instanceId: string, configDirectory = "config") => {
  log.debug("MCPS", `Set instance ID: ${instanceId}, configDir=${configDirectory}`);
};

export const createMCPProxy = (originalConfig: ClaudeMCPConfig, filter: MCPToolFilter): MCPLayerData => {
  const factory: FastMCPFactory = async () => {
    const client = new MCPClient(originalConfig);
    let initResponse: MCPInitializeResponse;

    // connect
    try {
      await client.connect();
      initResponse = await client.initialize();
      await client.sendInitialized();
    } catch (error) {
      log.error("MCP_PROXY", `Failed to connect to external MCP: ${error}`);
      client.disconnect();
      throw error;
    }

    // create proxy
    const version = initResponse.serverInfo.version || "1.0.0";
    const versionMatch = /(\d+)\.(\d+)\.(\d+)/.exec(version);
    const formattedVersion =
      versionMatch ? `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}` : "1.0.0";
    const server = new FastMCP({
      name: initResponse.serverInfo.name || "ccc-mcp-proxy",
      version: formattedVersion as `${number}.${number}.${number}`,
      instructions: `Filtered proxy of ${initResponse.serverInfo.name} MCP server`,
    });

    try {
      // proxy tools
      if (initResponse.capabilities?.tools) {
        const tools = await client.listTools();
        let registeredTools = 0;

        for (const tool of tools) {
          const filterableTool: { name: string; description?: string; [key: string]: unknown } = {
            ...tool,
            name: tool.name,
            description: tool.description,
          };
          if (!filter(filterableTool)) continue;

          registeredTools++;
          const parameters = tool.inputSchema ? createJsonSchemaToolParameters(tool.inputSchema) : undefined;

          server.addTool({
            name: tool.name,
            description: tool.description || "",
            ...(parameters ? { parameters } : {}),
            execute: async (args) => {
              try {
                const response = await client.callTool(tool.name, args);
                if (response.isError) {
                  const errorText = response.content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text || "")
                    .join("\n");
                  throw new Error(errorText || "Tool execution failed");
                }

                const textParts = [];
                const imageParts = [];
                const resourceParts = [];
                for (const content of response.content) {
                  if (content.type === "text" && content.text) {
                    textParts.push(content.text);
                  } else if (content.type === "image" && content.data) {
                    imageParts.push(`[Image: ${content.mimeType || "image"}]`);
                  } else if (content.type === "resource" && content.uri) {
                    resourceParts.push(`[Resource: ${content.uri}]`);
                  }
                }

                const allParts = [...textParts, ...imageParts, ...resourceParts];
                return allParts.join("\n") || "No content";
              } catch (error) {
                throw error instanceof Error ? error : new Error(String(error));
              }
            },
          });
        }

        log.debug(
          "MCP_PROXY",
          `${initResponse.serverInfo.name}: Registered ${registeredTools}/${tools.length} tools after filtering`,
        );
      }

      // proxy resources
      if (initResponse.capabilities?.resources) {
        const resources = await client.listResources();

        for (const resource of resources) {
          server.addResource({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            async load() {
              const response = await client.readResource(resource.uri);
              if (response.contents && response.contents.length > 0) {
                const content = response.contents[0];
                if (content) {
                  return {
                    text: content.text || "",
                    mimeType: content.mimeType,
                  };
                }
              }
              return { text: "" };
            },
          });
        }

        log.debug("MCP_PROXY", `${initResponse.serverInfo.name}: Proxied ${resources.length} resources`);
      }

      // proxy prompts
      if (initResponse.capabilities?.prompts) {
        const prompts = await client.listPrompts();

        for (const prompt of prompts) {
          server.addPrompt({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments?.map((arg) => {
              return {
                name: arg.name,
                description: arg.description,
                required: arg.required || false,
              };
            }),
            async load(args: Record<string, string | undefined>) {
              const cleanArgs: Record<string, string> = {};
              for (const [key, value] of Object.entries(args)) {
                if (value !== undefined) {
                  cleanArgs[key] = value;
                }
              }
              const response = await client.getPrompt(prompt.name, cleanArgs);
              const promptText = response.messages
                .map((msg) => {
                  const content = msg.content.text || JSON.stringify(msg.content);
                  return `${msg.role}: ${content}`;
                })
                .join("\n\n");

              return promptText;
            },
          });
        }

        log.debug("MCP_PROXY", `${initResponse.serverInfo.name}: Proxied ${prompts.length} prompts`);
      }
    } catch (error) {
      log.error("MCP_PROXY", `Failed to setup proxy for ${initResponse.serverInfo.name}: ${error}`);
      client.disconnect();
      throw error;
    }

    return server;
  };

  return createMCP(factory);
};
