import { describe, expect, test } from "bun:test";
import {
  batchHookDefinitionsForEvent,
  doesHookBatchEntryMatchInput,
  isBatchableInternalHookCommand,
  type SourcedHookDefinition,
} from "@/hooks/batching";
import {
  createHook,
  getInternalHookCommandMetadata,
  type HookBatchCommandEntry,
} from "@/hooks/hook-generator";
import type {
  HookCommand,
  PreToolUseHookInput,
  TaskCompletedHookInput,
} from "@/types/hooks";

const baseInput = {
  session_id: "session-1",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/tmp/project",
  permission_mode: "default" as const,
};

const createPreToolUseInput = (
  overrides: Partial<PreToolUseHookInput> = {},
): PreToolUseHookInput => {
  return ({
    ...baseInput,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "pwd" },
    tool_use_id: "tool-1",
    ...overrides,
  })
};

const createTaskCompletedInput = (
  overrides: Partial<TaskCompletedHookInput> = {},
): TaskCompletedHookInput => {
  return ({
    ...baseInput,
    hook_event_name: "TaskCompleted",
    task_id: "task-1",
    task_subject: "ship it",
    ...overrides,
  })
};

const decodeBatchEntries = (hook: HookCommand): HookBatchCommandEntry[] => {
  const match = hook.command.match(/hook-batch '([^']+)'/);
  expect(match).toBeTruthy();
  const payload = match?.[1];
  if (!payload) {
    throw new Error("Expected hook-batch payload");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as HookBatchCommandEntry[];
};

describe("hook batching", () => {
  test("collapses batchable internal hooks into one batch command and keeps explicit hook fields unbatched", () => {
    const sharedHook = createHook({
      event: "PreToolUse",
      id: "batched-shared",
      batchable: true,
      handler: () => undefined,
    });
    const specificHook = createHook({
      event: "PreToolUse",
      id: "batched-specific",
      scope: "all",
      batchable: true,
      handler: () => undefined,
    });
    const onceHook = createHook({
      event: "PreToolUse",
      id: "batched-once",
      batchable: true,
      handler: () => undefined,
      once: true,
    });

    const definitions: SourcedHookDefinition[] = [
      { source: "builtin", hooks: [sharedHook] },
      { source: "config", matcher: "Bash", hooks: [sharedHook, specificHook] },
      { source: "plugin", hooks: [onceHook] },
      { source: "config", hooks: [{ type: "prompt", prompt: "review this" }] },
    ];

    const batched = batchHookDefinitionsForEvent(definitions);

    expect(batched).toHaveLength(3);
    expect(batched[0]?.matcher).toBeUndefined();
    expect(batched[0]?.hooks).toHaveLength(1);
    expect(batched[0]?.hooks[0]?.type).toBe("command");
    expect(batched[1]).toEqual({ hooks: [onceHook] });
    expect(batched[2]).toEqual({ hooks: [{ type: "prompt", prompt: "review this" }] });

    const batchCommand = batched[0]?.hooks[0];
    expect(batchCommand?.type).toBe("command");

    if (!batchCommand || batchCommand.type !== "command") {
      throw new Error("Expected a batch command");
    }

    expect(batchCommand.command).toContain(" hook-batch ");

    const batchEntries = decodeBatchEntries(batchCommand);
    expect(batchEntries).toHaveLength(2);

    const sharedMetadata = getInternalHookCommandMetadata(sharedHook);
    const specificMetadata = getInternalHookCommandMetadata(specificHook);
    expect(sharedMetadata).toBeDefined();
    expect(specificMetadata).toBeDefined();
    if (!sharedMetadata || !specificMetadata) {
      throw new Error("Expected hook metadata");
    }

    const sharedEntry = batchEntries.find((entry) => entry.hookId === sharedMetadata.hookId);
    const specificEntry = batchEntries.find((entry) => entry.hookId === specificMetadata.hookId);

    expect(sharedEntry).toEqual({
      hookId: sharedMetadata.hookId,
      matchers: ["*"],
      scope: "main",
      source: "config",
    });
    expect(specificEntry).toEqual({
      hookId: specificMetadata.hookId,
      matchers: ["Bash"],
      scope: "all",
      source: "config",
    });
  });

  test("only batches hooks that explicitly opt in and still honors Claude per-entry fields", () => {
    const plainHook = createHook({
      event: "PreToolUse",
      id: "plain-unbatchable",
      handler: () => undefined,
    });
    const batchableHook = createHook({
      event: "PreToolUse",
      id: "plain-batchable",
      batchable: true,
      handler: () => undefined,
    });
    const timeoutHook = createHook({
      event: "PreToolUse",
      id: "timeout-unbatchable",
      batchable: true,
      handler: () => undefined,
      timeout: 5,
    });
    const onceHook = createHook({
      event: "PreToolUse",
      id: "once-unbatchable",
      batchable: true,
      handler: () => undefined,
      once: true,
    });
    const statusMessageHook = createHook({
      event: "PreToolUse",
      id: "status-message-unbatchable",
      batchable: true,
      handler: () => undefined,
    });
    statusMessageHook.statusMessage = "watching";

    const asyncHook = createHook({
      event: "PreToolUse",
      id: "async-unbatchable",
      batchable: true,
      handler: () => undefined,
    });
    asyncHook.async = true;

    const asyncRewakeHook = createHook({
      event: "PreToolUse",
      id: "async-rewake-unbatchable",
      batchable: true,
      handler: () => undefined,
    });
    asyncRewakeHook.asyncRewake = true;

    const onFailureHook = createHook({
      event: "PreToolUse",
      id: "on-failure-unbatchable",
      batchable: true,
      handler: () => undefined,
    });
    onFailureHook.onFailure = "block";

    expect(isBatchableInternalHookCommand(plainHook)).toBe(false);
    expect(isBatchableInternalHookCommand(batchableHook)).toBe(true);
    expect(isBatchableInternalHookCommand(timeoutHook)).toBe(false);
    expect(isBatchableInternalHookCommand(onceHook)).toBe(false);
    expect(isBatchableInternalHookCommand(statusMessageHook)).toBe(false);
    expect(isBatchableInternalHookCommand(asyncHook)).toBe(false);
    expect(isBatchableInternalHookCommand(asyncRewakeHook)).toBe(false);
    expect(isBatchableInternalHookCommand(onFailureHook)).toBe(false);
  });

  test("preserves main-scope filtering and matcher behavior in the batch runner", () => {
    const batchEntry: HookBatchCommandEntry = {
      hookId: "hook_PreToolUse_scope-test",
      matchers: ["Bash"],
      scope: "main",
      source: "config",
    };

    expect(doesHookBatchEntryMatchInput(batchEntry, createPreToolUseInput())).toBe(true);
    expect(
      doesHookBatchEntryMatchInput(
        batchEntry,
        createPreToolUseInput({
          agent_id: "agent-1",
          agent_type: "general-purpose",
        }),
      ),
    ).toBe(false);
    expect(
      doesHookBatchEntryMatchInput(
        {
          ...batchEntry,
          matchers: ["Bash"],
        },
        createTaskCompletedInput(),
      ),
    ).toBe(true);
  });
});
