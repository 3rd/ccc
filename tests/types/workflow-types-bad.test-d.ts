import { createWorkflow } from "@/config/helpers";
import { z } from "zod/v4";

export const missingName =
  // @ts-expect-error - name is required
  createWorkflow({ description: "y", handler: () => undefined });

export const missingDescription =
  // @ts-expect-error - description is required
  createWorkflow({ name: "x", handler: () => undefined });

export const missingHandler =
  // @ts-expect-error - handler is required
  createWorkflow({ name: "x", description: "y" });

export const invalidPhase =
  // @ts-expect-error - phase title is required
  createWorkflow({ name: "x", description: "y", phases: [{}], handler: () => undefined });

export const wrongArgs = createWorkflow({
  name: "x",
  description: "y",
  handler: async ({ agent, phase, parallel, budget, pipeline }) => {
    // @ts-expect-error - phase expects string, not number
    phase(123);
    // @ts-expect-error - agent prompt is string, not number
    await agent(42);
    // @ts-expect-error - agent opts.model is restricted enum, "gpt" not allowed
    await agent("hi", { model: "gpt" });
    // @ts-expect-error - parallel expects array of thunks, not array of values
    await parallel([1, 2, 3]);
    // @ts-expect-error - budget has no `foo` property
    void budget.foo;
    // @ts-expect-error - budget.spent is a function, not a number property
    const s: number = budget.spent;
    void s;

    // @ts-expect-error - items are number[] so item is number, not string
    await pipeline([1, 2, 3], (item: string) => String(item));
  },
});

export const agentGeneric = createWorkflow({
  name: "x",
  description: "y",
  handler: async ({ agent }) => {
    type Bug = { title: string };
    const bug = await agent<Bug>("find", { schema: {} });
    // @ts-expect-error - bug.nope is not on Bug
    void bug.nope;
  },
});

export const removedBody =
  // @ts-expect-error - body is not part of the workflow authoring API
  createWorkflow({ name: "x", description: "y", body: "phase('x');", handler: () => undefined });

export const removedScriptPath =
  // @ts-expect-error - scriptPath is not part of the workflow authoring API
  createWorkflow({ scriptPath: "./foo.js" });

export const nonJsonExtraFunction =
  // @ts-expect-error - extra metadata values must be JSON-compatible
  createWorkflow({ name: "x", description: "y", custom: () => undefined, handler: () => undefined });

export const nonJsonNestedExtraFunction =
  // @ts-expect-error - nested extra metadata values must be JSON-compatible
  createWorkflow({ name: "x", description: "y", custom: { fn: () => undefined }, handler: () => undefined });

export const nonJsonExtraBigInt =
  // @ts-expect-error - bigint is not JSON-compatible metadata
  createWorkflow({ name: "x", description: "y", custom: { big: 1n }, handler: () => undefined });

export const nonJsonExtraUndefined =
  // @ts-expect-error - undefined is not JSON-compatible metadata
  createWorkflow({ name: "x", description: "y", custom: undefined, handler: () => undefined });

const argsSchema = z.object({ topic: z.string() });

export const wrongSchemaArgType = createWorkflow({
  name: "schema",
  description: "schema",
  schema: argsSchema,
  handler: ({ args }) => {
    // @ts-expect-error - schema infers topic as string
    const topic: number = args.topic;
    return topic;
  },
});

export const nonZodSchema =
  // @ts-expect-error - workflow schema must be a Zod v4 schema
  createWorkflow({ name: "schema", description: "schema", schema: { type: "object" }, handler: () => undefined });
