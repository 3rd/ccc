import type { PluginsConfig } from "@/config/plugins";
import type { ClaudeSettings } from "@/config/schema";
import type { Context } from "@/context/Context";
import type { PluginDefinition } from "@/plugins/types";
import type { HooksConfiguration } from "@/types/hooks";
import type {
  ClaudeMCPConfig,
  HttpMCPConfig,
  MCPLayerData,
  MCPServers,
  SseMCPConfig,
  StdioMCPConfig,
} from "@/types/mcps";
import type { PresetConfig, PromptFunction } from "@/types/presets";
import type { SkillDefinition, SkillDefinitionFactory } from "@/types/skills";
import type { StatusLineInput } from "@/types/statusline";
import type {
  WorkflowArgsSchema,
  WorkflowDefinitionInput,
  WorkflowDefinitionInputWithoutSchema,
  WorkflowDefinitionInputWithSchema,
} from "@/types/workflows";
import { isHttpMCP, isSseMCP } from "@/types/mcps";

export { createMCP } from "@/mcps/mcp-generator";
export { createProject } from "@/config/create-project";
export { getSessionContext, type SessionContext } from "@/hooks/session-context";

export interface PromptLayerData {
  content: string;
  mode: "append" | "override";
  /**
   * Build-time gate. When `false`, CCC drops this prompt layer entirely:
   * commands/agents are not emitted; user/system prompts are not appended/overridden.
   * Defaults to `true`. Not written to any output file.
   */
  enabled?: boolean;
}

export interface PromptOptions {
  handler: PromptFunction;
  enabled?: boolean;
}

const isPromptOptions = (value: PromptFunction | PromptOptions): value is PromptOptions => {
  return typeof value === "object" && value !== null && "handler" in value;
};

const buildPromptFactory = (mode: PromptLayerData["mode"]) => {
  function factory(promptFn: PromptFunction): (context: Context) => Promise<PromptLayerData>;
  function factory(options: PromptOptions): (context: Context) => Promise<PromptLayerData>;
  function factory(
    input: PromptFunction | PromptOptions,
  ): (context: Context) => Promise<PromptLayerData> {
    if (isPromptOptions(input)) {
      const { handler, enabled } = input;
      return async (context: Context): Promise<PromptLayerData> => {
        if (enabled === false) return { content: "", mode, enabled: false };
        const content = await handler(context);
        return { content, mode };
      };
    }
    return async (context: Context): Promise<PromptLayerData> => {
      const content = await input(context);
      return { content, mode };
    };
  }
  return factory;
};

export const createPrompt = buildPromptFactory("override");
export const createAppendPrompt = buildPromptFactory("append");

export const createCommand = createPrompt;
export const createAppendCommand = createAppendPrompt;

export const createAgent = createPrompt;
export const createAppendAgent = createAppendPrompt;

export const createSkill = (
  definition: SkillDefinition | SkillDefinitionFactory,
): SkillDefinition | SkillDefinitionFactory => {
  return definition;
};

export function createWorkflow<const TSchema extends WorkflowArgsSchema, T extends object>(
  definition: WorkflowDefinitionInputWithSchema<T, TSchema>,
): WorkflowDefinitionInputWithSchema<T, TSchema>;
export function createWorkflow<T extends object>(
  definition: WorkflowDefinitionInputWithoutSchema<T>,
): WorkflowDefinitionInputWithoutSchema<T>;
export function createWorkflow(definition: WorkflowDefinitionInput): WorkflowDefinitionInput {
  return definition;
}

export const createStatusline = (fn: (data: StatusLineInput) => Promise<void> | void) => fn;

export const createConfigHooks = (hooksConfig: HooksConfiguration): HooksConfiguration => {
  return hooksConfig;
};

const isMCPLayerData = (value: ClaudeMCPConfig | MCPLayerData): value is MCPLayerData => {
  return "type" in value && "config" in value;
};

/**
 * True when an authored MCP entry is gated off. Recognizes the flag on:
 *   - the outer MCPLayerData wrapper
 *   - the inner ClaudeMCPConfig of non-inline wrappers
 *   - the inline ClaudeMCPConfig (when authored as a raw config, not wrapped)
 *
 * Mirrored by `isLayerDisabled` in `build-mcps.ts` which runs after merge as
 * a safety net for entries that didn't pass through this helper (raw exports,
 * plugin contributions).
 */
const isMCPDisabled = (value: ClaudeMCPConfig | MCPLayerData): boolean => {
  if (isMCPLayerData(value)) {
    if (value.enabled === false) return true;
    if (value.type !== "inline" && value.config.enabled === false) return true;
    return false;
  }
  return value.enabled === false;
};

export const createConfigMCPs = (mcpsConfig: Record<string, ClaudeMCPConfig | MCPLayerData>): MCPServers => {
  const result: MCPServers = {};

  for (const [name, config] of Object.entries(mcpsConfig)) {
    if (isMCPDisabled(config)) continue;

    if (isMCPLayerData(config)) {
      result[name] = config;
    } else if (isHttpMCP(config)) {
      result[name] = {
        type: "http",
        config: config as HttpMCPConfig,
      };
    } else if (isSseMCP(config)) {
      result[name] = {
        type: "sse",
        config: config as SseMCPConfig,
      };
    } else {
      result[name] = {
        type: "traditional",
        config: config as StdioMCPConfig,
      };
    }
  }

  return result;
};

export const createConfigSettings = (settingsConfig: Partial<ClaudeSettings>): Partial<ClaudeSettings> => {
  return settingsConfig;
};

export const createConfigFullSettings = (settingsConfig: ClaudeSettings): ClaudeSettings => {
  return settingsConfig;
};

export const createConfigPlugins = (pluginsConfig: PluginsConfig): PluginsConfig => {
  return pluginsConfig;
};

export interface PresetDefinition {
  name: string;
  matcher: (context: Context) => boolean;
  /**
   * Build-time gate. When `false`, CCC skips this preset before evaluating
   * its matcher or loading any of its components. Defaults to `true`.
   */
  enabled?: boolean;
}

export const createPreset = (definition: PresetDefinition): PresetConfig => {
  return {
    name: definition.name,
    matcher: definition.matcher,
    enabled: definition.enabled,
  };
};

export const createPlugin = <S = Record<string, unknown>>(
  definition: PluginDefinition<S>,
): PluginDefinition<S> => {
  return definition;
};
