import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ClaudeHookInput, HookCommand, HookEventName, HookHandler, HookResponse } from "@/types/hooks";
import { log } from "@/utils/log";

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
type RuntimeHookHandler = (input: ClaudeHookInput) => Promise<HookResponse | void>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const hooksMap = new Map<string, RuntimeHookHandler>();

export const getHook = (id: string) => hooksMap.get(id);

const generateHookId = <E extends HookEventName>(eventName: E, stableId: string) => {
  const hash = createHash("sha256");
  hash.update(eventName);
  hash.update(stableId);
  return `hook_${eventName}_${stableId}`;
};

const getRunnerPath = () => {
  return join(dirname(__dirname), "cli", "runner.ts");
};

export const setInstanceId = (instanceId: string, configDirectory = "config") => {
  log.debug("HOOKS", `Set instance ID: ${instanceId}, configDir=${configDirectory}`);
};

export interface CreateHookOptions<E extends HookEventName> {
  event: E;
  id: string;
  handler: HookHandler<E>;
  timeout?: number;
}

export const createHook = <E extends HookEventName>(options: CreateHookOptions<E>): HookCommand => {
  const { event, id, handler, timeout } = options;
  const hookId = generateHookId(event, id);

  hooksMap.set(hookId, handler as RuntimeHookHandler);

  const runnerPath = getRunnerPath();
  const cmd = `tsx ${runnerPath} hook ${hookId}`;

  return {
    type: "command",
    get command() {
      return cmd;
    },
    timeout,
  } satisfies HookCommand;
};
