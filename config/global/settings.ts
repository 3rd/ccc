import { createConfigFullSettings } from "@/config/helpers";

export default createConfigFullSettings({
  model: "auto",
  env: {
    DISABLE_BUG_COMMAND: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_TELEMETRY: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0",
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
    MAX_THINKING_TOKENS: "24000",
    BASH_DEFAULT_TIMEOUT_MS: "120000",
    BASH_MAX_TIMEOUT_MS: "600000",
    BASH_MAX_OUTPUT_LENGTH: "100000",
    USE_BUILTIN_RIPGREP: "0",
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
    DISABLE_COST_WARNINGS: "1",
  },
  permissions: {
    defaultMode: "default", // if you're looking for bypassPermissions, it goes here
    deny: [
      //
      "Bash(git add:*)",
      "Bash(git mv:*)",
      "Bash(git rm:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git checkout:*)",
      "Bash(git switch:*)",
      "Bash(git merge:*)",
      "Bash(git rebase:*)",
      "Bash(git reset:*)",
      "Bash(git restore:*)",
      "Bash(git tag:*)",
      "Read(./.env)",
      "Read(./.env.*)",
    ],
  },
  includeCoAuthoredBy: false,
});
