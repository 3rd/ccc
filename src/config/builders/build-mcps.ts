import { join } from "path";
import type { Context } from "@/context/Context";
import type { ClaudeMCPConfig, MCPLayerData, MCPServers } from "@/types/mcps";
import { loadConfigFromLayers, mergeMCPs } from "@/config/layers";
import { setInstanceId } from "@/mcps/mcp-generator";
import { getPluginMCPs } from "@/plugins/registry";
import { isMCPLayerDisabled } from "@/types/mcps";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { isMcpEnabledForSession, readSessionToolPolicy } from "@/config/session-tool-policy";

const buildRunnerEnv = (context: Context, extraEnv?: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {
    ...extraEnv,
    CCC_INSTANCE_ID: context.instanceId,
    CCC_CONFIG_DIR: resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory),
  };

  if (process.env.DEBUG) {
    env.DEBUG = process.env.DEBUG;
  }

  return env;
};

const buildInlineMCPCommand = (name: string, context: Context): ClaudeMCPConfig => {
  const runnerPath = join(context.launcherDirectory, "src", "cli", "runner.ts");
  return {
    type: "stdio",
    command: "bun",
    args: ["--config=/dev/null", runnerPath, "mcp", name],
    env: buildRunnerEnv(context),
  };
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
      args: ["--config=/dev/null", runnerPath, "mcp", name],
      env,
    };

    if (config.autoEnable) {
      (result as { autoEnable?: string }).autoEnable = config.autoEnable;
    }

    return result;
  }

  const { filter: _filter, enabled: _enabled, ...configWithoutBuildTimeFields } = config;
  return configWithoutBuildTimeFields;
};

type McpCatalogEntry = {
  id: string;
  isEnabledByDefault: boolean;
  config: ClaudeMCPConfig | null;
};

type BuildMcpOptions = {
  onCatalog?: (catalog: McpCatalogEntry[]) => void;
};

const buildMcpConnectionConfig = (layer: MCPLayerData, name: string, context: Context) => {
  if (layer.type === "inline") {
    return buildInlineMCPCommand(name, context);
  }

  return processExternalMCP(layer.config, name, context);
};

export const buildMCPs = async (context: Context, options: BuildMcpOptions = {}): Promise<Record<string, ClaudeMCPConfig>> => {
  setInstanceId(context.instanceId, context.configDirectory);

  const layers = await loadConfigFromLayers<MCPServers>(context, "mcps.ts");
  const merged = mergeMCPs(layers.global, ...layers.presets, layers.project);
  // add plugin MCPs
  const pluginMCPs = getPluginMCPs(context.loadedPlugins);
  const toolPolicy = readSessionToolPolicy();

  const processed: Record<string, ClaudeMCPConfig> = {};

  for (const [name, layerData] of [...Object.entries(merged), ...Object.entries(pluginMCPs)]) {
    const isEnabled = isMcpEnabledForSession(toolPolicy, name, !isMCPLayerDisabled(layerData));
    if (!isEnabled) continue;

    const config = buildMcpConnectionConfig(layerData, name, context);
    if (config === null) continue;

    processed[name] = config;
  }

  if (options.onCatalog !== undefined) {
    const availableServers = { ...merged, ...pluginMCPs };
    const catalog = Object.entries(availableServers).sort(([left], [right]) => left.localeCompare(right)).map(([id, layer]) => ({
      id,
      isEnabledByDefault: processed[id] !== undefined,
      config: processed[id] ?? buildMcpConnectionConfig(layer, id, context),
    }));
    options.onCatalog(catalog);
  }

  return processed;
};
