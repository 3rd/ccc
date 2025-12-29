import { describe, test } from "bun:test";
import {
  assertAgentsInclude,
  assertCommandsInclude,
  assertExitCode,
  assertStdoutContains,
} from "../utils/assertions";
import { runCCC } from "../utils/test-runner";

describe("vfs injection", () => {
  test("injects commands from global config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertCommandsInclude(result.stdout, "test-command.md");
  });

  test("injects agents from global config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertAgentsInclude(result.stdout, "test-agent.md");
  });

  test("system prompt contains global config content", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-system-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    assertStdoutContains(result.stdout, "Test System Prompt");
    assertStdoutContains(result.stdout, "test assistant");
  });

  test("user prompt contains dynamic context", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-user-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // dynamic user prompt should include working directory
    assertStdoutContains(result.stdout, "Working directory:");
    assertStdoutContains(result.stdout, "typescript-basic");
  });
});
