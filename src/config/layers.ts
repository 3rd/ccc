import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookDefinition, HookEntry, HooksConfiguration } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { formatConfigError } from "@/utils/errors";
import { log } from "@/utils/log";

export const mergeMCPs = (...layers: (MCPServers | undefined)[]): MCPServers => {
  const result: MCPServers = {};
  for (const layer of layers) {
    if (layer) {
      Object.assign(result, layer);
    }
  }
  return result;
};

export const mergeSettings = (
  ...layers: (Record<string, unknown> | undefined)[]
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer) {
      for (const [key, value] of Object.entries(layer)) {
        if (value !== undefined) {
          // deep merge for 'env' object - env vars should accumulate, not replace
          if (key === "env" && typeof value === "object" && value !== null) {
            result[key] = {
              ...(result[key] as Record<string, unknown> | undefined),
              ...value,
            };
          } else {
            result[key] = value;
          }
        }
      }
    }
  }
  return result;
};

const stripHookEnabled = <T extends { enabled?: boolean }>(entry: T): Omit<T, "enabled"> => {
  const { enabled: _enabled, ...rest } = entry;
  return rest;
};

/**
 * Drop the `enabled: false` entries from a HookDefinition, strip the flag from
 * survivors, and return `null` if the definition has no surviving entries (or
 * was itself flagged disabled). Used by `mergeHooks`, the plugin hook
 * collector, and skill-level hook emission.
 */
export const normalizeHookDefinition = (def: HookDefinition): HookDefinition | null => {
  if (def.enabled === false) return null;
  const enabledHooks = def.hooks.filter((h) => h.enabled !== false).map(stripHookEnabled);
  if (enabledHooks.length === 0) return null;
  return { ...stripHookEnabled(def), hooks: enabledHooks as HookEntry[] };
};

/**
 * Normalize an entire HooksConfiguration: drop disabled definitions, drop
 * disabled entries, and drop event keys that end up with no surviving
 * definitions. Returns a plain `HooksConfiguration` so it can be used in
 * places that consume that shape directly.
 */
export const normalizeHooksConfiguration = (config: HooksConfiguration): HooksConfiguration => {
  const out: HooksConfiguration = {};
  for (const [event, defs] of Object.entries(config)) {
    if (!defs) continue;
    const survivors: HookDefinition[] = [];
    for (const def of defs) {
      const normalized = normalizeHookDefinition(def);
      if (normalized) survivors.push(normalized);
    }
    if (survivors.length > 0) out[event as keyof HooksConfiguration] = survivors;
  }
  return out;
};

export const mergeHooks = (
  ...layers: (HooksConfiguration | undefined)[]
): Record<string, HookDefinition[]> => {
  const result: Record<string, HookDefinition[]> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [event, defs] of Object.entries(layer)) {
      if (!defs) continue;
      for (const def of defs) {
        const normalized = normalizeHookDefinition(def);
        if (!normalized) continue;
        if (!result[event]) result[event] = [];
        result[event].push(normalized);
      }
    }
  }
  return result;
};

export const loadPromptFile = async (
  context: Context,
  filePath: string,
): Promise<PromptLayerData | undefined> => {
  const basePath = filePath.replace(/\.(ts|md)$/, "");
  const tsPath = `${basePath}.ts`;
  const appendMdPath = `${basePath}.append.md`;
  const mdPath = `${basePath}.md`;

  // check for .ts (highest priority)
  if (existsSync(tsPath)) {
    try {
      const module = (await import(tsPath)) as ConfigModule<
        PromptLayerData | ((context: Context) => Promise<PromptLayerData> | PromptLayerData)
      >;
      const config = module.default;

      // handle functions
      let data: PromptLayerData | undefined;
      if (typeof config === "function") {
        const fn = config as (context: Context) => Promise<PromptLayerData> | PromptLayerData;
        data = await fn(context);
      } else if (config) {
        data = config as PromptLayerData;
      }
      if (!data) return undefined;
      if (data.enabled === false) {
        log.info("PROMPT_LOADER", `${tsPath} is disabled (enabled: false); skipping.`);
        return undefined;
      }
      return data;
    } catch (error) {
      const msg = formatConfigError(error, "global", undefined, tsPath);
      log.error("PROMPT_LOADER", msg);
      return undefined;
    }
  }

  // check for .append.md (second priority)
  if (existsSync(appendMdPath)) {
    try {
      const content = readFileSync(appendMdPath, "utf8");
      return { content, mode: "append" };
    } catch (error) {
      const msg = formatConfigError(error, "global", undefined, appendMdPath);
      log.error("PROMPT_LOADER", msg);
      return undefined;
    }
  }

  // fallback to .md (lowest priority)
  if (existsSync(mdPath)) {
    try {
      const content = readFileSync(mdPath, "utf8");
      return { content, mode: "override" };
    } catch (error) {
      const msg = formatConfigError(error, "global", undefined, mdPath);
      log.error("PROMPT_LOADER", msg);
      return undefined;
    }
  }

  return undefined;
};

export const mergePrompts = (...layers: (PromptLayerData | undefined)[]) => {
  // find the last override layer
  let lastOverrideIndex = -1;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer && layer.mode === "override") {
      lastOverrideIndex = i;
      break;
    }
  }

  // use layers from that point onward
  const startIndex = lastOverrideIndex >= 0 ? lastOverrideIndex : 0;
  const parts: string[] = [];

  for (let i = startIndex; i < layers.length; i++) {
    const layer = layers[i];
    if (layer) {
      parts.push(layer.content);
    }
  }

  return parts.join("\n\n");
};

export type ConfigModule<T> = {
  default: T | ((context: Context) => Promise<T> | T);
};

// Loads a single config file from a specific layer (global, preset, or project).
// Used by loadConfigFromLayers to load the SAME file from all layers.
// Note: Commands and agents bypass this and use loadPromptFile directly.
// Only system/user prompts and other configs (hooks, settings, mcps) use this.
export const loadConfigLayer = async <T>(
  context: Context,
  layer: "global" | "preset" | "project",
  name: string | undefined,
  file: string,
) => {
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);

  // compute config file path
  let configPath: string;
  switch (layer) {
    case "global": {
      configPath = join(configBase, "global", file);
      break;
    }
    case "preset": {
      if (!name) return undefined;
      configPath = join(configBase, "presets", name, file);
      break;
    }
    case "project": {
      if (!name) return undefined;
      configPath = join(configBase, "projects", name, file);
      break;
    }
    default: {
      throw new Error(`Invalid layer: ${layer}`);
    }
  }

  // system/user prompts
  if (file.startsWith("prompts/")) {
    return (await loadPromptFile(context, configPath)) as T | undefined;
  }

  // other configs (hooks, settings, mcps) only support .ts
  const tsPath = file.endsWith(".ts") ? configPath : `${configPath}.ts`;
  if (!existsSync(tsPath)) return undefined;

  // load config module
  try {
    const module = (await import(tsPath)) as ConfigModule<T>;
    const config = module.default;

    // handle functions
    if (typeof config === "function") {
      const fn = config as (context: Context) => Promise<T> | T;
      return await fn(context);
    }

    return config as T;
  } catch (error) {
    const msg = formatConfigError(error, layer, name, tsPath);
    log.error("LOADER", msg);
    return undefined;
  }
};

// loads the same config file from all layers (global, presets, project)
export const loadConfigFromLayers = async <T>(
  context: Context,
  file: string,
): Promise<{ global?: T; presets: T[]; project?: T }> => {
  // load global
  const global = await loadConfigLayer<T>(context, "global", undefined, file);

  // load presets
  const presets: T[] = [];
  for (const preset of context.project.presets) {
    const config = await loadConfigLayer<T>(context, "preset", preset.name, file);
    if (config) {
      presets.push(config);
    }
  }

  // load project
  const project =
    context.project.projectConfig ?
      await loadConfigLayer<T>(context, "project", context.project.projectConfig.name, file)
    : undefined;

  return { global, presets, project };
};
