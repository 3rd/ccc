# Type-Level Tests

Files ending in `.test-d.ts` are compiled by `bun typecheck` through the repository `tsconfig.json`.
They are not executed by `bun test`; failures surface as TypeScript diagnostics.
