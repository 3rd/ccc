import { describe, expect, test } from "bun:test";
import { assertExitCode, assertStdoutContains } from "../utils/assertions";
import { runCCC } from "../utils/test-runner";

describe("launcher", () => {
  test("--print-config exits successfully with minimal config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertStdoutContains(result.stdout, "Settings:");
    assertStdoutContains(result.stdout, "Commands:");
    assertStdoutContains(result.stdout, "Agents:");
  });

  test("--print-system-prompt outputs system prompt", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-system-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // should contain content from full-featured/config/global/prompts/system.md
    assertStdoutContains(result.stdout, "Test System Prompt");
  });

  test("--print-user-prompt outputs user prompt", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-user-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // should contain content from the user prompt
    assertStdoutContains(result.stdout, "Test User Prompt");
  });

  test("--doctor runs diagnostics", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--doctor"],
    });

    assertExitCode(result.exitCode, 0);
    // doctor output should contain diagnostic info
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
