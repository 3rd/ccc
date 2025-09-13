export type HookEventName =
  | "Notification"
  | "PostToolUse"
  | "PreCompact"
  | "PreToolUse"
  | "SessionEnd"
  | "SessionStart"
  | "Stop"
  | "SubagentStop"
  | "UserPromptSubmit";

export type HookMatcherType =
  | ({} & string)
  | "auto"
  | "Bash"
  | "clear"
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
}

export interface HookDefinition {
  matcher?: HookMatcherType;
  hooks: HookCommand[];
}

export type HooksConfiguration = Partial<Record<HookEventName, HookDefinition[]>>;

interface BaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

export interface PreToolUseHookInput extends BaseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PostToolUseHookInput extends BaseHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown>;
}

export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
  trigger: "auto" | "manual";
}

export interface SessionStartHookInput extends BaseHookInput {
  hook_event_name: "SessionStart";
  source: "clear" | "resume" | "startup";
}

export interface SessionEndHookInput extends BaseHookInput {
  hook_event_name: "SessionEnd";
}

export interface StopHookInput extends BaseHookInput {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
}

export interface SubagentStopHookInput extends BaseHookInput {
  hook_event_name: "SubagentStop";
}

export interface NotificationHookInput extends BaseHookInput {
  hook_event_name: "Notification";
  message: string;
}

export interface PreCompactHookInput extends BaseHookInput {
  hook_event_name: "PreCompact";
}

export type ClaudeHookInput =
  | NotificationHookInput
  | PostToolUseHookInput
  | PreCompactHookInput
  | PreToolUseHookInput
  | SessionEndHookInput
  | SessionStartHookInput
  | StopHookInput
  | SubagentStopHookInput
  | UserPromptSubmitHookInput;

interface BaseHookResponse {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
}

export interface PreToolUseHookResponse extends BaseHookResponse {
  permissionDecision?: "allow" | "ask" | "deny";
  permissionDecisionReason?: string;
  // deprecated
  decision?: "approve" | "block";
  reason?: string;
}

export interface PostToolUseHookResponse extends BaseHookResponse {
  decision?: "block";
  reason?: string;
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

export interface SessionEndHookResponse extends BaseHookResponse {
  systemMessage?: string;
}

export type HookResponse =
  | NotificationHookResponse
  | PostToolUseHookResponse
  | PreCompactHookResponse
  | PreToolUseHookResponse
  | SessionEndHookResponse
  | SessionStartHookResponse
  | StopHookResponse
  | SubagentStopHookResponse
  | UserPromptSubmitHookResponse;

export interface HookEventMap {
  PreToolUse: {
    input: PreToolUseHookInput;
    response: PreToolUseHookResponse | void;
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
  Stop: {
    input: StopHookInput;
    response: StopHookResponse | void;
  };
  SubagentStop: {
    input: SubagentStopHookInput;
    response: SubagentStopHookResponse | void;
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
