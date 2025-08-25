import type { Context } from "@/context/Context";
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
import type { ClaudeSettings } from "@/types/settings";
import type { StatusLineInput } from "@/types/statusline";
import { isHttpMCP, isSseMCP } from "@/types/mcps";

export { createMCP } from "@/mcps/mcp-generator";

export interface PromptLayerData {
  content: string;
  mode: "append" | "override";
}

export const createPrompt = (promptFn: PromptFunction) => {
  return async (context: Context): Promise<PromptLayerData> => {
    const content = await promptFn(context);
    return { content, mode: "override" };
  };
};

export const createAppendPrompt = (promptFn: PromptFunction) => {
  return async (context: Context): Promise<PromptLayerData> => {
    const content = await promptFn(context);
    return { content, mode: "append" };
  };
};

export const createCommand = createPrompt;
export const createAppendCommand = createAppendPrompt;

export const createAgent = createPrompt;
export const createAppendAgent = createAppendPrompt;

export const createStatusline = (fn: (data: StatusLineInput) => Promise<void> | void) => fn;

export const createConfigHooks = (hooksConfig: HooksConfiguration): HooksConfiguration => {
  return hooksConfig;
};

export const createConfigMCPs = (mcpsConfig: Record<string, ClaudeMCPConfig | MCPLayerData>): MCPServers => {
  const result: MCPServers = {};

  for (const [name, config] of Object.entries(mcpsConfig)) {
    if ("type" in config && "config" in config) {
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

export interface PresetDefinition {
  name: string;
  matcher: (context: Context) => boolean;
}

export const createPreset = (definition: PresetDefinition): PresetConfig => {
  return {
    name: definition.name,
    matcher: definition.matcher,
  };
};
