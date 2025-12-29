import { createPrompt } from "@/config/helpers";

export default createPrompt(
  (context) => `
# Test User Prompt

Working directory: ${context.workingDirectory}

## Test Instructions

This is a test user prompt for E2E testing.
`,
);
