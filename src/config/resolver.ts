import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookCommand } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import { loadConfigFromLayers, mergeHooks, mergeMCPs, mergePrompts, mergeSettings } from "./layers";

export interface ResolvedConfig {
  settings: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  hooks: Record<string, HookCommand[]>;
  mcps: MCPServers;
}

// loads config from all layers
export const resolveConfig = async (context: Context): Promise<ResolvedConfig> => {
  const [settings, systemPrompts, userPrompts, hooks, mcps] = await Promise.all([
    loadConfigFromLayers<Record<string, unknown>>(context, "settings.ts"),
    loadConfigFromLayers<PromptLayerData>(context, "prompts/system"),
    loadConfigFromLayers<PromptLayerData>(context, "prompts/user"),
    loadConfigFromLayers<Record<string, HookCommand[]>>(context, "hooks.ts"),
    loadConfigFromLayers<MCPServers>(context, "mcps.ts"),
  ]);

  return {
    settings: mergeSettings(settings.global, ...settings.presets, settings.project),
    systemPrompt: mergePrompts(systemPrompts.global, ...systemPrompts.presets, systemPrompts.project),
    userPrompt: mergePrompts(userPrompts.global, ...userPrompts.presets, userPrompts.project),
    hooks: mergeHooks(hooks.global, ...hooks.presets, hooks.project),
    mcps: mergeMCPs(mcps.global, ...mcps.presets, mcps.project),
  };
};
