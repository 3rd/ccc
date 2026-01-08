import { ChildProcess, spawn } from "child_process";
import { EventSource } from "eventsource";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  MCPCompletionResponse,
  MCPInitializeResponse,
  MCPPrompt,
  MCPPromptGetResponse,
  MCPPromptsListResponse,
  MCPResource,
  MCPResourceReadResponse,
  MCPResourcesListResponse,
  MCPTool,
  MCPToolCallResponse,
  MCPToolsListResponse,
} from "@/types/mcp-protocol";
import type { ClaudeMCPConfig, HttpMCPConfig, SseMCPConfig, StdioMCPConfig } from "@/types/mcps";
import { isHttpMCP, isSseMCP, isStdioMCP } from "@/types/mcps";
import { log } from "@/utils/log";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

interface ReconnectConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

const isConnectionError = (error: Error): boolean => {
  const connectionErrors = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "ENOTFOUND",
    "Process exited",
    "SSE connection error",
  ];
  return connectionErrors.some((e) => error.message.includes(e));
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class MCPClient {
  private requestId = 0;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private process?: ChildProcess;
  private eventSource?: EventSource;
  private buffer = "";
  private readonly REQUEST_TIMEOUT = 30_000;
  private readonly config: ClaudeMCPConfig;

  // reconnection state
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private isConnected = false;

  constructor(config: ClaudeMCPConfig, reconnectConfig?: Partial<ReconnectConfig>) {
    this.config = config;
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
  }

  async connect(): Promise<void> {
    if (isStdioMCP(this.config)) {
      await this.connectStdio(this.config);
    } else if (isHttpMCP(this.config)) {
      log.debug("MCP_CLIENT", "HTTP transport ready");
      this.isConnected = true;
    } else if (isSseMCP(this.config)) {
      await this.connectSSE(this.config);
    } else {
      throw new Error("Unknown MCP transport type");
    }
    this.reconnectAttempts = 0;
  }

  private getReconnectDelay(): number {
    const exponentialDelay = this.reconnectConfig.baseDelayMs * 2 ** this.reconnectAttempts;
    const cappedDelay = Math.min(exponentialDelay, this.reconnectConfig.maxDelayMs);
    const jitter = cappedDelay * 0.25 * Math.random();
    return cappedDelay + jitter;
  }

  private async attemptReconnect(): Promise<boolean> {
    if (this.isReconnecting) return false;
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      log.error("MCP_CLIENT", `Max reconnect attempts (${this.reconnectConfig.maxAttempts}) reached`);
      return false;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = this.getReconnectDelay();
    log.info(
      "MCP_CLIENT",
      `Reconnect attempt ${this.reconnectAttempts}/${this.reconnectConfig.maxAttempts} in ${Math.round(delay)}ms`,
    );

    await sleep(delay);

    try {
      // clean up
      this.cleanupConnection();
      await this.connect();
      log.info("MCP_CLIENT", "Reconnection successful");
      this.isReconnecting = false;
      return true;
    } catch (error) {
      log.error("MCP_CLIENT", `Reconnect attempt ${this.reconnectAttempts} failed: ${error}`);
      this.isReconnecting = false;
      return this.attemptReconnect();
    }
  }

  private cleanupConnection(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.buffer = "";
    this.isConnected = false;
  }

  private async connectStdio(config: StdioMCPConfig): Promise<void> {
    this.process = spawn(config.command, config.args || [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleStdioData(data);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      log.debug("MCP_CLIENT", `stderr: ${data.toString()}`);
    });

    this.process.on("error", (error) => {
      log.error("MCP_CLIENT", `Process error: ${error.message}`);
      this.handleConnectionError(error);
    });

    this.process.on("exit", (code) => {
      log.debug("MCP_CLIENT", `Process exited with code ${code}`);
      this.handleConnectionError(new Error(`Process exited with code ${code}`));
    });

    this.isConnected = true;
  }

  private handleStdioData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JsonRpcResponse;
          this.handleResponse(message);
        } catch {
          log.debug("MCP_CLIENT", `Failed to parse response: ${line}`);
        }
      }
    }
  }

  private async connectSSE(config: SseMCPConfig): Promise<void> {
    if (config.headers && Object.keys(config.headers).length > 0) {
      log.warn("MCP_CLIENT", "SSE transport doesn't support custom headers. Headers will be ignored.");
    }
    this.eventSource = new EventSource(config.url);

    this.eventSource.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data) as JsonRpcResponse;
        this.handleResponse(message);
      } catch (error) {
        log.debug("MCP_CLIENT", `Failed to parse SSE message: ${error}`);
      }
    });

    this.eventSource.addEventListener("error", (error) => {
      log.error("MCP_CLIENT", `SSE error: ${error}`);
      this.handleConnectionError(new Error("SSE connection error"));
    });

    this.isConnected = true;
  }

  private handleConnectionError(error: Error): void {
    this.isConnected = false;

    if (isConnectionError(error)) {
      this.attemptReconnect().catch((reconnectError: unknown) => {
        log.error("MCP_CLIENT", `Reconnection failed: ${reconnectError}`);
      });
    }

    this.rejectAllPending(error);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const { id, error, result } = response;
    if (id === undefined || id === null) return;

    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(id);

    if (error) {
      pending.reject(new Error(error.message));
    } else {
      pending.resolve(result);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private async sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
    };
    if (params !== undefined) {
      request.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      this.sendMessage(request).catch(reject);
    });
  }

  private async sendMessage(request: JsonRpcRequest): Promise<void> {
    if (isStdioMCP(this.config)) {
      if (!this.process?.stdin) {
        throw new Error("Stdio process not connected");
      }
      const message = JSON.stringify(request);
      this.process.stdin.write(`${message}\n`);
    } else if (isHttpMCP(this.config)) {
      await this.sendHttpRequest(this.config, request);
    } else if (isSseMCP(this.config)) {
      throw new Error("SSE transport doesn't support request/response");
    }
  }

  private async sendHttpRequest(config: HttpMCPConfig, request: JsonRpcRequest): Promise<void> {
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...config.headers,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonResponse = (await response.json()) as JsonRpcResponse;
      this.handleResponse(jsonResponse);
    } catch (error) {
      const pending = this.pendingRequests.get(request.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(request.id);
        pending.reject(error as Error);
      }
    }
  }

  async initialize(): Promise<MCPInitializeResponse> {
    return this.sendRequest<MCPInitializeResponse>("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {
        roots: {
          listChanged: true,
        },
        sampling: {},
      },
      clientInfo: {
        name: "mcp-filter-proxy",
        version: "1.0.0",
      },
    });
  }

  async sendInitialized(): Promise<void> {
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    await this.sendMessage(notification as JsonRpcRequest);
  }

  async listTools(cursor?: string): Promise<MCPTool[]> {
    const response = await this.sendRequest<MCPToolsListResponse>(
      "tools/list",
      cursor ? { cursor } : undefined,
    );
    return response.tools || [];
  }

  async callTool(name: string, args?: unknown): Promise<MCPToolCallResponse> {
    const response = await this.sendRequest<MCPToolCallResponse>("tools/call", {
      name,
      arguments: args,
    });
    return response;
  }

  async listResources(cursor?: string): Promise<MCPResource[]> {
    const response = await this.sendRequest<MCPResourcesListResponse>(
      "resources/list",
      cursor ? { cursor } : undefined,
    );
    return response.resources || [];
  }

  async readResource(uri: string): Promise<MCPResourceReadResponse> {
    return this.sendRequest<MCPResourceReadResponse>("resources/read", { uri });
  }

  async listPrompts(cursor?: string): Promise<MCPPrompt[]> {
    const response = await this.sendRequest<MCPPromptsListResponse>(
      "prompts/list",
      cursor ? { cursor } : undefined,
    );
    return response.prompts || [];
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptGetResponse> {
    return this.sendRequest<MCPPromptGetResponse>("prompts/get", {
      name,
      arguments: args,
    });
  }

  async complete(
    ref: { type: "ref/prompt" | "ref/resource"; name?: string; uri?: string },
    argument: { name: string; value: string },
  ): Promise<MCPCompletionResponse> {
    return this.sendRequest<MCPCompletionResponse>("completion/complete", {
      ref,
      argument,
    });
  }

  disconnect(): void {
    this.reconnectAttempts = this.reconnectConfig.maxAttempts;

    this.cleanupConnection();
    this.rejectAllPending(new Error("Client disconnected"));
  }

  getConnectionStatus(): { connected: boolean; reconnecting: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  async reconnect(): Promise<boolean> {
    this.reconnectAttempts = 0;
    return this.attemptReconnect();
  }
}
