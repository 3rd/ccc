import { createPrompt } from "@/config/helpers";

// User prompts build ~/.claude/CLAUDE.md
export default createPrompt((_context) => {
  return `
## Core Guidelines

- Use TODOs and keep work organized.
- Use multiple subagents when tasks can be parallelized safely.
- NEVER run programs in the background (no "&").
- Debug systematically: add clear logs and ask the user to test specific paths.
- Do not make compromises; do exactly what was asked.
`.trim();
});
