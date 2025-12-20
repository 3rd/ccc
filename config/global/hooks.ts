import p from "picocolors";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";
// import { getSessionContext } from "@/hooks/session-context";

const sessionStartHook = createHook("SessionStart", (input) => {
  const timestamp = new Date().toISOString();
  console.log(p.dim("🞄"));
  console.log(`🚀 Session started from ${p.yellow(input.source)} at ${p.blue(timestamp)}`);
  console.log(`📍 Working directory: ${p.yellow(process.cwd())}`);
  console.log(`🔧 Node version: ${p.yellow(process.version)}`);
  console.log(p.dim("🞄"));
});

// Example: context-aware hook that tracks tool usage
// const contextAwareHook = createHook("PreToolUse", (input) => {
//   const context = getSessionContext();
//   const events: PreToolUseHookInput[] = [];
//   for (const e of context.events) {
//     if (e.input.hook_event_name === "PreToolUse") {
//       events.push(e.input);
//     }
//   }
// });

export default createConfigHooks({
  SessionStart: [
    {
      hooks: [sessionStartHook],
    },
  ],
  UserPromptSubmit: [],
  // PreToolUse: [
  //   { hooks: [ contextAwareHook ] },
  // ],
  PermissionRequest: [],
  PostToolUse: [],
  Notification: [],
  PreCompact: [],
  SubagentStop: [],
  Stop: [],
});
