import type { Context } from "@/context/Context";
import type { HooksConfiguration } from "./hooks";
import type { MCPServers } from "./mcps";
import type { ClaudeSettings } from "@/config/schema";

export type PromptFunction = (context: Context) => Promise<string> | string;

export interface PresetConfig {
  name: string;
  matcher: (context: Context) => boolean;
  settings?: Partial<ClaudeSettings>;
  systemPrompt?: PromptFunction;
  userPrompt?: PromptFunction;
  hooks?: HooksConfiguration;
  mcps?: MCPServers;
}
