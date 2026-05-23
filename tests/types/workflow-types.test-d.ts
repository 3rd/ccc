// type-level test: this file must typecheck cleanly. exercises the workflow
// authoring surface without executing anything.
import { createWorkflow } from "@/config/helpers";
import { z } from "zod/v4";

type Bug = { title: string; file: string };

export const workflowDefinition = createWorkflow({
  name: "x",
  description: "y",
  whenToUse: "when useful",
  phases: [{ title: "scan" }, { title: "verify", model: "haiku" }],
  customMeta: { enabled: true, labels: ["a", null] },
  handler: async ({ agent, parallel, pipeline, phase, log, workflow, args, budget }) => {
    phase("scan");
    log("hi");

    const r1: string = await agent("hello");
    const r2: string = await agent("hi", { label: "x", phase: "scan", model: "haiku" });
    const r3: Bug = await agent<Bug>("find a bug", { schema: {} });

    const par: Array<string | null> = await parallel([() => agent("a"), () => agent("b")]);
    const pip: unknown[] = await pipeline(
      ["a", "b"],
      (item: string) => agent(`echo ${item}`),
      (prev: unknown, item: string, index: number) => `${String(prev)}-${item}-${index}`,
    );

    const nested = await workflow("child", { foo: 1 });
    const nestedScript = await workflow({ scriptPath: "./other.js" });

    const total: number | null = budget.total;
    const spent: number = budget.spent();
    const remaining: number = budget.remaining();

    let argHello: unknown = undefined;
    if (typeof args === "object" && args !== null && "hello" in args) {
      argHello = args.hello;
    }

    return { r1, r2, r3, par, pip, nested, nestedScript, total, spent, remaining, argHello };
  },
});

const workflowArgsSchema = z.object({
  topic: z.string(),
  includeRisks: z.boolean().optional(),
  scanLabels: z.array(z.string()).optional(),
});

export const schemaWorkflowDefinition = createWorkflow({
  name: "schema",
  description: "schema args",
  schema: workflowArgsSchema,
  customMeta: { enabled: true },
  handler: ({ args }) => {
    const topic: string = args.topic;
    const includeRisks: boolean | undefined = args.includeRisks;
    const scanLabels: string[] | undefined = args.scanLabels;
    return { topic, includeRisks, scanLabels };
  },
});

export const unknownArgsWorkflowDefinition = createWorkflow({
  name: "unknown-args",
  description: "unknown args",
  handler: ({ args }) => {
    // @ts-expect-error - args remain unknown unless schema is provided
    return args.topic;
  },
});
