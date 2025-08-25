import { existsSync } from "fs";
import { join } from "path";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookCommand } from "@/types/hooks";
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

  // hooks
  const hookLayers = await loadConfigFromLayers<Record<string, HookCommand[]>>(context, "hooks.ts");
  const hooks = mergeHooks(hookLayers.global, ...hookLayers.presets, hookLayers.project);

  const result = {
    ...transformedValidated,
    hooks,
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
