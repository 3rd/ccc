import { join } from "path";
import type { Context } from "@/context/Context";
import type { ClaudeMCPConfig, MCPServers } from "@/types/mcps";
import { loadConfigFromLayers, mergeMCPs } from "@/config/layers";
import { setInstanceId } from "@/mcps/mcp-generator";
import { getPluginMCPs } from "@/plugins/registry";

const processExternalMCP = (
  config: ClaudeMCPConfig & { filter?: unknown; autoEnable?: string; headersHelper?: string },
  name: string,
  context: Context,
): ClaudeMCPConfig | null => {
  // external MCP with filter -> use runner
  if (config.filter && typeof config.filter === "function") {
    const runnerPath = join(context.launcherDirectory, "src", "cli", "runner.ts");
    const env: Record<string, string> = {
      CCC_INSTANCE_ID: context.instanceId,
    };

    if ("env" in config && config.env) {
      Object.assign(env, config.env);
    }

    const result: ClaudeMCPConfig = {
      type: "stdio" as const,
      command: "tsx",
      args: [runnerPath, "mcp", name],
      env,
    };

    if (config.autoEnable) {
      (result as { autoEnable?: string }).autoEnable = config.autoEnable;
    }

    return result;
  }

  const { filter: _, ...configWithoutFilter } = config;
  return configWithoutFilter;
};

export const buildMCPs = async (context: Context): Promise<Record<string, ClaudeMCPConfig>> => {
  setInstanceId(context.instanceId, context.configDirectory);

  const layers = await loadConfigFromLayers<MCPServers>(context, "mcps.ts");
  const merged = mergeMCPs(layers.global, ...layers.presets, layers.project);

  const processed: Record<string, ClaudeMCPConfig> = {};

  for (const [name, layerData] of Object.entries(merged)) {
    if (layerData.type === "inline") {
      const runnerPath = join(context.launcherDirectory, "src", "cli", "runner.ts");
      processed[name] = {
        type: "stdio",
        command: "tsx",
        args: [runnerPath, "mcp", name],
        env: {
          CCC_INSTANCE_ID: context.instanceId,
        },
      };
    } else if (layerData.type === "http" || layerData.type === "sse" || layerData.type === "traditional") {
      const config = layerData.config;
      const result = processExternalMCP(config, name, context);
      if (result) {
        processed[name] = result;
      }
    }
  }

  // add plugin MCPs
  const pluginMCPs = getPluginMCPs(context.loadedPlugins);
  for (const [name, layerData] of Object.entries(pluginMCPs)) {
    if (layerData.type === "inline") {
      const runnerPath = join(context.launcherDirectory, "src", "cli", "runner.ts");
      processed[name] = {
        type: "stdio",
        command: "tsx",
        args: [runnerPath, "mcp", name],
        env: {
          CCC_INSTANCE_ID: context.instanceId,
        },
      };
    } else if (layerData.type === "http" || layerData.type === "sse" || layerData.type === "traditional") {
      const config = layerData.config;
      const result = processExternalMCP(config, name, context);
      if (result) {
        processed[name] = result;
      }
    }
  }

  return processed;
};
