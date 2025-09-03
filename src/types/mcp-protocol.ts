export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPInitializeRequest {
  method: "initialize";
  params: {
    protocolVersion: string;
    capabilities: {
      roots?: {
        listChanged?: boolean;
      };
      sampling?: Record<string, unknown>;
    };
    clientInfo: {
      name: string;
      version: string;
    };
  };
}

export interface MCPInitializeResponse {
  protocolVersion: string;
  capabilities: {
    tools?: {
      listChanged?: boolean;
    };
    resources?: {
      subscribe?: boolean;
      listChanged?: boolean;
    };
    prompts?: {
      listChanged?: boolean;
    };
    logging?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface MCPToolsListRequest {
  method: "tools/list";
  params?: {
    cursor?: string;
  };
}

export interface MCPToolsListResponse {
  tools: MCPTool[];
  nextCursor?: string;
}

export interface MCPToolCallRequest {
  method: "tools/call";
  params: {
    name: string;
    arguments?: unknown;
  };
}

export interface MCPToolCallResponse {
  content: {
    type: "image" | "resource" | "text";
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }[];
  isError?: boolean;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourcesListRequest {
  method: "resources/list";
  params?: {
    cursor?: string;
  };
}

export interface MCPResourcesListResponse {
  resources: MCPResource[];
  nextCursor?: string;
}

export interface MCPResourceReadRequest {
  method: "resources/read";
  params: {
    uri: string;
  };
}

export interface MCPResourceReadResponse {
  contents: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }[];
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
}

export interface MCPPromptsListRequest {
  method: "prompts/list";
  params?: {
    cursor?: string;
  };
}

export interface MCPPromptsListResponse {
  prompts: MCPPrompt[];
  nextCursor?: string;
}

export interface MCPPromptGetRequest {
  method: "prompts/get";
  params: {
    name: string;
    arguments?: Record<string, string>;
  };
}

export interface MCPPromptGetResponse {
  description?: string;
  messages: {
    role: "assistant" | "user";
    content: {
      type: "image" | "resource" | "text";
      text?: string;
      data?: string;
      mimeType?: string;
      uri?: string;
    };
  }[];
}

export interface MCPSamplingRequest {
  method: "sampling/createMessage";
  params: {
    messages: {
      role: "assistant" | "user";
      content: {
        type: "text";
        text: string;
      };
    }[];
    modelPreferences?: {
      hints?: {
        name: string;
      }[];
      costPriority?: number;
      speedPriority?: number;
      intelligencePriority?: number;
    };
    systemPrompt?: string;
    includeContext?: "allServers" | "none" | "thisServer";
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
  };
}

export interface MCPSamplingResponse {
  role: "assistant";
  content: {
    type: "text";
    text: string;
  };
  model: string;
  stopReason?: string;
}

export interface MCPCompletionRequest {
  method: "completion/complete";
  params: {
    ref: {
      type: "ref/prompt" | "ref/resource";
      name?: string;
      uri?: string;
    };
    argument: {
      name: string;
      value: string;
    };
  };
}

export interface MCPCompletionResponse {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
}

export interface MCPRoot {
  uri: string;
  name?: string;
}

export interface MCPRootsListRequest {
  method: "roots/list";
}

export interface MCPRootsListResponse {
  roots: MCPRoot[];
}

export interface MCPLogRequest {
  method: "logging/setLevel";
  params: {
    level: "debug" | "error" | "info" | "warning";
  };
}

import type { JSONSchema7 } from "json-schema";
export type JsonSchema = JSONSchema7;

export type MCPTransport = "http" | "sse" | "stdio";
