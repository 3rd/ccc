export type HookEventName =
  | "ConfigChange"
  | "Notification"
  | "PermissionRequest"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "PreToolUse"
  | "SessionEnd"
  | "SessionStart"
  | "Setup"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCompleted"
  | "TeammateIdle"
  | "UserPromptSubmit"
  | "WorktreeCreate"
  | "WorktreeRemove";

export type HookMatcherType =
  | ({} & string)
  | "AskUserQuestion"
  | "auto"
  | "Bash"
  | "clear"
  | "compact"
  | "Edit"
  | "EnterPlanMode"
  | "ExitPlanMode"
  | "Glob"
  | "Grep"
  | "LSP"
  | "manual"
  | "MultiEdit"
  | "NotebookEdit"
  | "Read"
  | "resume"
  | "startup"
  | "Task"
  | "TaskOutput"
  | "ToolSearch"
  | "WebFetch"
  | "WebSearch"
  | "Write";

export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
  once?: boolean;
}

export interface HookPrompt {
  type: "prompt";
  prompt: string;
  timeout?: number;
}

export type HookEntry = HookCommand | HookPrompt;

export interface HookDefinition {
  matcher?: HookMatcherType;
  hooks: HookEntry[];
}

export type HooksConfiguration = Partial<Record<HookEventName, HookDefinition[]>>;

export type PermissionMode = "acceptEdits" | "bypassPermissions" | "default" | "delegate" | "dontAsk" | "plan";

interface BaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: PermissionMode;
}

export interface PreToolUseHookInput extends BaseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUseHookInput extends BaseHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown>;
  tool_use_id: string;
}

export interface PermissionRequestHookInput extends BaseHookInput {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  permission_suggestions?: Record<string, unknown>[];
}

export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: "UserPromptSubmit";
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
  reason: "bypass_permissions_disabled" | "clear" | "logout" | "other" | "prompt_input_exit";
}

export interface StopHookInput extends BaseHookInput {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  // text content of the last assistant message before stopping (v2.1.47)
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
}

export type NotificationType = "auth_success" | "elicitation_dialog" | "idle_prompt" | "permission_prompt";

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

export interface PostToolUseFailureHookInput extends BaseHookInput {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
}

export type ClaudeHookInput =
  | ConfigChangeHookInput
  | NotificationHookInput
  | PermissionRequestHookInput
  | PostToolUseFailureHookInput
  | PostToolUseHookInput
  | PreCompactHookInput
  | PreToolUseHookInput
  | SessionEndHookInput
  | SessionStartHookInput
  | SetupHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | TaskCompletedHookInput
  | TeammateIdleHookInput
  | UserPromptSubmitHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput;

interface BaseHookResponse {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
}

export interface PreToolUseHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision?: "allow" | "ask" | "deny";
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
  };
}

export interface PermissionRequestHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PermissionRequest";
    decision?: {
      behavior: "allow" | "deny";
      updatedInput?: Record<string, unknown>;
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
  };
}

export interface SessionStartHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "SessionStart";
    additionalContext?: string;
  };
}

export interface StopHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
}

export interface SubagentStopHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
}

export interface NotificationHookResponse extends BaseHookResponse {}

export interface PreCompactHookResponse extends BaseHookResponse {}

export interface SessionEndHookResponse extends BaseHookResponse {}

export interface PostToolUseFailureHookResponse extends BaseHookResponse {
  hookSpecificOutput?: {
    hookEventName: "PostToolUseFailure";
    additionalContext?: string;
  };
}

export interface SetupHookResponse extends BaseHookResponse {}

export interface SubagentStartHookResponse extends BaseHookResponse {}

export interface TeammateIdleHookResponse extends BaseHookResponse {}

export interface TaskCompletedHookResponse extends BaseHookResponse {}

export interface ConfigChangeHookResponse extends BaseHookResponse {}

export interface WorktreeCreateHookResponse extends BaseHookResponse {}

export interface WorktreeRemoveHookResponse extends BaseHookResponse {}

export type HookResponse =
  | ConfigChangeHookResponse
  | NotificationHookResponse
  | PermissionRequestHookResponse
  | PostToolUseFailureHookResponse
  | PostToolUseHookResponse
  | PreCompactHookResponse
  | PreToolUseHookResponse
  | SessionEndHookResponse
  | SessionStartHookResponse
  | SetupHookResponse
  | StopHookResponse
  | SubagentStartHookResponse
  | SubagentStopHookResponse
  | TaskCompletedHookResponse
  | TeammateIdleHookResponse
  | UserPromptSubmitHookResponse
  | WorktreeCreateHookResponse
  | WorktreeRemoveHookResponse;

export interface HookEventMap {
  PreToolUse: {
    input: PreToolUseHookInput;
    response: PreToolUseHookResponse | void;
  };
  PermissionRequest: {
    input: PermissionRequestHookInput;
    response: PermissionRequestHookResponse | void;
  };
  PostToolUse: {
    input: PostToolUseHookInput;
    response: PostToolUseHookResponse | void;
  };
  PostToolUseFailure: {
    input: PostToolUseFailureHookInput;
    response: PostToolUseFailureHookResponse | void;
  };
  UserPromptSubmit: {
    input: UserPromptSubmitHookInput;
    response: UserPromptSubmitHookResponse | void;
  };
  SessionStart: {
    input: SessionStartHookInput;
    response: SessionStartHookResponse | void;
  };
  SessionEnd: {
    input: SessionEndHookInput;
    response: SessionEndHookResponse | void;
  };
  Setup: {
    input: SetupHookInput;
    response: SetupHookResponse | void;
  };
  Stop: {
    input: StopHookInput;
    response: StopHookResponse | void;
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
  TeammateIdle: {
    input: TeammateIdleHookInput;
    response: TeammateIdleHookResponse | void;
  };
  Notification: {
    input: NotificationHookInput;
    response: NotificationHookResponse | void;
  };
  PreCompact: {
    input: PreCompactHookInput;
    response: PreCompactHookResponse | void;
  };
  ConfigChange: {
    input: ConfigChangeHookInput;
    response: ConfigChangeHookResponse | void;
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
