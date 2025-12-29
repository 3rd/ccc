import { existsSync } from "fs";
import { join } from "path";
import { getBuiltinHookCommands } from "@/hooks/builtin";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookDefinition, HooksConfiguration } from "@/types/hooks";
import { loadConfigFromLayers, mergeHooks, mergePrompts, mergeSettings } from "@/config/layers";
import { validateSettings } from "@/config/schema";
import { getPluginHooks, getPluginPrompts } from "@/plugins/registry";

export const buildSettings = async (context: Context) => {
  const layers = await loadConfigFromLayers<Record<string, unknown>>(context, "settings.ts");
  const merged = mergeSettings(layers.global, ...layers.presets, layers.project);
  const validated = validateSettings(merged);

  // model: "auto" -> undefined
  const transformedValidated = { ...validated };
  if (transformedValidated.model === "auto") {
    transformedValidated.model = undefined;
  }

  // statusline - check for config/global/statusline.ts or use settings.statusLine
  let statusLine: { type: string; command: string } | undefined;

  const statuslineConfigPath = join(context.launcherDirectory, "config/global/statusline.ts");
  const statuslineScriptPath = join(context.launcherDirectory, "src/cli/statusline.ts");

  if (existsSync(statuslineConfigPath)) {
    statusLine = {
      type: "command",
      command: `bun "${statuslineScriptPath}"`,
    };
  } else if (transformedValidated.statusLine) {
    statusLine = transformedValidated.statusLine;
  }

  // hooks: merge config hooks by definitions and prepend built-in recorder hooks reliably
  const hookLayers = await loadConfigFromLayers<HooksConfiguration>(context, "hooks.ts");
  const configHooks = mergeHooks(hookLayers.global, ...hookLayers.presets, hookLayers.project);
  const builtinHooks = getBuiltinHookCommands();

  const finalHooks: Record<string, HookDefinition[]> = {};

  // builtin hooks
  for (const [eventName, command] of Object.entries(builtinHooks)) {
    const defs = configHooks[eventName] || [];
    finalHooks[eventName] = [{ hooks: [command] }, ...defs];
  }

  // config hooks
  for (const [eventName, defs] of Object.entries(configHooks)) {
    if (!finalHooks[eventName]) {
      finalHooks[eventName] = defs;
    }
  }

  // plugin hooks
  const pluginHooks = getPluginHooks(context.loadedPlugins);
  for (const [eventName, defs] of Object.entries(pluginHooks)) {
    if (!finalHooks[eventName]) {
      finalHooks[eventName] = [];
    }
    finalHooks[eventName]!.push(...defs);
  }

  const result = {
    ...transformedValidated,
    hooks: finalHooks,
    ...(statusLine && { statusLine }),
  };

  return result;
};

// extract content from PromptConfig (both string and PromptLayerData)
const getPromptContent = (config: { content: string } | string): string => {
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
