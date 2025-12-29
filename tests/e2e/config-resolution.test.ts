import { describe, test } from "bun:test";
import { assertConfigContains, assertExitCode, assertStdoutContains } from "../utils/assertions";
import { runCCC } from "../utils/test-runner";

describe("config resolution", () => {
  test("loads global settings from minimal config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertConfigContains(result.stdout, "env.TEST_MINIMAL", "true");
  });

  test("loads global settings from full-featured config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertConfigContains(result.stdout, "env.TEST_GLOBAL", "true");
    assertConfigContains(result.stdout, "env.FEATURE_FLAG", "enabled");
  });

  test("merges preset settings with global settings", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    // typescript preset should add PRESET_TYPESCRIPT env var
    assertConfigContains(result.stdout, "env.PRESET_TYPESCRIPT", "true");
    // global settings should still be present
    assertConfigContains(result.stdout, "env.TEST_GLOBAL", "true");
  });

  test("user prompt appends preset content", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-user-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // should contain base user prompt
    assertStdoutContains(result.stdout, "Test User Prompt");
    // should contain appended content from typescript preset
    assertStdoutContains(result.stdout, "TypeScript Preset Additions");
  });
});
