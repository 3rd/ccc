import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createHook,
  getHook,
  isSubagentLocalHookInput,
  setInternalHookCommandSource,
  setInstanceId,
} from "@/hooks/hook-generator";
import type {
  PreToolUseHookInput,
  SessionStartHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from "@/types/hooks";

const baseInput = {
  session_id: "session-1",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/tmp/project",
  permission_mode: "default" as const,
};

const createPreToolUseInput = (overrides: Partial<PreToolUseHookInput> = {}): PreToolUseHookInput => {
  return ({
    ...baseInput,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "pwd" },
    tool_use_id: "tool-1",
    ...overrides,
  })
};

const createSessionStartInput = (
  overrides: Partial<SessionStartHookInput> = {},
): SessionStartHookInput => {
  return ({
    ...baseInput,
    hook_event_name: "SessionStart",
    source: "startup",
    ...overrides,
  })
};

const createSubagentStartInput = (
  overrides: Partial<SubagentStartHookInput> = {},
): SubagentStartHookInput => {
  return ({
    ...baseInput,
    hook_event_name: "SubagentStart",
    agent_id: "agent-1",
    agent_type: "general-purpose",
    ...overrides,
  })
};

const createSubagentStopInput = (
  overrides: Partial<SubagentStopHookInput> = {},
): SubagentStopHookInput => {
  return ({
    ...baseInput,
    hook_event_name: "SubagentStop",
    stop_hook_active: false,
    agent_id: "agent-1",
    agent_transcript_path: "/tmp/agent-transcript.jsonl",
    agent_type: "general-purpose",
    ...overrides,
  })
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForExit = async (
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return child.exitCode;
    }
    await sleep(50);
  }

  throw new Error(`Process ${child.pid ?? "unknown"} did not exit within ${timeoutMs}ms`);
};

const runnerPath = join(process.cwd(), "src", "cli", "runner.ts");
const configDir = join(process.cwd(), "dev-config");
const fastTimeoutEnv = {
  CCC_HOOK_INPUT_IDLE_TIMEOUT_MS: "100",
  CCC_HOOK_INPUT_TOTAL_TIMEOUT_MS: "300",
};

describe("hook generator scope", () => {
  test("createHook defaults to passing main scope to the runner", () => {
    setInstanceId("hook-scope-test");

    const hook = createHook({
      event: "PreToolUse",
      id: "default-main-command",
      handler: () => undefined,
    });

    expect(hook.command.startsWith("sh -c ")).toBe(false);
    expect(hook.command).toContain("bun ");
    expect(hook.command).toContain("CCC_INSTANCE_ID=");
    expect(hook.command).toContain("CCC_CONFIG_DIR=");
    expect(hook.command).toContain("hook_PreToolUse_default-main-command");
    expect(hook.command).toContain("main");
  });

  test("scope all preserves the direct runner command", () => {
    const hook = createHook({
      event: "PreToolUse",
      id: "all-scope-command",
      scope: "all",
      handler: () => undefined,
    });

    expect(hook.command.startsWith("sh -c ")).toBe(false);
    expect(hook.command).toContain("bun ");
    expect(hook.command).toContain("all");
  });

  test("tagging a single hook with a source adds it to the runner command", () => {
    setInstanceId("hook-source-test");

    const hook = createHook({
      event: "PreToolUse",
      id: "source-tagged-command",
      handler: () => undefined,
    });

    setInternalHookCommandSource(hook, "config");

    expect(hook.command).toContain("hook_PreToolUse_source-tagged-command");
    expect(hook.command).toContain("'config'");
  });

  test("mixed-source hooks fall back to the legacy runner command", () => {
    setInstanceId("hook-mixed-source-test");

    const hook = createHook({
      event: "PreToolUse",
      id: "mixed-source-command",
      handler: () => undefined,
    });

    setInternalHookCommandSource(hook, "config");
    setInternalHookCommandSource(hook, "plugin");

    expect(hook.command).toContain("hook_PreToolUse_mixed-source-command");
    expect(hook.command).not.toContain("'config'");
    expect(hook.command).not.toContain("'plugin'");
  });

  test("main scope skips subagent-local events at runtime", async () => {
    let calls = 0;
    createHook({
      event: "PreToolUse",
      id: "skip-subagent-runtime",
      handler: () => {
        calls++;
      },
    });

    const hook = getHook("hook_PreToolUse_skip-subagent-runtime");
    expect(hook).toBeDefined();

    await hook?.(
      createPreToolUseInput({
        agent_id: "agent-1",
        agent_type: "general-purpose",
      }),
    );

    expect(calls).toBe(0);
  });

  test("main scope still allows subagent lifecycle hooks on the main thread", async () => {
    let calls = 0;
    createHook({
      event: "SubagentStop",
      id: "allow-subagent-stop-runtime",
      handler: () => {
        calls++;
      },
    });

    const hook = getHook("hook_SubagentStop_allow-subagent-stop-runtime");
    expect(hook).toBeDefined();

    await hook?.(createSubagentStopInput());

    expect(calls).toBe(1);
  });

  test("scope all still runs for subagent-local events", async () => {
    let calls = 0;
    createHook({
      event: "PreToolUse",
      id: "allow-all-runtime",
      scope: "all",
      handler: () => {
        calls++;
      },
    });

    const hook = getHook("hook_PreToolUse_allow-all-runtime");
    expect(hook).toBeDefined();

    await hook?.(
      createPreToolUseInput({
        agent_id: "agent-1",
        agent_type: "general-purpose",
      }),
    );

    expect(calls).toBe(1);
  });

  test("agent_type alone is not treated as a subagent-local invocation", () => {
    expect(
      isSubagentLocalHookInput(
        createSessionStartInput({
          agent_type: "reviewer",
        }),
      ),
    ).toBe(false);
  });

  test("subagent lifecycle inputs are not treated as subagent-local invocations", () => {
    expect(isSubagentLocalHookInput(createSubagentStartInput())).toBe(false);
    expect(isSubagentLocalHookInput(createSubagentStopInput())).toBe(false);
  });

  test("runner parses one hook payload without waiting for stdin EOF", async () => {
    const payload = Buffer.from(
      JSON.stringify([
        {
          hookId: "hook_PostToolUse_builtin-recorder",
          matchers: ["*"],
          scope: "main",
          source: "builtin",
        },
      ]),
      "utf8",
    ).toString("base64url");

    const child = spawn("bun", [runnerPath, "hook-batch", payload], {
      env: {
        ...process.env,
        CCC_INSTANCE_ID: "runner-stdin-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const input = {
      ...baseInput,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "true", description: "test" },
      tool_response: {
        stdout: "",
        stderr: "",
        interrupted: false,
        isImage: false,
      },
      tool_use_id: "tool-1",
    };

    child.stdin.write(JSON.stringify(input));

    try {
      const exitCode = await waitForExit(child, 5000);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });

  test("runner accepts a source-tagged single hook invocation", async () => {
    const child = spawn("bun", [runnerPath, "hook", "hook_PreToolUse_global-bash-validation", "main", "config"], {
      env: {
        ...process.env,
        CCC_INSTANCE_ID: "runner-source-tagged-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const input = {
      ...baseInput,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git reset --hard", description: "test" },
      tool_use_id: "tool-source-tagged",
    };

    child.stdin.write(JSON.stringify(input));

    try {
      const exitCode = await waitForExit(child, 5000);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        continue: true,
        decision: "block",
      });
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });

  test("runner ignores trailing stdin after the first complete JSON object", async () => {
    const child = spawn("bun", [runnerPath, "hook", "hook_PreToolUse_global-bash-validation", "main", "config"], {
      env: {
        ...process.env,
        CCC_INSTANCE_ID: "runner-trailing-stdin-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const input = {
      ...baseInput,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git reset --hard", description: "test" },
      tool_use_id: "tool-trailing-stdin",
    };

    child.stdin.write(`${JSON.stringify(input)} trailing-bytes-that-should-be-ignored`);

    try {
      const exitCode = await waitForExit(child, 5000);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        continue: true,
        decision: "block",
      });
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });

  test("runner fails fast when stdin starts with non-json data", async () => {
    const child = spawn("bun", [runnerPath, "hook", "hook_SessionStart_global-session-start", "main", "config"], {
      env: {
        ...process.env,
        ...fastTimeoutEnv,
        CCC_INSTANCE_ID: "runner-leading-garbage-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin.write("x{\"hook_event_name\":\"SessionStart\"}");

    try {
      const exitCode = await waitForExit(child, 2000);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("Hook stdin must start with a top-level JSON object");
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });

  test("runner fails on idle stdin timeout while waiting for a complete JSON object", async () => {
    const child = spawn("bun", [runnerPath, "hook", "hook_SessionStart_global-session-start", "main", "config"], {
      env: {
        ...process.env,
        ...fastTimeoutEnv,
        CCC_INSTANCE_ID: "runner-idle-timeout-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin.write("{\"hook_event_name\":\"SessionStart\"");

    try {
      const exitCode = await waitForExit(child, 2000);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("Hook stdin idle timeout after 100ms");
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });

  test("runner reports a post-tool batch stdin timeout as a non-blocking failure", async () => {
    const payload = Buffer.from(
      JSON.stringify([{ hookId: "hook_PostToolBatch_global-probe", matchers: [], scope: "main", source: "builtin" }]),
      "utf8",
    ).toString("base64url");
    const child = spawn("bun", [runnerPath, "hook-batch", payload], {
      env: {
        ...process.env,
        ...fastTimeoutEnv,
        CCC_INSTANCE_ID: "runner-post-tool-batch-timeout-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin.write("{\"hook_event_name\":\"PostToolBatch\"");

    try {
      const exitCode = await waitForExit(child, 2000);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Hook stdin idle timeout after 100ms");
    } finally {
      child.stdin.destroy();
      child.kill("SIGKILL");
      await waitForExit(child, 5000);
    }
  });

  test("runner fails on total stdin timeout when incomplete input keeps streaming", async () => {
    const child = spawn("bun", [runnerPath, "hook", "hook_SessionStart_global-session-start", "main", "config"], {
      env: {
        ...process.env,
        ...fastTimeoutEnv,
        CCC_INSTANCE_ID: "runner-total-timeout-test",
        CCC_CONFIG_DIR: configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stdin.on("error", () => {
      // expected if the runner exits while the interval is still writing
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin.write(
      '{"hook_event_name":"SessionStart","session_id":"session-1","transcript_path":"/tmp/transcript.jsonl","cwd":"/tmp/project","source":"startup","message":"',
    );

    const interval = setInterval(() => {
      if (child.exitCode !== null || child.killed || child.stdin.destroyed) {
        clearInterval(interval);
        return;
      }

      child.stdin.write("x");
    }, 25);

    try {
      const exitCode = await waitForExit(child, 2000);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("Hook stdin total timeout after 300ms");
    } finally {
      clearInterval(interval);
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });

  test("runner preserves split utf-8 characters across stdin chunks", async () => {
    const child = spawn(
      "bun",
      [runnerPath, "hook", "hook_PreToolUse_global-todowrite-validation", "main", "config"],
      {
        env: {
          ...process.env,
          CCC_INSTANCE_ID: "runner-utf8-test",
          CCC_CONFIG_DIR: configDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const marker = "€";
    const todoContent = `split-${marker}-char`;
    const input = {
      ...baseInput,
      hook_event_name: "PreToolUse",
      tool_name: "TodoWrite",
      tool_input: {
        todos: [
          {
            content: todoContent,
            status: "pending",
            activeForm: "testing",
          },
        ],
      },
      tool_use_id: "tool-utf8",
    };

    const inputBuffer = Buffer.from(JSON.stringify(input), "utf8");
    const markerIndex = inputBuffer.indexOf(Buffer.from(marker, "utf8"));
    expect(markerIndex).toBeGreaterThanOrEqual(0);

    const splitIndex = markerIndex + 1;
    child.stdin.write(inputBuffer.subarray(0, splitIndex));
    await sleep(10);
    child.stdin.write(inputBuffer.subarray(splitIndex));

    try {
      const exitCode = await waitForExit(child, 5000);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        continue: true,
        decision: "block",
      });
      expect(stdout).toContain(todoContent);
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  });
});
