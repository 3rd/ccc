import type * as z from "zod/v4";

export type JsonValue = JsonValue[] | { [key: string]: JsonValue } | boolean | number | string | null;

export interface WorkflowPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowPhase[];
}

export interface WorkflowAgentOpts {
  label?: string;
  phase?: string;
  schema?: Record<string, unknown>;
  model?: "haiku" | "opus" | "sonnet";
  isolation?: "worktree";
  agentType?: string;
}

export interface WorkflowBudget {
  total: number | null;
  spent: () => number;
  remaining: () => number;
}

export type WorkflowArgsSchema = z.ZodType;

export type WorkflowArgsFromSchema<TSchema> = TSchema extends WorkflowArgsSchema ? z.input<TSchema> : unknown;

export type WorkflowFirstStage<T> = (item: T, originalItem: T, index: number) => Promise<unknown> | unknown;

export type WorkflowLaterStage<T> = (prev: unknown, item: T, index: number) => Promise<unknown> | unknown;

export interface WorkflowHandlerContext<TArgs = unknown> {
  agent: <T = string>(prompt: string, opts?: WorkflowAgentOpts) => Promise<T>;
  parallel: <T>(thunks: (() => Promise<T>)[]) => Promise<(T | null)[]>;
  pipeline: <T>(
    items: T[],
    ...stages: [] | [WorkflowFirstStage<T>, ...WorkflowLaterStage<T>[]]
  ) => Promise<unknown[]>;
  phase: (title: string) => void;
  log: (message: string) => void;
  workflow: <T = unknown>(nameOrRef: { scriptPath: string } | string, args?: unknown) => Promise<T>;
  args: TArgs;
  budget: WorkflowBudget;
}

export const SANDBOX_GLOBAL_NAMES = [
  "agent",
  "parallel",
  "pipeline",
  "phase",
  "log",
  "workflow",
  "args",
  "budget",
] as const satisfies readonly (keyof WorkflowHandlerContext)[];

export type WorkflowHandler<TArgs = unknown> = (
  ctx: WorkflowHandlerContext<TArgs>,
) => Promise<unknown> | unknown;

export interface WorkflowDefinition<TArgs = unknown> extends WorkflowMeta {
  schema?: WorkflowArgsSchema;
  handler: WorkflowHandler<TArgs>;
  /**
   * Build-time gate. When `false`, CCC skips emitting this workflow to
   * `~/.claude/workflows/`. Defaults to `true`. Not part of native Claude
   * workflow metadata.
   */
  enabled?: boolean;
}

export type RemovedWorkflowDefinitionKeys = {
  body?: never;
  scriptPath?: never;
};

export type WorkflowDefinitionExtraMetadata<T> = {
  [K in Exclude<keyof T, keyof RemovedWorkflowDefinitionKeys | keyof WorkflowDefinition>]: T[K] extends (
    JsonValue
  ) ?
    T[K]
  : never;
};

export type WorkflowDefinitionInput<T extends object = WorkflowDefinition> = RemovedWorkflowDefinitionKeys &
  T &
  WorkflowDefinitionExtraMetadata<T>;

export type WorkflowDefinitionInputWithSchema<
  T extends object,
  TSchema extends WorkflowArgsSchema,
> = RemovedWorkflowDefinitionKeys &
  T &
  WorkflowDefinitionExtraMetadata<T> &
  WorkflowMeta & {
    schema: TSchema;
    handler: WorkflowHandler<WorkflowArgsFromSchema<TSchema>>;
  };

export type WorkflowDefinitionInputWithoutSchema<T extends object> = RemovedWorkflowDefinitionKeys &
  T &
  WorkflowDefinitionExtraMetadata<T> &
  WorkflowMeta & {
    schema?: undefined;
    handler: WorkflowHandler<unknown>;
  };

export interface WorkflowLayerTrace {
  layer: "global" | "plugin" | "preset" | "project";
  name?: string;
  mode: "override";
}

export interface WorkflowBuildResult {
  files: Map<string, string>;
  traces: Record<string, WorkflowLayerTrace[]>;
}
