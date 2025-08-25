import { createPrompt } from "../../../../src/config/helpers";

export default createPrompt((_context) => {
  return `
# Writing TypeScript Code

Write clean and maintainable TypeScript code that follows best practices and conventions.

Rules:
- Type things properly, do not use for \`any\` unless absolutely necessary.
- Avoid casting in general.
`;
});
