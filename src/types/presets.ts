import type { ClaudeSettings } from "@/config/schema";
import type { Context } from "@/context/Context";
import type { HooksConfiguration } from "./hooks";
import type { MCPServers } from "./mcps";

export type PromptFunction = (context: Context) => Promise<string> | string;

export interface PresetConfig {
  name: string;
  matcher: (context: Context) => boolean;
  settings?: Partial<ClaudeSettings>;
  systemPrompt?: PromptFunction;
  userPrompt?: PromptFunction;
  hooks?: HooksConfiguration;
  mcps?: MCPServers;
  /**
   * Build-time gate. When `false`, CCC skips this preset before evaluating
   * its matcher or loading any of its components. Defaults to `true`.
   */
  enabled?: boolean;
}
