export type HookEventName =
  | "ConfigChange"
  | "CwdChanged"
  | "Elicitation"
  | "ElicitationResult"
  | "FileChanged"
  | "InstructionsLoaded"
  | "MessageDisplay"
  | "Notification"
  | "PermissionDenied"
  | "PermissionRequest"
  | "PostCompact"
  | "PostToolBatch"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "PreToolUse"
  | "SessionEnd"
  | "SessionStart"
  | "Setup"
  | "Stop"
  | "StopFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCompleted"
  | "TaskCreated"
  | "TeammateIdle"
  | "UserPromptExpansion"
  | "UserPromptSubmit"
  | "WorktreeCreate"
  | "WorktreeRemove";

export type HookMatcherType =
  | ({} & string)
  | "Agent"
  | "AskUserQuestion"
  | "auto"
  | "Bash"
  | "clear"
  | "compact"
  | "CronCreate"
  | "CronDelete"
  | "CronList"
  | "Edit"
  | "EnterPlanMode"
  | "EnterWorktree"
  | "ExitPlanMode"
  | "ExitWorktree"
  | "Glob"
  | "Grep"
  | "LSP"
  | "manual"
  | "Monitor"
  | "MultiEdit"
  | "NotebookEdit"
  | "NotebookRead"
  | "PowerShell"
  | "PushNotification"
  | "Read"
  | "REPL"
  | "resume"
  | "ScheduleWakeup"
  | "SendMessage"
  | "Skill"
  | "startup"
  | "Task"
  | "TaskCreate"
  | "TaskGet"
  | "TaskList"
  | "TaskOutput"
  | "TaskStop"
  | "TaskUpdate"
  | "TodoWrite"
  | "ToolSearch"
  | "WebFetch"
  | "WebSearch"
  | "Write";

/**
 * Build-time gate shared across hook entries and definitions. When `false`, CCC
 * filters this entry/definition out before writing settings.json. Defaults to
 * `true`. Not emitted into the final settings.
 */
export interface HookEnabledFlag {
  enabled?: boolean;
}

export interface HookCommand extends HookEnabledFlag {
  type: "command";
  command: string;
  // argument list for exec form: when present, `command` is resolved as an
  // executable and spawned directly with these arguments (no shell). path
  // placeholders like ${CLAUDE_PLUGIN_ROOT} are substituted per-element as plain
  // strings, so paths with quotes, $, or backticks never reach a shell parser.
  // when absent, `command` runs through a shell (v2.1.139)
  args?: string[];
  // shell interpreter: 'bash' uses $SHELL, 'powershell' uses pwsh (v2.1.81)
  shell?: "bash" | "powershell";
  timeout?: number;
  once?: boolean;
  // permission rule syntax to filter when this hook runs, e.g. "Bash(git *)" (v2.1.85)
  // only evaluated for PreToolUse, PostToolUse, PostToolUseFailure,
  // PermissionRequest, PermissionDenied; ignored (and hook skipped with a warning)
  // for other events including PostToolBatch and UserPromptExpansion
  if?: string;
  // custom spinner status message while hook runs (v2.1.63)
  statusMessage?: string;
  // run in background without blocking (v2.1.63)
  async?: boolean;
  // run in background, wake model on exit code 2 (blocking error); implies async (v2.1.64)
  asyncRewake?: boolean;
}

export interface HookPrompt extends HookEnabledFlag {
  type: "prompt";
  prompt: string;
  timeout?: number;
  once?: boolean;
  // permission rule syntax to filter when this hook runs, e.g. "Bash(git *)" (v2.1.85)
  if?: string;
  // model to use for prompt evaluation (v2.1.63)
  model?: string;
  // sets continue value for decision:"block" when ok is false (default false ends turn).
  // on PostToolUse, the reason is fed back to Claude and the turn continues (v2.1.139)
  continueOnBlock?: boolean;
  // custom spinner status message while hook runs (v2.1.63)
  statusMessage?: string;
}

// http hook: POST JSON to a URL and receive JSON response (v2.1.63)
export interface HookHttp extends HookEnabledFlag {
  type: "http";
  url: string;
  timeout?: number;
  once?: boolean;
  // permission rule syntax to filter when this hook runs, e.g. "Bash(git *)" (v2.1.85)
  if?: string;
  // additional request headers; values support $VAR_NAME interpolation (v2.1.63)
  headers?: Record<string, string>;
  // env vars allowed to be interpolated in header values (v2.1.63)
  allowedEnvVars?: string[];
  // custom spinner status message while hook runs (v2.1.63)
  statusMessage?: string;
}

// agentic verifier hook: runs an agent to verify conditions (v2.1.63)
export interface HookAgent extends HookEnabledFlag {
  type: "agent";
  prompt: string;
  timeout?: number;
  once?: boolean;
  // permission rule syntax to filter when this hook runs, e.g. "Bash(git *)" (v2.1.85)
  if?: string;
  // model to use for agent hook (v2.1.63)
  model?: string;
  // custom spinner status message while hook runs (v2.1.63)
  statusMessage?: string;
}

// mcp tool hook: invoke a tool on a configured MCP server (v2.1.118)
export interface HookMcpTool extends HookEnabledFlag {
  type: "mcp_tool";
  // name of an already-configured MCP server to invoke
  server: string;
  // name of the tool on that server to call
  tool: string;
  // arguments passed to the MCP tool; string values support ${path} interpolation
  // from the hook input JSON (e.g. "${tool_input.file_path}")
  input?: Record<string, unknown>;
  timeout?: number;
  once?: boolean;
  // permission rule syntax to filter when this hook runs, e.g. "Bash(git *)"
  if?: string;
  // custom spinner status message while hook runs
  statusMessage?: string;
}

export type HookEntry = HookAgent | HookCommand | HookHttp | HookMcpTool | HookPrompt;

export interface HookDefinition extends HookEnabledFlag {
  matcher?: HookMatcherType;
  hooks: HookEntry[];
}

export type HooksConfiguration = Partial<Record<HookEventName, HookDefinition[]>>;

export type PermissionMode = "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";

interface BaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: PermissionMode;
  // present when hook fires from within a subagent (v2.1.64)
  agent_id?: string;
  // present when hook fires from subagent or main thread of --agent session (v2.1.64)
  agent_type?: string;
  // active reasoning effort level; also exposed as $CLAUDE_EFFORT (v2.1.133)
  effort?: { level: string };
}

export interface PreToolUseHookInput extends BaseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  // CLI types this as `unknown`; narrowed here since tool inputs are always objects
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUseHookInput extends BaseHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  // CLI types this as `unknown`; narrowed here since tool inputs are always objects
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
  // tool execution time in ms, excluding permission prompts and PreToolUse hooks (v2.1.119)
  duration_ms?: number;
}

export interface PostToolBatchToolCall {
  tool_name: string;
  // CLI types this as `unknown`; narrowed here since tool inputs are always objects
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  tool_response?: unknown;
}

// fires once after every tool call in a batch has resolved, before the next model
// request; PostToolUse fires per-tool (possibly concurrently), PostToolBatch fires
// once with the full batch (v2.1.118)
export interface PostToolBatchHookInput extends BaseHookInput {
  hook_event_name: "PostToolBatch";
  tool_calls: PostToolBatchToolCall[];
}

// fires after auto mode classifier denies a tool call; output can request retry (v2.1.89)
export interface PermissionDeniedHookInput extends BaseHookInput {
  hook_event_name: "PermissionDenied";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  reason: string;
}

export interface PermissionRequestHookInput extends BaseHookInput {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  // CLI types this as `unknown`; narrowed here since tool inputs are always objects
  tool_input: Record<string, unknown>;
  permission_suggestions?: Record<string, unknown>[];
}

export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
  session_title?: string;
}

// fires when a slash command or mcp prompt expands a user prompt, before the
// expanded prompt is submitted (v2.1.116)
export interface UserPromptExpansionHookInput extends BaseHookInput {
  hook_event_name: "UserPromptExpansion";
  expansion_type: "mcp_prompt" | "slash_command";
  command_name: string;
  command_args: string;
  command_source?: string;
  prompt: string;
}

export interface SessionStartHookInput extends BaseHookInput {
  hook_event_name: "SessionStart";
  source: "clear" | "compact" | "resume" | "startup";
  agent_type?: string;
  model?: string;
}

export interface SessionEndHookInput extends BaseHookInput {
  hook_event_name: "SessionEnd";
  reason: "bypass_permissions_disabled" | "clear" | "logout" | "other" | "prompt_input_exit" | "resume";
}

// in-flight background work (running/pending or backgrounded) registered in the
// session, surfaced on Stop and SubagentStop so hooks can distinguish "done" from
// "waiting for background work" (v2.1.145)
export interface BackgroundTask {
  id: string;
  // task-type label: "shell" | "subagent" | "monitor" | "workflow" | unknown
  type: string;
  status: string;
  // free-text description; capped at 1000 chars with a "… [+N chars]" marker
  description: string;
  // only present for "shell" tasks; capped at 1000 chars
  command?: string;
  // only present for "subagent" tasks
  agent_type?: string;
  // only present for "monitor" / "MCP task" tasks
  server?: string;
  // only present for "monitor" / "MCP task" tasks
  tool?: string;
  // only present for "workflow" tasks
  name?: string;
}

// session-scoped cron task (CronCreate, ScheduleWakeup, /loop) that will wake
// this session later, surfaced on Stop and SubagentStop (v2.1.145)
export interface SessionCron {
  id: string;
  // cron expression, e.g. "0 9 * * 1-5"
  schedule: string;
  // false for one-shot wakeups whose cron encodes a single fire time
  recurring: boolean;
  // capped at 1000 chars with a "… [+N chars]" marker
  prompt: string;
}

export interface StopHookInput extends BaseHookInput {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  // text content of the last assistant message before stopping (v2.1.47)
  last_assistant_message?: string;
  // in-flight background work; empty array when nothing is in flight (v2.1.145)
  background_tasks?: BackgroundTask[];
  // pending session-scoped cron wakeups; empty array when none (v2.1.145)
  session_crons?: SessionCron[];
}

export type StopFailureError =
  | "authentication_failed"
  | "billing_error"
  | "invalid_request"
  | "max_output_tokens"
  | "rate_limit"
  | "server_error"
  | "unknown";

// fires when a turn ends due to an API error; fire-and-forget (v2.1.78)
export interface StopFailureHookInput extends BaseHookInput {
  hook_event_name: "StopFailure";
  error: StopFailureError;
  error_details?: string;
  last_assistant_message?: string;
}

export interface SubagentStopHookInput extends BaseHookInput {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;
  agent_id: string;
  agent_transcript_path: string;
  agent_type: string;
  // text content of the last assistant message before stopping (v2.1.47)
  last_assistant_message?: string;
  // in-flight background work; empty array when nothing is in flight (v2.1.145)
  background_tasks?: BackgroundTask[];
  // pending session-scoped cron wakeups; empty array when none (v2.1.145)
  session_crons?: SessionCron[];
}

export type NotificationType =
  | ({} & string)
  // background agent in `claude agents` needs input / finished (v2.1.198)
  | "agent_completed"
  | "agent_needs_input"
  | "auth_success"
  | "elicitation_complete"
  | "elicitation_dialog"
  | "elicitation_response"
  | "idle_prompt"
  | "permission_prompt"
  // push notification sent via PushNotification tool (v2.1.110)
  | "push_notification"
  // teammate permission prompt forwarded from a worker (v2.1.65)
  | "worker_permission_prompt";

export interface NotificationHookInput extends BaseHookInput {
  hook_event_name: "Notification";
  message: string;
  title?: string;
  notification_type: NotificationType;
}

export interface PreCompactHookInput extends BaseHookInput {
  hook_event_name: "PreCompact";
  trigger: "auto" | "manual";
  custom_instructions: string | null;
}

export interface PostCompactHookInput extends BaseHookInput {
  hook_event_name: "PostCompact";
  trigger: "auto" | "manual";
  compact_summary: string;
}

export interface SetupHookInput extends BaseHookInput {
  hook_event_name: "Setup";
  trigger: "init" | "maintenance";
}

export interface SubagentStartHookInput extends BaseHookInput {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
}

export interface TeammateIdleHookInput extends BaseHookInput {
  hook_event_name: "TeammateIdle";
  teammate_name: string;
  team_name: string;
}

export interface TaskCompletedHookInput extends BaseHookInput {
  hook_event_name: "TaskCompleted";
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}

// fires when a task is created via TaskCreate (v2.1.84)
export interface TaskCreatedHookInput extends BaseHookInput {
  hook_event_name: "TaskCreated";
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}

export interface ConfigChangeHookInput extends BaseHookInput {
  hook_event_name: "ConfigChange";
  source: "local_settings" | "policy_settings" | "project_settings" | "skills" | "user_settings";
  file_path?: string;
}

export interface WorktreeCreateHookInput extends BaseHookInput {
  hook_event_name: "WorktreeCreate";
  name: string;
}

export interface WorktreeRemoveHookInput extends BaseHookInput {
  hook_event_name: "WorktreeRemove";
  worktree_path: string;
}

// fires for each batch of newly completed lines while an assistant message
// streams; display-only — the stored message and what the model sees are
// untouched (v2.1.152)
export interface MessageDisplayHookInput extends BaseHookInput {
  hook_event_name: "MessageDisplay";
  // UUID of the current turn
  turn_id: string;
  // UUID of the assistant message being displayed; stable across every flush
  // of the same message. Not the API msg_… id.
  message_id: string;
  // zero-based index of this delta within the message; increments by one per flush
  index: number;
  // true on the message's last flush; exactly one flush per message has it
  final: boolean;
  // the newly completed lines since the prior flush. Always whole lines, except
  // on the final flush which may end mid-line. The delta of the final flush is
  // empty when the message ends on a newline; treat final as the end-of-message
  // signal regardless.
  delta: string;
}

// reactive environment management hooks (v2.1.83)
export interface CwdChangedHookInput extends BaseHookInput {
  hook_event_name: "CwdChanged";
  old_cwd: string;
  new_cwd: string;
}

export interface FileChangedHookInput extends BaseHookInput {
  hook_event_name: "FileChanged";
  file_path: string;
  event: "add" | "change" | "unlink";
}

export type InstructionsMemoryType = "Local" | "Managed" | "Project" | "User";

export type InstructionsLoadReason =
  | "compact"
  | "include"
  | "nested_traversal"
  | "path_glob_match"
  | "session_start";

export interface InstructionsLoadedHookInput extends BaseHookInput {
  hook_event_name: "InstructionsLoaded";
  file_path: string;
  memory_type: InstructionsMemoryType;
  load_reason: InstructionsLoadReason;
  // glob patterns from paths: frontmatter that matched (v2.1.64)
  globs?: string[];
  // file Claude touched that caused the load (v2.1.64)
  trigger_file_path?: string;
  // file that @-included this one (v2.1.64)
  parent_file_path?: string;
}

export interface ElicitationHookInput extends BaseHookInput {
  hook_event_name: "Elicitation";
  mcp_server_name: string;
  message: string;
  mode?: "form" | "url";
  url?: string;
  elicitation_id?: string;
  requested_schema?: Record<string, unknown>;
}

export interface ElicitationResultHookInput extends BaseHookInput {
  hook_event_name: "ElicitationResult";
  mcp_server_name: string;
  elicitation_id?: string;
  mode?: "form" | "url";
  action: "accept" | "cancel" | "decline";
  content?: Record<string, unknown>;
}

export interface PostToolUseFailureHookInput extends BaseHookInput {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  // CLI types this as `unknown`; narrowed here since tool inputs are always objects
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
  // tool execution time in ms, excluding permission prompts and PreToolUse hooks (v2.1.119)
  duration_ms?: number;
}

export type ClaudeHookInput =
  | ConfigChangeHookInput
  | CwdChangedHookInput
  | ElicitationHookInput
  | ElicitationResultHookInput
  | FileChangedHookInput
  | InstructionsLoadedHookInput
  | MessageDisplayHookInput
  | NotificationHookInput
  | PermissionDeniedHookInput
  | PermissionRequestHookInput
  | PostCompactHookInput
  | PostToolBatchHookInput
  | PostToolUseFailureHookInput
  | PostToolUseHookInput
  | PreCompactHookInput
  | PreToolUseHookInput
  | SessionEndHookInput
  | SessionStartHookInput
  | SetupHookInput
  | StopFailureHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | TaskCompletedHookInput
  | TaskCreatedHookInput
  | TeammateIdleHookInput
  | UserPromptExpansionHookInput
  | UserPromptSubmitHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput;

interface BaseHookResponse {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
  // terminal escape sequence (OSC 0/1/2/9/99/777, BEL) for desktop notifications and window titles (v2.1.141)
  terminalSequence?: string;
}

export interface PreToolUseHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    // "defer" pauses headless sessions at tool calls (v2.1.89)
    permissionDecision?: "allow" | "ask" | "defer" | "deny";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
  // @deprecated use hookSpecificOutput.permissionDecision instead
  decision?: "approve" | "block";
  // @deprecated use hookSpecificOutput.permissionDecisionReason instead
  reason?: string;
}

export interface PostToolUseHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "PostToolUse";
    additionalContext?: string;
    // override tool output for any tool (v2.1.121)
    updatedToolOutput?: unknown;
    // override MCP tool output (v2.1.64); prefer updatedToolOutput which works for all tools
    updatedMCPToolOutput?: unknown;
  };
}

export interface PostToolBatchHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PostToolBatch";
    additionalContext?: string;
  };
}

// fire-and-forget — output can request retry via {retry: true} (v2.1.89)
export interface PermissionDeniedHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PermissionDenied";
    retry?: boolean;
  };
}

export interface PermissionRequestHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PermissionRequest";
    decision?:
      | {
          behavior: "allow";
          updatedInput?: Record<string, unknown>;
          // updated permission suggestions (v2.1.64)
          updatedPermissions?: Record<string, unknown>[];
        }
      | {
          behavior: "deny";
          message?: string;
          interrupt?: boolean;
        };
  };
}

export interface UserPromptSubmitHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "UserPromptSubmit";
    additionalContext?: string;
    // set the session title, same effect as /rename (v2.1.94)
    sessionTitle?: string;
    // when decision is "block", omit the original prompt from the block message (v2.1.152)
    suppressOriginalPrompt?: boolean;
  };
}

export interface UserPromptExpansionHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "UserPromptExpansion";
    additionalContext?: string;
  };
}

export interface SessionStartHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "SessionStart";
    additionalContext?: string;
    initialUserMessage?: string;
    // set the session title, same effect as /rename (v2.1.152)
    sessionTitle?: string;
    // absolute paths to watch for FileChanged hooks (v2.1.83)
    watchPaths?: string[];
    // re-scan skill and command directories after SessionStart hooks complete,
    // so skills installed by the hook are available in the same session (v2.1.152)
    reloadSkills?: boolean;
  };
}

export interface StopHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
  // non-error feedback delivered to the model; the conversation continues so it can act on it (v2.1.163)
  hookSpecificOutput?: {
    hookEventName: "Stop";
    additionalContext?: string;
  };
}

// fire-and-forget — hook output and exit codes are ignored (v2.1.78)
export interface StopFailureHookResponse extends BaseHookResponse {}

export interface SubagentStopHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
  // non-error feedback delivered to the subagent; the subagent continues so it can act on it (v2.1.163)
  hookSpecificOutput?: {
    hookEventName: "SubagentStop";
    additionalContext?: string;
  };
}

export interface NotificationHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "Notification";
    additionalContext?: string;
  };
}

// exit code 2 or {"decision":"block"} blocks compaction (v2.1.105)
export interface PreCompactHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
}

export interface PostCompactHookResponse extends BaseHookResponse {}

export interface SessionEndHookResponse extends BaseHookResponse {}

export interface PostToolUseFailureHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PostToolUseFailure";
    additionalContext?: string;
  };
}

export interface SetupHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "Setup";
    additionalContext?: string;
  };
}

export interface SubagentStartHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "SubagentStart";
    additionalContext?: string;
  };
}

export interface TeammateIdleHookResponse extends BaseHookResponse {}

export interface TaskCompletedHookResponse extends BaseHookResponse {}

// fire-and-forget (v2.1.84)
export interface TaskCreatedHookResponse extends BaseHookResponse {}

export interface ConfigChangeHookResponse extends BaseHookResponse {}

export interface WorktreeCreateHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "WorktreeCreate";
    // returned by http hooks to specify the worktree path (v2.1.84)
    worktreePath?: string;
  };
}

export interface WorktreeRemoveHookResponse extends BaseHookResponse {}

export interface InstructionsLoadedHookResponse extends BaseHookResponse {}

export interface CwdChangedHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "CwdChanged";
    // absolute paths to watch for FileChanged hooks (v2.1.83)
    watchPaths?: string[];
  };
}

export interface FileChangedHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "FileChanged";
    // absolute paths to watch for FileChanged hooks (v2.1.83)
    watchPaths?: string[];
  };
}

// display-only — replaces the delta on screen without changing the stored
// message or what the model sees (v2.1.152)
export interface MessageDisplayHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "MessageDisplay";
    // text displayed in place of the delta; omit (or return the delta unchanged)
    // to display the original
    displayContent?: string;
  };
}

export interface ElicitationHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "Elicitation";
    action?: "accept" | "cancel" | "decline";
    content?: Record<string, unknown>;
  };
}

export interface ElicitationResultHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "ElicitationResult";
    action?: "accept" | "cancel" | "decline";
    content?: Record<string, unknown>;
  };
}

export type HookResponse =
  | ConfigChangeHookResponse
  | CwdChangedHookResponse
  | ElicitationHookResponse
  | ElicitationResultHookResponse
  | FileChangedHookResponse
  | InstructionsLoadedHookResponse
  | MessageDisplayHookResponse
  | NotificationHookResponse
  | PermissionDeniedHookResponse
  | PermissionRequestHookResponse
  | PostCompactHookResponse
  | PostToolBatchHookResponse
  | PostToolUseFailureHookResponse
  | PostToolUseHookResponse
  | PreCompactHookResponse
  | PreToolUseHookResponse
  | SessionEndHookResponse
  | SessionStartHookResponse
  | SetupHookResponse
  | StopFailureHookResponse
  | StopHookResponse
  | SubagentStartHookResponse
  | SubagentStopHookResponse
  | TaskCompletedHookResponse
  | TaskCreatedHookResponse
  | TeammateIdleHookResponse
  | UserPromptExpansionHookResponse
  | UserPromptSubmitHookResponse
  | WorktreeCreateHookResponse
  | WorktreeRemoveHookResponse;

export interface HookEventMap {
  ConfigChange: {
    input: ConfigChangeHookInput;
    response: ConfigChangeHookResponse | void;
  };
  CwdChanged: {
    input: CwdChangedHookInput;
    response: CwdChangedHookResponse | void;
  };
  Elicitation: {
    input: ElicitationHookInput;
    response: ElicitationHookResponse | void;
  };
  ElicitationResult: {
    input: ElicitationResultHookInput;
    response: ElicitationResultHookResponse | void;
  };
  FileChanged: {
    input: FileChangedHookInput;
    response: FileChangedHookResponse | void;
  };
  InstructionsLoaded: {
    input: InstructionsLoadedHookInput;
    response: InstructionsLoadedHookResponse | void;
  };
  MessageDisplay: {
    input: MessageDisplayHookInput;
    response: MessageDisplayHookResponse | void;
  };
  Notification: {
    input: NotificationHookInput;
    response: NotificationHookResponse | void;
  };
  PermissionDenied: {
    input: PermissionDeniedHookInput;
    response: PermissionDeniedHookResponse | void;
  };
  PermissionRequest: {
    input: PermissionRequestHookInput;
    response: PermissionRequestHookResponse | void;
  };
  PostCompact: {
    input: PostCompactHookInput;
    response: PostCompactHookResponse | void;
  };
  PostToolBatch: {
    input: PostToolBatchHookInput;
    response: PostToolBatchHookResponse | void;
  };
  PostToolUse: {
    input: PostToolUseHookInput;
    response: PostToolUseHookResponse | void;
  };
  PostToolUseFailure: {
    input: PostToolUseFailureHookInput;
    response: PostToolUseFailureHookResponse | void;
  };
  PreCompact: {
    input: PreCompactHookInput;
    response: PreCompactHookResponse | void;
  };
  PreToolUse: {
    input: PreToolUseHookInput;
    response: PreToolUseHookResponse | void;
  };
  SessionEnd: {
    input: SessionEndHookInput;
    response: SessionEndHookResponse | void;
  };
  SessionStart: {
    input: SessionStartHookInput;
    response: SessionStartHookResponse | void;
  };
  Setup: {
    input: SetupHookInput;
    response: SetupHookResponse | void;
  };
  Stop: {
    input: StopHookInput;
    response: StopHookResponse | void;
  };
  StopFailure: {
    input: StopFailureHookInput;
    response: StopFailureHookResponse | void;
  };
  SubagentStart: {
    input: SubagentStartHookInput;
    response: SubagentStartHookResponse | void;
  };
  SubagentStop: {
    input: SubagentStopHookInput;
    response: SubagentStopHookResponse | void;
  };
  TaskCompleted: {
    input: TaskCompletedHookInput;
    response: TaskCompletedHookResponse | void;
  };
  TaskCreated: {
    input: TaskCreatedHookInput;
    response: TaskCreatedHookResponse | void;
  };
  TeammateIdle: {
    input: TeammateIdleHookInput;
    response: TeammateIdleHookResponse | void;
  };
  UserPromptExpansion: {
    input: UserPromptExpansionHookInput;
    response: UserPromptExpansionHookResponse | void;
  };
  UserPromptSubmit: {
    input: UserPromptSubmitHookInput;
    response: UserPromptSubmitHookResponse | void;
  };
  WorktreeCreate: {
    input: WorktreeCreateHookInput;
    response: WorktreeCreateHookResponse | void;
  };
  WorktreeRemove: {
    input: WorktreeRemoveHookInput;
    response: WorktreeRemoveHookResponse | void;
  };
}

export type HookInput<E extends HookEventName> = HookEventMap[E]["input"];
export type HookResponseType<E extends HookEventName> = HookEventMap[E]["response"];
export type HookHandler<E extends HookEventName> = (
  input: HookInput<E>,
) => HookResponseType<E> | Promise<HookResponseType<E>>;
