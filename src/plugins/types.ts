import type { z } from "zod";
import type { HooksConfiguration } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import type { PluginContext } from "./context";
import type { PluginManifest } from "./schema";
import type { StateType } from "./state";

export interface PromptLayerData {
  content: string;
  mode: "append" | "override";
}

export type PromptConfig = PromptLayerData | string;
export type CommandConfig = PromptLayerData;
export type AgentConfig = PromptLayerData;

export interface PluginDefinition<S = Record<string, unknown>> {
  settingsSchema?: z.ZodType<S>;
  stateType?: StateType;

  // components
  hooks?: (context: PluginContext<S>) => HooksConfiguration;
  mcps?: (context: PluginContext<S>) => MCPServers;
  commands?: (context: PluginContext<S>) => Record<string, CommandConfig>;
  agents?: (context: PluginContext<S>) => Record<string, AgentConfig>;
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
    mcps: string[];
    hooks: Record<string, number>;
    prompts: { system: boolean; user: boolean };
  };
}
