import { z } from "zod";

export const agentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  maxTurns: z.number().optional(),
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
      permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions", "delegate", "dontAsk"]).optional(),
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
      // resume session linked to PR number or URL (v2.1.27)
      fromPr: z.union([z.string(), z.number()]).optional(),
      // agent teams display mode (v2.1.32)
      teammateMode: z.enum(["auto", "in-process", "tmux"]).optional(),
      // append text to system prompt (works in both interactive and print modes)
      appendSystemPrompt: z.string().optional(),
      // load additional system prompt from file and append (print mode only)
      appendSystemPromptFile: z.string().optional(),
      // beta headers to include in API requests (API key users only)
      betas: z.array(z.string()).optional(),
      // limit number of agentic turns (print mode only)
      maxTurns: z.number().optional(),
      // disable session persistence (print mode only)
      noSessionPersistence: z.boolean().optional(),
      // MCP tool for permission prompts in non-interactive mode
      permissionPromptTool: z.string().optional(),
      // include partial streaming events (requires print + stream-json)
      includePartialMessages: z.boolean().optional(),
      // input format for print mode: text, stream-json
      inputFormat: z.enum(["text", "stream-json"]).optional(),
      // get validated JSON output matching a JSON schema (print mode only)
      jsonSchema: z.string().optional(),
      // enable permission bypassing without immediately activating
      allowDangerouslySkipPermissions: z.boolean().optional(),
      // load additional settings from file or JSON string
      settings: z.string().optional(),
      // effort level override via CLI (low, medium, high, max)
      effort: z.enum(["low", "medium", "high", "max"]).optional(),
      // file resources to download at startup
      file: z.array(z.string()).optional(),
      // write debug logs to a specific file path
      debugFile: z.string().optional(),
      // re-emit user messages in stream-json output
      replayUserMessages: z.boolean().optional(),
      // create a new git worktree for this session (v2.1.49)
      worktree: z.union([z.boolean(), z.string()]).optional(),
      // create a tmux session for the worktree (requires --worktree) (v2.1.49)
      tmux: z.union([z.boolean(), z.string()]).optional(),
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
  // reduce or disable UI animations (v2.1.30)
  prefersReducedMotion: z.boolean().optional(),
  // toggle between stable/latest update channels (deprecated, use autoUpdatesChannel)
  releaseChannel: z.enum(["stable", "latest"]).optional(),
  // release channel: stable (week-old, skips regressions) or latest (most recent)
  autoUpdatesChannel: z.enum(["stable", "latest"]).optional(),
  // disable automatic updates
  disableAutoUpdate: z.boolean().optional(),
  // enable/disable file history feature
  claudeFileHistoryEnabled: z.boolean().optional(),
  // disable all hooks globally
  disableAllHooks: z.boolean().optional(),
  // agent teams display mode (v2.1.32)
  teammateMode: z.enum(["auto", "in-process", "tmux"]).optional(),
  // customize spinner verbs (v2.1.23)
  spinnerVerbs: z
    .object({
      mode: z.enum(["append", "replace"]),
      verbs: z.array(z.string()),
    })
    .optional(),
  // enable terminal progress bar in supported terminals (v2.1.30)
  terminalProgressBarEnabled: z.boolean().optional(),
  // enable fast mode for faster Opus 4.6 responses at higher cost (v2.1.36)
  fastMode: z.boolean().optional(),
  // per-session fast mode opt-in (v2.1.59)
  fastModePerSessionOptIn: z.boolean().optional(),
  // effort level for Opus 4.6 adaptive reasoning: low, medium, high (default)
  effortLevel: z.enum(["low", "medium", "high"]).optional(),
  // output style to adjust system prompt (e.g., "Explanatory")
  outputStyle: z.string().optional(),

  apiKeyHelper: z.string().optional(),
  awsAuthRefresh: z.string().optional(),
  // script outputting JSON with AWS credentials
  awsCredentialExport: z.string().optional(),
  cleanupPeriodDays: z.number().optional(),
  companyAnnouncements: z.array(z.string()).optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  // specific MCP servers from .mcp.json to approve
  enabledMcpjsonServers: z.array(z.string()).optional(),
  // specific MCP servers from .mcp.json to reject
  disabledMcpjsonServers: z.array(z.string()).optional(),
  forceLoginMethod: z.enum(["claudeai", "console"]).optional(),
  // auto-select organization UUID during login (requires forceLoginMethod)
  forceLoginOrgUUID: z.string().optional(),
  // script to generate dynamic OpenTelemetry headers
  otelHeadersHelper: z.string().optional(),
  // git/PR attribution settings (replaces deprecated includeCoAuthoredBy)
  attribution: z
    .object({
      commit: z.string().optional(),
      pr: z.string().optional(),
    })
    .optional(),
  // deprecated: use attribution instead
  includeCoAuthoredBy: z.boolean().optional(),
  model: z.union([z.enum(["auto", "default", "opus", "opusplan", "sonnet", "haiku"]), z.string()]).optional(),
  spinnerTipsEnabled: z.boolean().optional(),
  spinnerTipsOverride: z
    .object({
      tips: z.array(z.string()),
      excludeDefault: z.boolean().optional(),
    })
    .optional(),
  skipWebFetchPreflight: z.boolean().optional(),
  alwaysThinkingEnabled: z.boolean().optional(),
  // allow only managed and SDK hooks, block user/project/plugin hooks
  allowManagedHooksOnly: z.boolean().optional(),
  // per-plugin configuration
  pluginConfigs: z.record(z.string(), z.unknown()).optional(),
  // enable/disable auto-memory for the project (v2.1.51)
  autoMemoryEnabled: z.boolean().optional(),
  // enable voice mode (hold Space to dictate) (v2.1.59)
  voiceEnabled: z.boolean().optional(),
  // skip confirmation dialog for dangerous mode (v2.1.59)
  skipDangerousModePermissionPrompt: z.boolean().optional(),
  // disable syntax highlighting in diffs (v2.1.51)
  syntaxHighlightingDisabled: z.boolean().optional(),
  // whether /rename updates terminal tab title (v2.1.51)
  terminalTitleFromRename: z.boolean().optional(),
  // enable/disable prompt suggestions (v2.1.51)
  promptSuggestionEnabled: z.boolean().optional(),
  // minimum version to stay on, prevents downgrades (v2.1.51)
  minimumVersion: z.string().optional(),
  // allowlist of models users can select (v2.1.51)
  availableModels: z.array(z.string()).optional(),
  // glob patterns of CLAUDE.md files to exclude from loading (v2.1.51)
  claudeMdExcludes: z.array(z.string()).optional(),
  // remote session configuration (v2.1.51)
  remote: z.object({ defaultEnvironmentId: z.string().optional() }).optional(),
  // SSH remote environment configurations (v2.1.59)
  sshConfigs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        sshHost: z.string(),
        sshPort: z.number().optional(),
        sshIdentityFile: z.string().optional(),
      }),
    )
    .optional(),
  // enterprise MCP server allowlist (v2.1.51)
  allowedMcpServers: z
    .array(z.object({ serverName: z.string().optional(), serverCommand: z.string().optional(), serverUrl: z.string().optional() }))
    .optional(),
  // enterprise MCP server denylist (v2.1.51)
  deniedMcpServers: z
    .array(z.object({ serverName: z.string().optional(), serverCommand: z.string().optional(), serverUrl: z.string().optional() }))
    .optional(),
  // when set in managed settings, only managed permission rules apply (v2.1.51)
  allowManagedPermissionRulesOnly: z.boolean().optional(),
  // when set in managed settings, only managed MCP allowlist applies (v2.1.51)
  allowManagedMcpServersOnly: z.boolean().optional(),

  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      ask: z.array(z.string()).optional(),
      additionalDirectories: z.array(z.string()).optional(),
      defaultMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions", "delegate", "dontAsk"]).optional(),
      disableBypassPermissionsMode: z.literal("disable").optional(),
    })
    .optional(),

  statusLine: z.object({ type: z.literal("command"), command: z.string(), padding: z.number().optional() }).optional(),
  fileSuggestion: z.object({ type: z.literal("command"), command: z.string() }).optional(),

  // git worktree configuration for --worktree flag (v2.1.49)
  worktree: z
    .object({
      // directories to symlink from main repo to worktrees to avoid disk bloat
      symlinkDirectories: z.array(z.string()).optional(),
    })
    .optional(),

  sandbox: z
    .object({
      enabled: z.boolean().optional(),
      autoAllowBashIfSandboxed: z.boolean().optional(),
      excludedCommands: z.array(z.string()).optional(),
      allowUnsandboxedCommands: z.boolean().optional(),
      network: z
        .object({
          allowUnixSockets: z.array(z.string()).optional(),
          allowAllUnixSockets: z.boolean().optional(),
          allowLocalBinding: z.boolean().optional(),
          allowedDomains: z.array(z.string()).optional(),
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

  // hooks are overwritten by launcher
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
