import type { Context } from "@/context/Context";
import type { ClaudeMCPConfig, MCPServers } from "@/types/mcps";
import { loadConfigFromLayers, mergeMCPs } from "@/config/layers";
import { generateMCPServer, setInstanceId } from "@/mcps/mcp-generator";

export const buildMCPs = async (context: Context): Promise<Record<string, ClaudeMCPConfig>> => {
  setInstanceId(context.instanceId, context.configDirectory);

  const layers = await loadConfigFromLayers<MCPServers>(context, "mcps.ts");
  const merged = mergeMCPs(layers.global, ...layers.presets, layers.project);

  const processed: Record<string, ClaudeMCPConfig> = {};

  for (const [name, layerData] of Object.entries(merged)) {
    if (layerData.type === "inline") {
      const factory = layerData.config;
      const serverCommand = generateMCPServer(factory);
      const parts = serverCommand.split(" ");
      const command = parts[0] || "tsx";
      const args = parts.slice(1);

      processed[name] = {
        type: "stdio",
        command,
        args,
        env: {
          CCC_INSTANCE_ID: context.instanceId,
        },
      };
    } else if (layerData.type === "http") {
      processed[name] = layerData.config;
    } else if (layerData.type === "sse") {
      processed[name] = layerData.config;
    } else {
      processed[name] = layerData.config;
    }
  }

  return processed;
};
