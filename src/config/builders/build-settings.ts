import { existsSync } from "fs";
import { join } from "path";
import { batchHookDefinitionsForEvent, type SourcedHookDefinition } from "@/hooks/batching";
import { getBuiltinHookCommands } from "@/hooks/builtin";
import { setInternalHookCommandSource } from "@/hooks/hook-generator";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookDefinition, HooksConfiguration } from "@/types/hooks";
import { loadConfigFromLayers, mergeHooks, mergePrompts, mergeSettings } from "@/config/layers";
import { validateSettings } from "@/config/schema";
import { getPluginHooks, getPluginPrompts } from "@/plugins/registry";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { buildInlineEnvCommandPrefix } from "@/utils/shell-command";
import { applyProfile, getActiveProfileName, mergeProfiles } from "./resolve-profile";

type ProfileMap = Record<string, Record<string, unknown>>;

const extractLayerProfiles = (layer: Record<string, unknown> | undefined): ProfileMap | undefined => {
  if (!layer || typeof layer.profiles !== "object" || !layer.profiles) return undefined;
  return layer.profiles as ProfileMap;
};

export const buildSettings = async (context: Context) => {
  const layers = await loadConfigFromLayers<Record<string, unknown>>(context, "settings.ts");

  // merge profiles by name across all layers before the main merge
  const allProfiles = mergeProfiles(
    extractLayerProfiles(layers.global),
    ...layers.presets.map(extractLayerProfiles),
    extractLayerProfiles(layers.project),
  );

  // standard layer merge (profiles included but will be stripped)
  const merged = mergeSettings(layers.global, ...layers.presets, layers.project);
  const { profiles: _profiles, ...baseSettings } = merged;

  // apply active profile if --profile was specified
  const profileName = getActiveProfileName();
  const effectiveSettings = profileName ? applyProfile(baseSettings, profileName, allProfiles) : baseSettings;

  const validated = validateSettings(effectiveSettings);

  // model: "auto" -> undefined
  const transformedValidated = { ...validated };
  if (transformedValidated.model === "auto") {
    transformedValidated.model = undefined;
  }

  // statusline - check for config/global/statusline.ts or use settings.statusLine
  let statusLine: { type: "command"; command: string; padding?: number } | undefined;

  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);
  const statuslineConfigPath = join(configBase, "global/statusline.ts");
  const statuslineScriptPath = join(context.launcherDirectory, "src/cli/statusline.ts");
  const statuslineEnvPrefix = buildInlineEnvCommandPrefix({
    CCC_CONFIG_DIR: configBase,
  });

  if (existsSync(statuslineConfigPath)) {
    statusLine = {
      type: "command",
      command: `${statuslineEnvPrefix} bun --config=/dev/null "${statuslineScriptPath}"`,
    };
  } else if (transformedValidated.statusLine) {
    statusLine = transformedValidated.statusLine;
  }

  // hooks: merge config hooks by definitions and prepend built-in recorder hooks reliably
  const hookLayers = await loadConfigFromLayers<HooksConfiguration>(context, "hooks.ts");
  const configHooks = mergeHooks(hookLayers.global, ...hookLayers.presets, hookLayers.project);
  const builtinHooks = getBuiltinHookCommands();
  const withSource = (
    definition: HookDefinition,
    source: SourcedHookDefinition["source"],
  ): SourcedHookDefinition => {
    return { ...definition, source };
  };

  const finalHooks: Record<string, HookDefinition[]> = {};
  const sourcedFinalHooks: Record<string, SourcedHookDefinition[]> = {};

  // builtin hooks
  for (const [eventName, command] of Object.entries(builtinHooks)) {
    const defs = configHooks[eventName] || [];
    sourcedFinalHooks[eventName] = [
      { source: "builtin", hooks: [command] },
      ...defs.map((def) => withSource(def, "config")),
    ];
  }

  // config hooks
  for (const [eventName, defs] of Object.entries(configHooks)) {
    if (!sourcedFinalHooks[eventName]) {
      sourcedFinalHooks[eventName] = defs.map((def) => withSource(def, "config"));
    }
  }

  // plugin hooks
  const pluginHooks = getPluginHooks(context.loadedPlugins);
  for (const [eventName, defs] of Object.entries(pluginHooks)) {
    if (!sourcedFinalHooks[eventName]) {
      sourcedFinalHooks[eventName] = [];
    }
    sourcedFinalHooks[eventName]!.push(...defs.map((def) => withSource(def, "plugin")));
  }

  for (const [eventName, defs] of Object.entries(sourcedFinalHooks)) {
    for (const definition of defs) {
      for (const hook of definition.hooks) {
        if (hook.type === "command") {
          setInternalHookCommandSource(hook, definition.source);
        }
      }
    }

    finalHooks[eventName] = batchHookDefinitionsForEvent(defs);
  }

  const result = {
    ...transformedValidated,
    hooks: finalHooks,
    ...(statusLine && { statusLine }),
    _profileName: profileName,
    _availableProfiles: allProfiles,
  };

  return result;
};

// extract content from PromptConfig (both string and PromptLayerData)
const getPromptContent = (config: { content: string } | string) => {
  return typeof config === "string" ? config : config.content;
};

export const buildSystemPrompt = async (context: Context) => {
  const layers = await loadConfigFromLayers<PromptLayerData>(context, "prompts/system");
  const basePrompt = mergePrompts(layers.global, ...layers.presets, layers.project);

  const pluginPrompts = getPluginPrompts(context.loadedPlugins);
  if (pluginPrompts.system.length > 0) {
    const pluginContent = pluginPrompts.system.map(getPromptContent).join("\n\n");
    return basePrompt ? `${basePrompt}\n\n${pluginContent}` : pluginContent;
  }

  return basePrompt;
};

export const buildUserPrompt = async (context: Context) => {
  const layers = await loadConfigFromLayers<PromptLayerData>(context, "prompts/user");
  const basePrompt = mergePrompts(layers.global, ...layers.presets, layers.project);

  const pluginPrompts = getPluginPrompts(context.loadedPlugins);
  if (pluginPrompts.user.length > 0) {
    const pluginContent = pluginPrompts.user.map(getPromptContent).join("\n\n");
    return basePrompt ? `${basePrompt}\n\n${pluginContent}` : pluginContent;
  }

  return basePrompt;
};
