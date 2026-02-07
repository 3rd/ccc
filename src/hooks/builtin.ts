import { eventRecorder } from "@/hooks/event-recorder";
import { createHook } from "@/hooks/hook-generator";
import type { HookCommand, HookEventName } from "@/types/hooks";

type BuiltinCommands = Record<HookEventName, HookCommand>;

const builtins: BuiltinCommands = {
  Notification: createHook({ event: "Notification", id: "builtin-recorder", handler: eventRecorder.record }),
  PermissionRequest: createHook({
    event: "PermissionRequest",
    id: "builtin-recorder",
    handler: eventRecorder.record,
  }),
  PostToolUse: createHook({ event: "PostToolUse", id: "builtin-recorder", handler: eventRecorder.record }),
  PreCompact: createHook({ event: "PreCompact", id: "builtin-recorder", handler: eventRecorder.record }),
  PreToolUse: createHook({ event: "PreToolUse", id: "builtin-recorder", handler: eventRecorder.record }),
  SessionEnd: createHook({ event: "SessionEnd", id: "builtin-recorder", handler: eventRecorder.record }),
  SessionStart: createHook({ event: "SessionStart", id: "builtin-recorder", handler: eventRecorder.record }),
  Setup: createHook({ event: "Setup", id: "builtin-recorder", handler: eventRecorder.record }),
  Stop: createHook({ event: "Stop", id: "builtin-recorder", handler: eventRecorder.record }),
  SubagentStart: createHook({
    event: "SubagentStart",
    id: "builtin-recorder",
    handler: eventRecorder.record,
  }),
  SubagentStop: createHook({ event: "SubagentStop", id: "builtin-recorder", handler: eventRecorder.record }),
  TaskCompleted: createHook({
    event: "TaskCompleted",
    id: "builtin-recorder",
    handler: eventRecorder.record,
  }),
  TeammateIdle: createHook({
    event: "TeammateIdle",
    id: "builtin-recorder",
    handler: eventRecorder.record,
  }),
  UserPromptSubmit: createHook({
    event: "UserPromptSubmit",
    id: "builtin-recorder",
    handler: eventRecorder.record,
  }),
};

export const getBuiltinHookCommands = () => builtins;
