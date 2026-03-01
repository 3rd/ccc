import { isAbsolute, join, normalize, resolve } from "path";
import type { Context } from "@/context/Context";
import type { ClaudeMCPConfig, MCPServers } from "@/types/mcps";
import { loadConfigFromLayers, mergeMCPs } from "@/config/layers";
import { setInstanceId } from "@/mcps/mcp-generator";
import { getPluginMCPs } from "@/plugins/registry";

const toAbsoluteConfigDirectory = (launcherDirectory: string, configDirectory: string): string => {
  const trimmed = configDirectory.trim();
  if (trimmed.length === 0) return join(launcherDirectory, "config");
  return normalize(isAbsolute(trimmed) ? trimmed : resolve(launcherDirectory, trimmed));
};

const buildRunnerEnv = (context: Context, extraEnv?: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {
    ...(extraEnv ?? {}),
    CCC_INSTANCE_ID: context.instanceId,
    CCC_CONFIG_DIR: toAbsoluteConfigDirectory(context.launcherDirectory, context.configDirectory),
  };

  if (process.env.DEBUG) {
    env.DEBUG = process.env.DEBUG;
  }

  return env;
};

const processExternalMCP = (
  config: ClaudeMCPConfig & { filter?: unknown; autoEnable?: string; headersHelper?: string },
  name: string,
  context: Context,
): ClaudeMCPConfig | null => {
  // external MCP with filter -> use runner
  if (config.filter && typeof config.filter === "function") {
    const runnerPath = join(context.launcherDirectory, "src", "cli", "runner.ts");
    const env = buildRunnerEnv(context, "env" in config ? config.env : undefined);

    const result: ClaudeMCPConfig = {
      type: "stdio" as const,
      command: "bun",
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
        command: "bun",
        args: [runnerPath, "mcp", name],
        env: buildRunnerEnv(context),
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
        command: "bun",
        args: [runnerPath, "mcp", name],
        env: buildRunnerEnv(context),
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
