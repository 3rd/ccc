import { describe, expect, test } from "bun:test";
import { isSafeWorkflowName, workflowMetaSchema } from "@/config/workflow-schema";

describe("workflow metadata schema", () => {
  test("accepts native Claude workflow metadata", () => {
    expect(
      workflowMetaSchema.safeParse({
        name: "research",
        description: "Run a research workflow",
        whenToUse: "When the user asks for research",
        phases: [{ title: "Scope" }, { title: "Search", detail: "Find sources", model: "haiku" }],
      }).success,
    ).toBe(true);
  });

  test("accepts JSON extension metadata without allowing reserved keys", () => {
    expect(
      workflowMetaSchema.safeParse({
        name: "research",
        description: "Run a research workflow",
        custom: { enabled: true, count: 1, labels: ["a", null] },
      }).success,
    ).toBe(true);
    expect(
      workflowMetaSchema.safeParse({
        name: "research",
        description: "Run a research workflow",
        constructor: "reserved",
      }).success,
    ).toBe(false);
    expect(
      workflowMetaSchema.safeParse({
        name: "research",
        description: "Run a research workflow",
        custom: { fn: () => undefined },
      }).success,
    ).toBe(false);
    expect(
      workflowMetaSchema.safeParse({
        name: "research",
        description: "Run a research workflow",
        custom: { big: 1n },
      }).success,
    ).toBe(false);
  });

  test("rejects missing required metadata", () => {
    expect(workflowMetaSchema.safeParse({ description: "missing name" }).success).toBe(false);
    expect(workflowMetaSchema.safeParse({ name: "missing-description" }).success).toBe(false);
    expect(workflowMetaSchema.safeParse({ name: "", description: "empty name" }).success).toBe(false);
    expect(workflowMetaSchema.safeParse({ name: "x", description: "" }).success).toBe(false);
  });
});

describe("workflow names", () => {
  test("accept safe local and plugin names", () => {
    expect(isSafeWorkflowName("deep-research")).toBe(true);
    expect(isSafeWorkflowName("fixture-plugin:child")).toBe(true);
    expect(isSafeWorkflowName("triage.v2")).toBe(true);
  });

  test("reject path-like names", () => {
    expect(isSafeWorkflowName("../escape")).toBe(false);
    expect(isSafeWorkflowName("nested/workflow")).toBe(false);
    expect(isSafeWorkflowName("nested\\workflow")).toBe(false);
    expect(isSafeWorkflowName("plugin:..")).toBe(false);
    expect(isSafeWorkflowName("plugin:")).toBe(false);
  });
});
