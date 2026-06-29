import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ClaudeHookInput, HookCommand, HookEventName, HookHandler, HookResponse } from "@/types/hooks";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { log } from "@/utils/log";
import { buildInlineEnvCommandPrefix, shQuote } from "@/utils/shell-command";

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
type RuntimeHookHandler = (input: ClaudeHookInput) => Promise<HookResponse | void>;
export type HookAgentScope = "all" | "main";
export type HookBatchCommandSource = "builtin" | "config" | "plugin";

export interface HookBatchCommandEntry {
  hookId: string;
  matchers: string[];
  scope: HookAgentScope;
  source: HookBatchCommandSource;
}

interface InternalHookCommandMetadata {
  hookId: string;
  scope: HookAgentScope;
  batchable: boolean;
  source?: HookBatchCommandSource | "mixed";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const launcherRoot = dirname(dirname(__dirname));

const hooksMap = new Map<string, RuntimeHookHandler>();
const internalHookCommandMetadata = new WeakMap<HookCommand, InternalHookCommandMetadata>();
let currentInstanceId: string | undefined;
let currentConfigDirectory: string | undefined;

export const getHook = (id: string) => hooksMap.get(id);
export const getInternalHookCommandMetadata = (
  hook: HookCommand,
): InternalHookCommandMetadata | undefined => {
  return internalHookCommandMetadata.get(hook);
};

export const setInternalHookCommandSource = (hook: HookCommand, source: HookBatchCommandSource) => {
  const metadata = internalHookCommandMetadata.get(hook);
  if (!metadata) return;

  if (!metadata.source) {
    metadata.source = source;
    return;
  }

  if (metadata.source !== source) {
    metadata.source = "mixed";
  }
};

const generateHookId = <E extends HookEventName>(eventName: E, stableId: string) =>
  `hook_${eventName}_${stableId}`;

const getRunnerPath = () => {
  return join(dirname(__dirname), "cli", "runner.ts");
};

const getHookCommandEnvPrefix = () => {
  return buildInlineEnvCommandPrefix({
    DEBUG: process.env.DEBUG,
    CCC_INSTANCE_ID: currentInstanceId,
    CCC_CONFIG_DIR: currentConfigDirectory,
    CCC_EVENTS_FILE: process.env.CCC_EVENTS_FILE,
  });
};

const getRunnerCommand = (mode: "hook-batch" | "hook", ...args: string[]) => {
  const runnerPath = getRunnerPath();
  const envPrefix = getHookCommandEnvPrefix();
  const prefix = envPrefix.length > 0 ? `${envPrefix} ` : "";
  const serializedArgs = args.map((arg) => shQuote(arg)).join(" ");
  return `${prefix}bun ${shQuote(runnerPath)} ${mode}${serializedArgs.length > 0 ? ` ${serializedArgs}` : ""}`;
};

export const isSubagentLocalHookInput = (input: ClaudeHookInput) => {
  if (!input.agent_id) return false;
  return input.hook_event_name !== "SubagentStart" && input.hook_event_name !== "SubagentStop";
};

const shouldSkipHookForScope = (scope: HookAgentScope, input: ClaudeHookInput) => {
  if (scope === "all") return false;
  return isSubagentLocalHookInput(input);
};

export const setInstanceId = (instanceId: string, configDirectory = "config") => {
  const absoluteConfigDirectory = resolveConfigDirectoryPath(launcherRoot, configDirectory);
  currentInstanceId = instanceId;
  currentConfigDirectory = absoluteConfigDirectory;
  log.debug("HOOKS", `Set instance ID: ${instanceId}, configDir=${absoluteConfigDirectory}`);
};

export interface CreateHookOptions<E extends HookEventName> {
  event: E;
  id: string;
  handler: HookHandler<E>;
  scope?: HookAgentScope;
  source?: HookBatchCommandSource;
  batchable?: boolean;
  timeout?: number;
  once?: boolean;
}

export const createHook = <E extends HookEventName>(options: CreateHookOptions<E>): HookCommand => {
  const { event, id, handler, scope = "main", source, batchable = false, timeout, once } = options;
  const hookId = generateHookId(event, id);

  hooksMap.set(hookId, async (input) => {
    if (shouldSkipHookForScope(scope, input)) return;
    return (handler as RuntimeHookHandler)(input);
  });

  const hook: HookCommand = {
    type: "command",
    get command() {
      const metadata = internalHookCommandMetadata.get(hook);
      const runtimeSource = metadata?.source && metadata.source !== "mixed" ? metadata.source : undefined;
      return getRunnerCommand("hook", hookId, scope, ...(runtimeSource ? [runtimeSource] : []));
    },
    timeout,
    once,
  };

  internalHookCommandMetadata.set(hook, { hookId, scope, batchable, source });
  return hook;
};

export const createHookBatchCommand = (entries: HookBatchCommandEntry[]): HookCommand => {
  const payload = Buffer.from(JSON.stringify(entries), "utf8").toString("base64url");
  return {
    type: "command",
    get command() {
      return getRunnerCommand("hook-batch", payload);
    },
  };
};
