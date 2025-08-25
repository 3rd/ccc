import p from "picocolors";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

const sessionStartHook = createHook("SessionStart", (input) => {
  const timestamp = new Date().toISOString();
  console.log(p.dim("🞄"));
  console.log(`🚀 Session started from ${p.yellow(input.source)} at ${p.blue(timestamp)}`);
  console.log(`📍 Working directory: ${p.yellow(process.cwd())}`);
  console.log(`🔧 Node version: ${p.yellow(process.version)}`);
  console.log(p.dim("🞄"));
});

export default createConfigHooks({
  SessionStart: [
    {
      hooks: [sessionStartHook],
    },
  ],
  UserPromptSubmit: [],
  PreToolUse: [],
  PostToolUse: [],
  Notification: [],
  PreCompact: [],
  SubagentStop: [],
  Stop: [],
});
