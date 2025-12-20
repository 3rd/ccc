import { eventRecorder } from "@/hooks/event-recorder";
import { createHook } from "@/hooks/hook-generator";
import type { HookCommand, HookEventName } from "@/types/hooks";

type BuiltinCommands = Record<HookEventName, HookCommand>;

const builtins: BuiltinCommands = {
  Notification: createHook("Notification", eventRecorder.record),
  PermissionRequest: createHook("PermissionRequest", eventRecorder.record),
  PostToolUse: createHook("PostToolUse", eventRecorder.record),
  PreCompact: createHook("PreCompact", eventRecorder.record),
  PreToolUse: createHook("PreToolUse", eventRecorder.record),
  SessionEnd: createHook("SessionEnd", eventRecorder.record),
  SessionStart: createHook("SessionStart", eventRecorder.record),
  Stop: createHook("Stop", eventRecorder.record),
  SubagentStop: createHook("SubagentStop", eventRecorder.record),
  UserPromptSubmit: createHook("UserPromptSubmit", eventRecorder.record),
};

export const getBuiltinHookCommands = () => builtins;
