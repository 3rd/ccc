import { existsSync } from "fs";
import { join } from "path";
import type { z } from "zod";
import type { Context } from "@/context/Context";
import type { DiscoveredPlugin } from "./discovery";
import type { PluginEnablementConfig } from "./schema";
import type { LoadedPlugin, PluginDefinition } from "./types";
import { createPluginContext, registerPluginContext } from "./context";
import { normalizeEnablement } from "./schema";

export interface LoaderResult {
  plugins: LoadedPlugin[];
  errors: { plugin: string; error: string }[];
}

const resolveSettings = (
  settingsSchema: z.ZodType | undefined,
  userSettings: Record<string, unknown>,
): Record<string, unknown> => {
  if (!settingsSchema) return userSettings;
  return settingsSchema.parse(userSettings) as Record<string, unknown>;
};

const loadSinglePlugin = async (
  discovered: DiscoveredPlugin,
  context: Context,
  userSettings: Record<string, unknown>,
): Promise<LoadedPlugin> => {
  const { manifest, root } = discovered;

  // resolve entrypoint
  let entryPath = join(root, "index.ts");
  if (!existsSync(entryPath)) {
    entryPath = join(root, "index.js");
  }
  if (!existsSync(entryPath)) {
    throw new Error(`no entry point found (index.ts or index.js) in ${root}`);
  }

  // import
  const module = await import(entryPath);
  const definition: PluginDefinition = module.default;
  if (!definition || typeof definition !== "object") {
    throw new Error(`plugin must export a default PluginDefinition object`);
  }

  // resolve settings
  const settings = resolveSettings(definition.settingsSchema, userSettings);

  // create plugin context
  const pluginContext = createPluginContext(context, manifest, root, settings, definition.stateType);

  // register for inter-plugin communication
  registerPluginContext(manifest.name, pluginContext);

  // emit onLoad
  if (definition.onLoad) {
    await definition.onLoad(pluginContext);
  }

  return {
    manifest,
    root,
    definition,
    enabled: true,
    settings,
    context: pluginContext,
  };
};

export const loadPlugins = async (
  discovered: DiscoveredPlugin[],
  enablement: PluginEnablementConfig,
  context: Context,
): Promise<LoaderResult> => {
  const plugins: LoadedPlugin[] = [];
  const errors: { plugin: string; error: string }[] = [];

  for (const disc of discovered) {
    const name = disc.manifest.name;
    const config = enablement[name];

    // skip if not enabled
    if (config === undefined) continue;
    const { enabled, settings } = normalizeEnablement(config);
    if (!enabled) continue;

    try {
      const loaded = await loadSinglePlugin(disc, context, settings);
      plugins.push(loaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ plugin: name, error: message });
    }
  }

  return { plugins, errors };
};
