import { z } from "zod";
import type { JsonValue, WorkflowMeta } from "@/types/workflows";

export const WORKFLOW_SIZE_LIMIT = 524_288;

const RESERVED_META_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const WORKFLOW_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const isSafeWorkflowName = (name: string) => {
  if (!WORKFLOW_NAME_RE.test(name)) return false;
  return name.split(":").every((part) => part !== "" && part !== "." && part !== "..");
};

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const workflowPhaseSchema = z.strictObject({
  title: z.string().min(1, "phase title must be a non-empty string"),
  detail: z.string().optional(),
  model: z.string().optional(),
});

export const workflowNameSchema = z
  .string()
  .min(1, "meta.name must be a non-empty string")
  .refine(isSafeWorkflowName, {
    message: "meta.name must be a safe workflow filename segment",
  });

export const workflowMetaSchema: z.ZodType<WorkflowMeta> = z
  .strictObject({
    name: workflowNameSchema,
    description: z.string().min(1, "meta.description must be a non-empty string"),
    whenToUse: z.string().optional(),
    phases: z.array(workflowPhaseSchema).optional(),
  })
  .catchall(jsonValueSchema)
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (!RESERVED_META_KEYS.has(key)) continue;
      ctx.addIssue({
        code: "custom",
        message: `workflow metadata key "${key}" is reserved`,
        path: [key],
      });
    }
  });
