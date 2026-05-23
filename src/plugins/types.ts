import type { z } from "zod";
import type { HooksConfiguration } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import type { PluginContext } from "./context";
import type { PluginManifest } from "./schema";
import type { StateType } from "./state";

export interface PromptLayerData {
  content: string;
  mode: "append" | "override";
  /**
   * Build-time gate matching `PromptLayerData` from `@/config/helpers`.
   * Disabled plugin prompts are filtered out by `getPluginPrompts`.
   */
  enabled?: boolean;
}

export type PromptConfig = PromptLayerData | string;
export type CommandConfig = PromptLayerData;
export type AgentConfig = PromptLayerData;
export type WorkflowConfig = string;

export interface PluginDefinition<S = Record<string, unknown>> {
  settingsSchema?: z.ZodType<S>;
  stateType?: StateType;

  /**
   * Build-time gate set by the plugin author. When `false`, the plugin loads
   * (so `onLoad` does NOT run) and is marked disabled — every component
   * registry getter skips it. Distinct from project-level enablement in
   * `createConfigPlugins`, which decides whether to even discover the plugin.
   * Defaults to `true`.
   */
  enabled?: boolean;

  // components
  hooks?: (context: PluginContext<S>) => HooksConfiguration;
  mcps?: (context: PluginContext<S>) => MCPServers;
  commands?: (context: PluginContext<S>) => Record<string, CommandConfig>;
  agents?: (context: PluginContext<S>) => Record<string, AgentConfig>;
  workflows?: (context: PluginContext<S>) => Record<string, WorkflowConfig>;
  prompts?: (context: PluginContext<S>) => {
    system?: PromptConfig;
    user?: PromptConfig;
  };

  // callbacks
  onLoad?: (context: PluginContext<S>) => Promise<void> | void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  root: string;
  definition: PluginDefinition;
  enabled: boolean;
  settings: Record<string, unknown>;
  context: PluginContext;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  root: string;
  components: {
    commands: string[];
    agents: string[];
    workflows: string[];
    mcps: string[];
    hooks: Record<string, number>;
    prompts: { system: boolean; user: boolean };
  };
}
