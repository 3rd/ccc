export type HookEventName =
  | "Notification"
  | "PermissionRequest"
  | "PostToolUse"
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
  | "UserPromptSubmit";

export type HookMatcherType =
  | ({} & string)
  | "auto"
  | "Bash"
  | "clear"
  | "compact"
  | "Edit"
  | "Glob"
  | "Grep"
  | "manual"
  | "MultiEdit"
  | "Read"
  | "resume"
  | "startup"
  | "Task"
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

export type PermissionMode = "acceptEdits" | "bypassPermissions" | "default" | "plan";

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
}

export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

export interface SessionStartHookInput extends BaseHookInput {
  hook_event_name: "SessionStart";
  source: "clear" | "compact" | "resume" | "startup";
}

export interface SessionEndHookInput extends BaseHookInput {
  hook_event_name: "SessionEnd";
  reason: "clear" | "logout" | "other" | "prompt_input_exit";
}

export interface StopHookInput extends BaseHookInput {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
}

export interface SubagentStopHookInput extends BaseHookInput {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;
}

export type NotificationType = "auth_success" | "elicitation_dialog" | "idle_prompt" | "permission_prompt";

export interface NotificationHookInput extends BaseHookInput {
  hook_event_name: "Notification";
  message: string;
  notification_type: NotificationType;
}

export interface PreCompactHookInput extends BaseHookInput {
  hook_event_name: "PreCompact";
  trigger: "auto" | "manual";
  custom_instructions: string;
}

export interface SetupHookInput extends BaseHookInput {
  hook_event_name: "Setup";
  source: "init-only" | "init" | "maintenance";
}

export interface SubagentStartHookInput extends BaseHookInput {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type?: string;
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
  task_description: string;
  teammate_name: string;
  team_name: string;
}

export type ClaudeHookInput =
  | NotificationHookInput
  | PermissionRequestHookInput
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
  | UserPromptSubmitHookInput;

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
  /** @deprecated use hookSpecificOutput.permissionDecision instead */
  decision?: "approve" | "block";
  /** @deprecated use hookSpecificOutput.permissionDecisionReason instead */
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

export interface SetupHookResponse extends BaseHookResponse {}

export interface SubagentStartHookResponse extends BaseHookResponse {}

export interface TeammateIdleHookResponse extends BaseHookResponse {}

export interface TaskCompletedHookResponse extends BaseHookResponse {}

export type HookResponse =
  | NotificationHookResponse
  | PermissionRequestHookResponse
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
  | UserPromptSubmitHookResponse;

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
}

export type HookInput<E extends HookEventName> = HookEventMap[E]["input"];
export type HookResponseType<E extends HookEventName> = HookEventMap[E]["response"];
export type HookHandler<E extends HookEventName> = (
  input: HookInput<E>,
) => HookResponseType<E> | Promise<HookResponseType<E>>;
