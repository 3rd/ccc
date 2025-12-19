import type { HooksConfiguration, MCPServers } from "@/types";
import type { PromptFunction } from "@/types/presets";
import type { ClaudeSettings } from "@/config/schema";

export interface CreateProjectOptions {
  name: string;
  root: string;
  description?: string;
  disableParentClaudeMds?: boolean;
}

export interface ProjectMetadata {
  name: string;
  root: string;
  description?: string;
  disableParentClaudeMds?: boolean;
}

export type ProjectConfig = {
  name: string;
  settings?: Partial<ClaudeSettings>;
  systemPrompt?: PromptFunction;
  userPrompt?: PromptFunction;
  hooks?: HooksConfiguration;
  mcps?: MCPServers;
  disableParentClaudeMds?: boolean;
};
