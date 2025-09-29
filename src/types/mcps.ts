import type { FastMCP } from "fastmcp";
import type { Context } from "@/context/Context";

export type MCPToolFilter = (tool: { name: string; description?: string; [key: string]: unknown }) => boolean;

export interface StdioMCPConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  filter?: MCPToolFilter;
}

export interface HttpMCPConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  filter?: MCPToolFilter;
}

export interface SseMCPConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  filter?: MCPToolFilter;
}

export type ClaudeMCPConfig = HttpMCPConfig | SseMCPConfig | StdioMCPConfig;

export type FastMCPFactory = (context: Context) => FastMCP | Promise<FastMCP>;

export type MCPLayerData =
  | { type: "http"; config: HttpMCPConfig }
  | { type: "inline"; config: FastMCPFactory }
  | { type: "sse"; config: SseMCPConfig }
  | { type: "traditional"; config: StdioMCPConfig };

export type MCPServers = Record<string, MCPLayerData>;

export const isStdioMCP = (config: ClaudeMCPConfig): config is StdioMCPConfig => {
  return !("type" in config) || config.type === "stdio";
};

export const isHttpMCP = (config: ClaudeMCPConfig): config is HttpMCPConfig => {
  return "type" in config && config.type === "http";
};

export const isSseMCP = (config: ClaudeMCPConfig): config is SseMCPConfig => {
  return "type" in config && config.type === "sse";
};
