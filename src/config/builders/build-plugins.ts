import { existsSync, readdirSync, statSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import type { Context } from "@/context/Context";
import type { PluginEnablementConfig } from "@/plugins/schema";
import { loadConfigFromLayers } from "@/config/layers";
import { type ClaudePluginsConfig, type PluginsConfig, validatePlugins } from "@/config/plugins";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { log } from "@/utils/log";

const mergePluginsConfig = (...layers: (PluginsConfig | undefined)[]): PluginsConfig => {
  const mergedCCC: PluginEnablementConfig = {};
  const mergedClaude: ClaudePluginsConfig = {};
  let mergedPluginDirs: string[] | undefined;

  for (const layer of layers) {
    if (!layer) continue;

    if (layer.ccc) {
      for (const [name, value] of Object.entries(layer.ccc)) {
        mergedCCC[name] = value;
      }
    }

    if (layer.claude?.enabledPlugins) {
      mergedClaude.enabledPlugins = {
        ...mergedClaude.enabledPlugins,
        ...layer.claude.enabledPlugins,
      };
    }

    if (layer.claude?.extraKnownMarketplaces) {
      mergedClaude.extraKnownMarketplaces = {
        ...mergedClaude.extraKnownMarketplaces,
        ...layer.claude.extraKnownMarketplaces,
      };
    }

    if (layer.claude?.pluginDirs) {
      mergedPluginDirs = layer.claude.pluginDirs;
    }
  }

  if (mergedPluginDirs) {
    mergedClaude.pluginDirs = mergedPluginDirs;
  }

  return {
    ccc: Object.keys(mergedCCC).length > 0 ? mergedCCC : undefined,
    claude: Object.keys(mergedClaude).length > 0 ? mergedClaude : undefined,
  };
};

const resolvePluginDirs = (configBase: string, pluginDirs: string[]): string[] => {
  return pluginDirs.map((dir) => (isAbsolute(dir) ? resolve(dir) : resolve(configBase, dir)));
};

const discoverClaudePluginDirs = (configBase: string): string[] => {
  const discovered: string[] = [];
  const root = join(configBase, "claude-plugins");
  if (!existsSync(root)) return discovered;

  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch (error) {
    log.warn("PLUGINS", `Failed to read claude-plugins directory: ${error}`);
    return discovered;
  }

  for (const entry of entries) {
    const entryPath = join(root, entry);
    let stats: ReturnType<typeof statSync> | null = null;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    const manifestPath = join(entryPath, ".claude-plugin", "plugin.json");
    if (!existsSync(manifestPath)) {
      log.warn("PLUGINS", `Skipping Claude plugin without .claude-plugin/plugin.json: ${entryPath}`);
      continue;
    }
    discovered.push(entryPath);
  }

  return discovered;
};

const uniq = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = resolve(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

export const buildPlugins = async (context: Context): Promise<PluginsConfig> => {
  const layers = await loadConfigFromLayers<PluginsConfig>(context, "plugins.ts");
  const merged = mergePluginsConfig(layers.global, ...layers.presets, layers.project);
  const validated = validatePlugins(merged);

  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);

  const resolvedPluginDirs =
    validated.claude?.pluginDirs ? resolvePluginDirs(configBase, validated.claude.pluginDirs) : [];
  const autoDiscovered = discoverClaudePluginDirs(configBase);
  const pluginDirs = uniq([...resolvedPluginDirs, ...autoDiscovered]);

  const claude = validated.claude ? { ...validated.claude } : undefined;
  if (pluginDirs.length > 0) {
    if (claude) {
      claude.pluginDirs = pluginDirs;
    } else {
      return { ccc: validated.ccc, claude: { pluginDirs } };
    }
  }

  return { ccc: validated.ccc, claude };
};
