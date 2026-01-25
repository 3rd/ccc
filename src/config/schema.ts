import { z } from "zod";

export const agentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
  model: z.enum(["sonnet", "opus", "haiku"]).optional(),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

// https://docs.anthropic.com/en/docs/claude-code/settings
export const settingsSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),

  // cli flags
  cli: z
    .object({
      // specify available tools: array of tool names, "default" for all, or empty array to disable
      tools: z.union([z.array(z.string()), z.literal("default")]).optional(),
      // tools to remove from model context entirely (comma-separated in CLI)
      disallowedTools: z.array(z.string()).optional(),
      // tools that execute without permission prompts (comma-separated in CLI)
      allowedTools: z.array(z.string()).optional(),
      // additional working directories for Claude to access
      addDir: z.array(z.string()).optional(),
      // permission mode to start in: "default", "acceptEdits", "plan", "bypassPermissions"
      permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional(),
      // enable verbose logging
      verbose: z.boolean().optional(),
      // enable debug mode with optional category filter (e.g., "api,hooks" or "!statsig")
      debug: z.union([z.boolean(), z.string()]).optional(),
      // enable Chrome browser integration
      chrome: z.boolean().optional(),
      // auto-connect to IDE on startup if available
      ide: z.boolean().optional(),
      // enable verbose LSP logging (logs to ~/.claude/debug/)
      enableLspLogging: z.boolean().optional(),
      // specify agent for the session
      agent: z.string().optional(),
      // custom subagent definitions
      agents: z.record(z.string(), agentDefinitionSchema).optional(),
      // create new session ID when resuming
      forkSession: z.boolean().optional(),
      // fallback model when primary model is overloaded
      fallbackModel: z.string().optional(),
      // config sources to use: user, project, local
      settingSources: z.array(z.enum(["user", "project", "local"])).optional(),
      // only use specified MCP config, ignore others
      strictMcpConfig: z.boolean().optional(),
      // enable loopy for -p
      loopy: z.boolean().optional(),
      // trigger Setup hook
      init: z.boolean().optional(),
      // run Setup hook and exit
      initOnly: z.boolean().optional(),
      // maintenance mode Setup
      maintenance: z.boolean().optional(),
      // specify model directly
      model: z.string().optional(),
      // override system prompt
      systemPrompt: z.string().optional(),
      // load system prompt from file
      systemPromptFile: z.string().optional(),
      // enable MCP debug logging
      mcpDebug: z.boolean().optional(),
      // output format: json, text, stream-json
      outputFormat: z.enum(["json", "text", "stream-json"]).optional(),
      // disable slash commands
      disableSlashCommands: z.boolean().optional(),
      // SDK budget limit
      maxBudgetUsd: z.number().optional(),
      // bypass all permissions
      dangerouslySkipPermissions: z.boolean().optional(),
      // custom session ID when forking sessions
      sessionId: z.string().optional(),
    })
    .optional(),

  // response language (e.g., "Japanese", "Spanish")
  language: z.string().optional(),
  // control @-mention file picker behavior per project
  respectGitignore: z.boolean().optional(),
  // customize where plan files are stored
  plansDirectory: z.string().optional(),
  // hide turn duration messages (e.g., "Cooked for 1m 6s")
  showTurnDuration: z.boolean().optional(),
  // hide status line entirely
  hideStatusLine: z.boolean().optional(),
  // toggle between stable/latest update channels
  releaseChannel: z.enum(["stable", "latest"]).optional(),
  // disable automatic updates
  disableAutoUpdate: z.boolean().optional(),
  // enable/disable file history feature
  claudeFileHistoryEnabled: z.boolean().optional(),
  // disable all hooks globally
  disableAllHooks: z.boolean().optional(),

  apiKeyHelper: z.string().optional(),
  awsAuthRefresh: z.string().optional(),
  cleanupPeriodDays: z.number().optional(),
  companyAnnouncements: z.array(z.string()).optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  forceLoginMethod: z.string().optional(),
  includeCoAuthoredBy: z.boolean().optional(),
  model: z.union([z.enum(["auto", "opus", "opusplan", "sonnet"]), z.string()]).optional(),
  spinnerTipsEnabled: z.boolean().optional(),
  skipWebFetchPreflight: z.boolean().optional(),
  alwaysThinkingEnabled: z.boolean().optional(),

  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      ask: z.array(z.string()).optional(),
      additionalDirectories: z.array(z.string()).optional(),
      defaultMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional(),
      disableBypassPermissionsMode: z.boolean().optional(),
    })
    .optional(),

  statusLine: z.object({ type: z.string(), command: z.string() }).optional(),
  fileSuggestion: z.object({ type: z.string(), command: z.string() }).optional(),

  sandbox: z
    .object({
      enabled: z.boolean().optional(),
      autoAllowBashIfSandboxed: z.boolean().optional(),
      excludedCommands: z.array(z.string()).optional(),
      allowUnsandboxedCommands: z.boolean().optional(),
      network: z
        .object({
          allowUnixSockets: z.array(z.string()).optional(),
          allowLocalBinding: z.boolean().optional(),
          httpProxyPort: z.number().optional(),
          socksProxyPort: z.number().optional(),
        })
        .optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
    })
    .optional(),

  // runtime string patches applied to claude cli
  patches: z
    .array(
      z.object({
        find: z.string(),
        replace: z.string(),
      }),
    )
    .optional(),

  // overwritten by launcher
  // outputStyle: z.string().optional(),
  // hooks: z.record(z.string(), z.array(z.any())).optional(),

  // config options
  // preferredNotifChannel: z.string().optional(),
  // theme: z.string().optional(),
  // verbose: z.boolean().optional(),
});

export type ClaudeSettings = z.infer<typeof settingsSchema>;

export const validateSettings = (settings: unknown) => {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    const error = parsed.error;
    const errorMessages: string[] = [];

    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      errorMessages.push(`  • ${path}: ${issue.message}`);
    }

    const errorMessage = ["Settings validation failed:", ...errorMessages].join("\n");

    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  return parsed.data;
};
