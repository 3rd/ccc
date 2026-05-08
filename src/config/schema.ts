import { z } from "zod";

export const agentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  maxTurns: z.number().optional(),
  // critical reminder added to system prompt (v2.1.64)
  criticalSystemReminder_EXPERIMENTAL: z.string().optional(),
  // auto-submitted as the first user turn when this agent is the main thread agent (v2.1.83)
  initialPrompt: z.string().optional(),
  // run this agent as a background task (non-blocking, fire-and-forget) when invoked (v2.1.89)
  background: z.boolean().optional(),
  // scope for auto-loading agent memory files (v2.1.89)
  memory: z.enum(["user", "project", "local"]).optional(),
  // reasoning effort level: named level or integer (v2.1.89)
  effort: z.union([z.enum(["low", "medium", "high", "xhigh", "max"]), z.number().int()]).optional(),
  // permission mode controlling how tool executions are handled (v2.1.89)
  permissionMode: z
    .enum(["default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"])
    .optional(),
  // run agent in an isolated git worktree that is auto-cleaned when done (v2.1.89)
  isolation: z.enum(["worktree"]).optional(),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

// marketplace source types for plugin marketplace configuration (v2.1.61)
const marketplaceSourceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("url"),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    source: z.literal("github"),
    repo: z.string(),
    ref: z.string().optional(),
    path: z.string().optional(),
    // directories to include via git sparse-checkout (v2.1.64)
    sparsePaths: z.array(z.string()).optional(),
  }),
  z.object({
    source: z.literal("git"),
    url: z.string(),
    ref: z.string().optional(),
    path: z.string().optional(),
    // directories to include via git sparse-checkout (v2.1.64)
    sparsePaths: z.array(z.string()).optional(),
  }),
  z.object({
    source: z.literal("npm"),
    package: z.string(),
    version: z.string().optional(),
    registry: z.url().optional(),
  }),
  z.object({
    source: z.literal("pip"),
    package: z.string(),
    version: z.string().optional(),
    registry: z.url().optional(),
  }),
  z.object({
    source: z.literal("file"),
    path: z.string(),
  }),
  z.object({
    source: z.literal("directory"),
    path: z.string(),
  }),
  z.object({
    source: z.literal("hostPattern"),
    hostPattern: z.string(),
  }),
  z.object({
    source: z.literal("git-subdir"),
    url: z.string(),
    path: z.string(),
    ref: z.string().optional(),
  }),
  // regex path pattern matching for strict marketplace allowlists (v2.1.69)
  z.object({
    source: z.literal("pathPattern"),
    pathPattern: z.string(),
  }),
  // inline marketplace manifest defined directly in settings.json (v2.1.80)
  z.object({
    source: z.literal("settings"),
    name: z.string(),
    plugins: z.array(z.record(z.string(), z.unknown())),
    owner: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const marketplaceEntrySchema = z.object({
  source: marketplaceSourceSchema,
  installLocation: z.string().optional(),
  autoUpdate: z.boolean().optional(),
});

const runtimePatchSchema = z.union([
  z.object({
    find: z.string(),
    replace: z.string(),
  }),
  z.object({
    name: z.string(),
    fn: z.custom<(content: string) => string>((value) => typeof value === "function"),
  }),
]);

// https://docs.anthropic.com/en/docs/claude-code/settings
const baseSettingsSchema = z.object({
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
      // permission mode to start in: "default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"
      permissionMode: z
        .enum(["default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"])
        .optional(),
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
      // effort level override via CLI (low, medium, high, xhigh, max)
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
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
      // thinking mode: enabled (= adaptive), adaptive, disabled (v2.1.61)
      thinking: z.enum(["enabled", "adaptive", "disabled"]).optional(),
      // MCP servers whose channel notifications should register this session (v2.1.80)
      channels: z.array(z.string()).optional(),
      // load channel servers not on the approved allowlist; for local development only (v2.1.80)
      dangerouslyLoadDevelopmentChannels: z.array(z.string()).optional(),
    })
    .optional(),

  // response language (e.g., "Japanese", "Spanish")
  language: z.string().optional(),
  // control @-mention file picker behavior per project
  respectGitignore: z.boolean().optional(),
  // customize where plan files are stored
  plansDirectory: z.string().optional(),
  // reduce or disable UI animations (v2.1.30)
  prefersReducedMotion: z.boolean().optional(),
  // release channel: stable (week-old, skips regressions) or latest (most recent)
  autoUpdatesChannel: z.enum(["stable", "latest"]).optional(),
  // disable all hooks globally
  disableAllHooks: z.boolean().optional(),
  // disable the background-agents fleet (v2.1.121)
  disableBackgroundAgents: z.boolean().optional(),
  // disable inline shell execution in skills and custom slash commands (v2.1.91)
  disableSkillShellExecution: z.boolean().optional(),
  // default shell for ! commands: bash (default) or powershell (v2.1.85)
  defaultShell: z.enum(["bash", "powershell"]).optional(),
  // customize spinner verbs (v2.1.23)
  spinnerVerbs: z
    .object({
      mode: z.enum(["append", "replace"]),
      verbs: z.array(z.string()),
    })
    .optional(),
  // enable fast mode for faster Opus responses at higher cost (v2.1.36)
  fastMode: z.boolean().optional(),
  // per-session fast mode opt-in (v2.1.59)
  fastModePerSessionOptIn: z.boolean().optional(),
  // persisted effort level for supported models (v2.1.111)
  effortLevel: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  // output style to adjust system prompt (e.g., "Explanatory")
  outputStyle: z.string().optional(),
  // advisor model for server-side advisor tool (v2.1.85)
  advisorModel: z.string().optional(),

  // auto-compact window size in tokens (v2.1.90)
  autoCompactWindow: z.number().int().min(100_000).max(1_000_000).optional(),

  // blocks startup until remote managed settings are freshly fetched; exits on failure (v2.1.92)
  forceRemoteSettingsRefresh: z.boolean().optional(),

  // per-skill description character cap in the skill listing sent to Claude (default: 1536) (v2.1.105)
  skillListingMaxDescChars: z.number().int().positive().optional(),
  // fraction of context window reserved for skill listing (default: 0.01 = 1%) (v2.1.105)
  skillListingBudgetFraction: z.number().positive().max(1).optional(),
  // per-skill listing overrides keyed by skill name (v2.1.105)
  skillOverrides: z.record(z.string(), z.enum(["on", "name-only", "user-invocable-only", "off"])).optional(),
  // custom per-subagent status line shown in the agent panel (v2.1.105)
  subagentStatusLine: z
    .object({
      type: z.literal("command"),
      command: z.string(),
    })
    .optional(),
  // @internal session recap when returning after 5+ min; absent or true = enabled (v2.1.105)
  awaySummaryEnabled: z.boolean().optional(),
  // terminal UI renderer: "fullscreen" uses the alt-screen flicker-free renderer (v2.1.110)
  tui: z.enum(["default", "fullscreen"]).optional(),

  // @internal voice handsfree settings; gated by VOICE_HANDSFREE feature flag (v2.1.92)
  voice: z
    .object({
      enabled: z.boolean().optional(),
      // 'hold' (default): hold to talk. 'tap': tap to start, tap to stop+submit
      mode: z.enum(["hold", "tap"]).optional(),
      // submit the prompt when hold-to-talk is released (hold mode only)
      autoSubmit: z.boolean().optional(),
    })
    .optional(),

  apiKeyHelper: z.string().optional(),
  // shell command that outputs a Proxy-Authorization header value (EAP) (v2.1.111)
  proxyAuthHelper: z.string().optional(),
  awsAuthRefresh: z.string().optional(),
  // command to refresh GCP authentication
  gcpAuthRefresh: z.string().optional(),
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
  // allowlist of URL patterns for HTTP hooks (supports * wildcard) (v2.1.63)
  allowedHttpHookUrls: z.array(z.string()).optional(),
  // allowlist of env var names HTTP hooks may interpolate into headers (v2.1.63)
  httpHookAllowedEnvVars: z.array(z.string()).optional(),
  // per-plugin configuration
  pluginConfigs: z.record(z.string(), z.unknown()).optional(),
  // enable/disable auto-memory for the project (v2.1.51)
  autoMemoryEnabled: z.boolean().optional(),
  // custom directory for storing auto-memory files (v2.1.74)
  autoMemoryDirectory: z.string().optional(),
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
  // override mapping from Anthropic model ID to provider-specific model ID (v2.1.73)
  modelOverrides: z.record(z.string(), z.string()).optional(),
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
        // default working directory on the remote host (v2.1.76)
        startDirectory: z.string().optional(),
      }),
    )
    .optional(),
  // enterprise MCP server allowlist (v2.1.51)
  allowedMcpServers: z
    .array(
      z.object({
        serverName: z.string().optional(),
        serverCommand: z.array(z.string()).min(1).optional(),
        serverUrl: z.string().optional(),
      }),
    )
    .optional(),
  // enterprise MCP server denylist (v2.1.51)
  deniedMcpServers: z
    .array(
      z.object({
        serverName: z.string().optional(),
        serverCommand: z.array(z.string()).min(1).optional(),
        serverUrl: z.string().optional(),
      }),
    )
    .optional(),
  // when set in managed settings, only managed permission rules apply (v2.1.51)
  allowManagedPermissionRulesOnly: z.boolean().optional(),
  // when set in managed settings, only managed MCP allowlist applies (v2.1.51)
  allowManagedMcpServersOnly: z.boolean().optional(),
  // plugin enable/disable map: plugin-id@marketplace-id -> boolean | string[] (v2.1.61)
  enabledPlugins: z.record(z.string(), z.union([z.array(z.string()), z.boolean(), z.undefined()])).optional(),
  // additional marketplace sources for this repository (v2.1.61)
  extraKnownMarketplaces: z.record(z.string(), marketplaceEntrySchema).optional(),
  // enterprise blocklist of marketplace sources (v2.1.61)
  blockedMarketplaces: z.array(marketplaceSourceSchema).optional(),
  // enterprise strict allowlist of marketplace sources (v2.1.61)
  strictKnownMarketplaces: z.array(marketplaceSourceSchema).optional(),
  // rate (0-1) for session quality survey prompts; enterprise admins only (v2.1.76)
  feedbackSurveyRate: z.number().min(0).max(1).optional(),
  // control whether git commit/PR workflow instructions are included (v2.1.69)
  includeGitInstructions: z.boolean().optional(),
  // show thinking summaries in transcript view (ctrl+o) (v2.1.69)
  showThinkingSummaries: z.boolean().optional(),
  // organization-specific trust message shown in plugin dialogs (v2.1.69, managed settings)
  pluginTrustMessage: z.string().optional(),
  // whether user has accepted auto mode opt-in dialog (v2.1.71)
  skipAutoPermissionPrompt: z.boolean().optional(),
  // disable auto mode at top level (v2.1.71, managed settings)
  disableAutoMode: z.enum(["disable"]).optional(),
  // default transcript view: chat or transcript
  defaultView: z.enum(["chat", "transcript"]).optional(),
  // default transcript view mode on startup: default, verbose, or focus (v2.1.97)
  viewMode: z.enum(["default", "verbose", "focus"]).optional(),
  // show "clear context" option in plan approval dialog (v2.1.81, default false)
  showClearContextOnPlanAccept: z.boolean().optional(),
  // enable background memory consolidation (auto-dream) (v2.1.81)
  autoDreamEnabled: z.boolean().optional(),
  // block non-plugin customization sources for listed surfaces (v2.1.81, managed settings)
  strictPluginOnlyCustomization: z
    .union([z.boolean(), z.array(z.enum(["skills", "agents", "hooks", "mcp"]))])
    .optional(),
  // opt-in for channel notifications from MCP servers (v2.1.81, managed settings)
  channelsEnabled: z.boolean().optional(),
  // admin-defined allowlist of channel plugins (v2.1.84, managed settings)
  allowedChannelPlugins: z.array(z.object({ marketplace: z.string(), plugin: z.string() })).optional(),
  // prevent claude-cli:// protocol handler registration (v2.1.83)
  disableDeepLinkRegistration: z.enum(["disable"]).optional(),
  // whether plan mode uses auto mode semantics (v2.1.85, default true)
  useAutoModeDuringPlan: z.boolean().optional(),
  // auto mode classifier rules (v2.1.71)
  autoMode: z
    .object({
      allow: z.array(z.string()).optional(),
      soft_deny: z.array(z.string()).optional(),
      environment: z.array(z.string()).optional(),
    })
    .optional(),
  // name of a built-in or custom agent for the main thread (v2.1.85)
  agent: z.string().optional(),
  // opt-in for WSL to inherit managed settings from Windows policy chain
  // (HKLM + C:/Program Files/ClaudeCode via DrvFs + HKCU); requires double
  // opt-in (admin + user) and has no effect on native Windows (v2.1.118)
  wslInheritsWindowsSettings: z.boolean().optional(),
  // @internal keep working until PR is ready to merge, a cron/Monitor is armed
  // to resume later, or hands a self-contained next step (v2.1.124)
  doneMeansMerged: z.boolean().optional(),
  // require explicit approval before SendMessage can reach a peer session on
  // another machine via Remote Control (v2.1.124)
  isolatePeerMachines: z.boolean().optional(),
  // disable Remote Control (claude.ai/code, `claude remote-control`,
  // `--remote-control`/`--rc`, auto-start, in-session toggle); typically
  // set in managed settings (v2.1.128)
  disableRemoteControl: z.boolean().optional(),

  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      ask: z.array(z.string()).optional(),
      additionalDirectories: z.array(z.string()).optional(),
      defaultMode: z
        .enum(["default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"])
        .optional(),
      disableBypassPermissionsMode: z.literal("disable").optional(),
      // disable auto mode (v2.1.71, managed settings)
      disableAutoMode: z.enum(["disable"]).optional(),
    })
    .optional(),

  statusLine: z
    .object({
      type: z.literal("command"),
      command: z.string(),
      padding: z.number().optional(),
      // re-run the status line command every N seconds in addition to event-driven updates (v2.1.97)
      refreshInterval: z.number().min(1).optional(),
    })
    .optional(),
  fileSuggestion: z.object({ type: z.literal("command"), command: z.string() }).optional(),

  // git worktree configuration for --worktree flag (v2.1.49)
  worktree: z
    .object({
      // directories to symlink from main repo to worktrees to avoid disk bloat
      symlinkDirectories: z.array(z.string()).optional(),
      // directories to include via git sparse-checkout for large monorepos (v2.1.76)
      sparsePaths: z.array(z.string()).optional(),
      // which ref new worktrees branch from: 'fresh' uses origin/<default>, 'head' uses local HEAD (v2.1.133)
      baseRef: z.enum(["fresh", "head"]).optional(),
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
          // domains always blocked even if matched by allowedDomains (v2.1.113)
          deniedDomains: z.array(z.string()).optional(),
          httpProxyPort: z.number().optional(),
          socksProxyPort: z.number().optional(),
          // when true in managed settings, only managed allowedDomains apply (v2.1.61)
          allowManagedDomainsOnly: z.boolean().optional(),
          // macOS only: additional XPC/Mach service names to allow looking up
          allowMachLookup: z.array(z.string()).optional(),
        })
        .optional(),
      // filesystem access control within the sandbox (v2.1.61)
      filesystem: z
        .object({
          allowWrite: z.array(z.string()).optional(),
          denyWrite: z.array(z.string()).optional(),
          denyRead: z.array(z.string()).optional(),
          // re-allow read access within denyRead regions (v2.1.77)
          allowRead: z.array(z.string()).optional(),
          // when true in managed settings, only managed allowRead paths apply (v2.1.77)
          allowManagedReadPathsOnly: z.boolean().optional(),
        })
        .optional(),
      // selectively ignore sandbox violations by process/pattern (v2.1.61)
      ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
      // custom ripgrep configuration (v2.1.61)
      ripgrep: z.object({ command: z.string(), args: z.array(z.string()).optional() }).optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
      // weaker network isolation for sandbox (v2.1.64)
      enableWeakerNetworkIsolation: z.boolean().optional(),
      // exit with error when sandbox is enabled but cannot start (v2.1.83)
      failIfUnavailable: z.boolean().optional(),
      // Linux/WSL only: absolute path to the bwrap (bubblewrap) binary; managed-only (v2.1.133)
      bwrapPath: z.string().optional(),
      // Linux/WSL only: absolute path to the socat binary used for sandbox network proxy; managed-only (v2.1.133)
      socatPath: z.string().optional(),
    })
    .optional(),

  // controls how the SDK parent tier (Options.managedSettings / --managed-settings) layers under the admin tier (v2.1.133)
  parentSettingsBehavior: z.enum(["first-wins", "merge"]).optional(),

  // runtime patches applied to claude cli
  patches: z.array(runtimePatchSchema).optional(),

  // GrowthBook feature flag overrides
  featureFlags: z.record(z.string(), z.unknown()).optional(),

  // hooks are overwritten by launcher
  // hooks: z.record(z.string(), z.array(z.any())).optional(),

  // URL template for PR links in the footer badge and inline messages.
  // placeholders: {host} {owner} {repo} {number} {url} (v2.1.119)
  prUrlTemplate: z.string().optional(), // default: unset (falls back to github.com)

  // background daemon cold-start behavior: 'transient' spawns one for this login session;
  // 'ask' offers to install a persistent service (v2.1.120)
  daemonColdStart: z.enum(["transient", "ask"]).optional(),

  // /config settings that persist to settings.json and participate in
  // project/local/policy override precedence (v2.1.119)
  theme: z
    .enum(["auto", "dark", "light", "light-daltonized", "dark-daltonized", "light-ansi", "dark-ansi"])
    .optional(), // default: "dark"
  editorMode: z.enum(["normal", "vim"]).optional(), // default: "normal"
  verbose: z.boolean().optional(), // default: false
  preferredNotifChannel: z
    .enum([
      "auto",
      "iterm2",
      "iterm2_with_bell",
      "terminal_bell",
      "kitty",
      "ghostty",
      "notifications_disabled",
    ])
    .optional(), // default: "auto"
  autoCompactEnabled: z.boolean().optional(), // default: true
  autoScrollEnabled: z.boolean().optional(), // default: true
  fileCheckpointingEnabled: z.boolean().optional(), // default: true
  showTurnDuration: z.boolean().optional(), // default: true
  showMessageTimestamps: z.boolean().optional(), // default: false
  terminalProgressBarEnabled: z.boolean().optional(), // default: true
  todoFeatureEnabled: z.boolean().optional(), // default: true
  teammateMode: z.enum(["auto", "tmux", "in-process"]).optional(), // default: "auto"
  remoteControlAtStartup: z.boolean().optional(), // default: unset (tristate; undefined = "default")
  autoUploadSessions: z.boolean().optional(), // default: unset (server-controlled)
  inputNeededNotifEnabled: z.boolean().optional(), // default: unset (server-controlled)
  agentPushNotifEnabled: z.boolean().optional(), // default: false
});

// named configuration profiles applied via --profile <name> (CCC-only, stripped before settings.json)
export const settingsSchema = baseSettingsSchema.extend({
  profiles: z.record(z.string(), baseSettingsSchema.partial()).optional(),
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
