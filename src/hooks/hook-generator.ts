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
let currentInstanceId: string | null = null;
let currentConfigDirectory = "config";

export const getHook = (id: string) => hooksMap.get(id);

const generateHookId = <E extends HookEventName>(eventName: E, handler: HookHandler<E>) => {
  const hash = createHash("sha256");
  hash.update(eventName);
  hash.update(handler.toString());
  return `hook_${eventName}_${hash.digest("hex").slice(0, 8)}`;
};

const getRunnerPath = () => {
  return join(dirname(__dirname), "cli", "runner.ts");
};

export const setInstanceId = (instanceId: string, configDirectory = "config") => {
  currentInstanceId = instanceId;
  currentConfigDirectory = configDirectory;
  log.debug("HOOKS", `Set instance ID: ${instanceId}, configDir=${configDirectory}`);
};

export const createHook = <E extends HookEventName>(
  eventName: E,
  handler: HookHandler<E>,
  options?: { timeout?: number },
): HookCommand => {
  const hookId = generateHookId(eventName, handler);

  hooksMap.set(hookId, handler as RuntimeHookHandler);

  const runnerPath = getRunnerPath();
  const cmd = `tsx ${runnerPath} hook ${hookId}`;

  return {
    type: "command",
    get command() {
      return cmd;
    },
    timeout: options?.timeout,
  } satisfies HookCommand;
};
