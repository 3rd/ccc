import { eventRecorder } from "@/hooks/event-recorder";
import { createHook } from "@/hooks/hook-generator";
import type { HookCommand, HookEventName } from "@/types/hooks";

type BuiltinCommands = Record<HookEventName, HookCommand>;

const builtins: BuiltinCommands = {
  SessionStart: createHook("SessionStart", eventRecorder.record),
  SessionEnd: createHook("SessionEnd", eventRecorder.record),
  PreToolUse: createHook("PreToolUse", eventRecorder.record),
  PostToolUse: createHook("PostToolUse", eventRecorder.record),
  UserPromptSubmit: createHook("UserPromptSubmit", eventRecorder.record),
  Notification: createHook("Notification", eventRecorder.record),
  PreCompact: createHook("PreCompact", eventRecorder.record),
  Stop: createHook("Stop", eventRecorder.record),
  SubagentStop: createHook("SubagentStop", eventRecorder.record),
};

export const getBuiltinHookCommands = () => builtins;
