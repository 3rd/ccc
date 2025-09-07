import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookDefinition, HooksConfiguration } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
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
        if (value !== undefined) result[key] = value;
      }
    }
  }
  return result;
};

export const mergeHooks = (
  ...layers: (HooksConfiguration | undefined)[]
): Record<string, HookDefinition[]> => {
  const result: Record<string, HookDefinition[]> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [event, defs] of Object.entries(layer)) {
      if (!defs) continue;
      if (!result[event]) result[event] = [];
      result[event].push(...defs);
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
      if (typeof config === "function") {
        const fn = config as (context: Context) => Promise<PromptLayerData> | PromptLayerData;
        return await fn(context);
      }

      return config as PromptLayerData;
    } catch (error) {
      log.error("PROMPT_LOADER", `Failed to load .ts prompt from ${tsPath}:`, error);
      return undefined;
    }
  }

  // check for .append.md (second priority)
  if (existsSync(appendMdPath)) {
    try {
      const content = readFileSync(appendMdPath, "utf8");
      return { content, mode: "append" };
    } catch (error) {
      log.error("PROMPT_LOADER", `Failed to load .append.md prompt from ${appendMdPath}:`, error);
      return undefined;
    }
  }

  // fallback to .md (lowest priority)
  if (existsSync(mdPath)) {
    try {
      const content = readFileSync(mdPath, "utf8");
      return { content, mode: "override" };
    } catch (error) {
      log.error("PROMPT_LOADER", `Failed to load .md prompt from ${mdPath}:`, error);
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
  const launcherRoot = context.launcherDirectory;

  // compute config file path
  let configPath: string;
  switch (layer) {
    case "global": {
      configPath = join(launcherRoot, context.configDirectory, "global", file);
      break;
    }
    case "preset": {
      if (!name) return undefined;
      configPath = join(launcherRoot, context.configDirectory, "presets", name, file);
      break;
    }
    case "project": {
      if (!name) return undefined;
      configPath = join(launcherRoot, context.configDirectory, "projects", name, file);
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
    log.error("LOADER", `Failed to load ${layer} config from ${tsPath}:`, error);
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
