import { existsSync } from "fs";
import { join } from "path";
import { getBuiltinHookCommands } from "@/hooks/builtin";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookDefinition, HooksConfiguration } from "@/types/hooks";
import { loadConfigFromLayers, mergeHooks, mergePrompts, mergeSettings } from "@/config/layers";
import { validateSettings } from "@/config/schema";

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

  const result = {
    ...transformedValidated,
    hooks: finalHooks,
    outputStyle: "custom" as const,
    ...(statusLine && { statusLine }),
  };

  return result;
};

export const buildSystemPrompt = async (context: Context) => {
  const layers = await loadConfigFromLayers<PromptLayerData>(context, "prompts/system");
  return mergePrompts(layers.global, ...layers.presets, layers.project);
};

export const buildUserPrompt = async (context: Context) => {
  const layers = await loadConfigFromLayers<PromptLayerData>(context, "prompts/user");
  return mergePrompts(layers.global, ...layers.presets, layers.project);
};
