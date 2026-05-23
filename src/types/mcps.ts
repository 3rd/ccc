import type { FastMCP } from "fastmcp";
import type { Context } from "@/context/Context";

export type MCPToolFilter = (tool: { name: string; description?: string; [key: string]: unknown }) => boolean;

/**
 * Build-time gate shared across MCP config shapes. When `false`, CCC skips
 * registering this MCP server. Defaults to `true`. Stripped from emitted config.
 */
export interface MCPEnabledFlag {
  enabled?: boolean;
}

export interface StdioMCPConfig extends MCPEnabledFlag {
  type?: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  filter?: MCPToolFilter;
  autoEnable?: string;
  // always include this server's tools in the prompt; never defer behind tool search (v2.1.121)
  alwaysLoad?: boolean;
}

export interface HttpMCPConfig extends MCPEnabledFlag {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  timeout?: number;
  filter?: MCPToolFilter;
  autoEnable?: string;
  alwaysLoad?: boolean;
}

export interface SseMCPConfig extends MCPEnabledFlag {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  timeout?: number;
  filter?: MCPToolFilter;
  autoEnable?: string;
  alwaysLoad?: boolean;
}

export type ClaudeMCPConfig = HttpMCPConfig | SseMCPConfig | StdioMCPConfig;

export type FastMCPFactory = (context: Context) => FastMCP | Promise<FastMCP>;

export type MCPLayerData =
  | { type: "http"; config: HttpMCPConfig; enabled?: boolean }
  | { type: "inline"; config: FastMCPFactory; enabled?: boolean }
  | { type: "sse"; config: SseMCPConfig; enabled?: boolean }
  | { type: "traditional"; config: StdioMCPConfig; enabled?: boolean };

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

/**
 * True when a wrapped MCP entry is gated off — either at the wrapper level or
 * (for non-inline transports) inside its `config`. Shared by `buildMCPs` and
 * any other consumer that needs to honor the `enabled: false` flag.
 */
export const isMCPLayerDisabled = (layerData: MCPLayerData): boolean => {
  if (layerData.enabled === false) return true;
  if (layerData.type !== "inline" && layerData.config?.enabled === false) return true;
  return false;
};
