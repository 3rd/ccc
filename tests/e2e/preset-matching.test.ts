import { describe, test } from "bun:test";
import {
  assertConfigContains,
  assertExitCode,
  assertStdoutContains,
  assertStdoutNotContains,
} from "../utils/assertions";
import { runCCC } from "../utils/test-runner";

describe("preset matching", () => {
  test("typescript preset matches project with tsconfig.json", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    // typescript preset should be matched and its env var should be present
    assertConfigContains(result.stdout, "env.PRESET_TYPESCRIPT", "true");
    // preset name should appear in context
    assertStdoutContains(result.stdout, "typescript");
  });

  test("typescript preset does not match rust project", async () => {
    const result = await runCCC({
      projectDir: "rust-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    // PRESET_TYPESCRIPT should not be set for rust project
    assertStdoutNotContains(result.stdout, "PRESET_TYPESCRIPT");
  });

  test("no preset matches empty project", async () => {
    const result = await runCCC({
      projectDir: "empty-project",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    // global settings should be present
    assertConfigContains(result.stdout, "env.TEST_GLOBAL", "true");
    // but no preset-specific settings
    assertStdoutNotContains(result.stdout, "PRESET_TYPESCRIPT");
  });
});
