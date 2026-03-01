import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ClaudeHookInput, HookCommand, HookEventName, HookHandler, HookResponse } from "@/types/hooks";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { log } from "@/utils/log";

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
type RuntimeHookHandler = (input: ClaudeHookInput) => Promise<HookResponse | void>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const launcherRoot = dirname(dirname(__dirname));

const hooksMap = new Map<string, RuntimeHookHandler>();
let currentInstanceId: string | undefined;
let currentConfigDirectory: string | undefined;

export const getHook = (id: string) => hooksMap.get(id);

const generateHookId = <E extends HookEventName>(eventName: E, stableId: string) =>
  `hook_${eventName}_${stableId}`;

const getRunnerPath = () => {
  return join(dirname(__dirname), "cli", "runner.ts");
};

const shQuote = (value: string): string => {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  timeout?: number;
  once?: boolean;
}

export const createHook = <E extends HookEventName>(options: CreateHookOptions<E>): HookCommand => {
  const { event, id, handler, timeout, once } = options;
  const hookId = generateHookId(event, id);

  hooksMap.set(hookId, handler as RuntimeHookHandler);

  return {
    type: "command",
    get command() {
      const runnerPath = getRunnerPath();
      const envPrefix = [
        process.env.DEBUG ? `DEBUG=${shQuote(process.env.DEBUG)}` : "",
        currentInstanceId ? `CCC_INSTANCE_ID=${shQuote(currentInstanceId)}` : "",
        currentConfigDirectory ? `CCC_CONFIG_DIR=${shQuote(currentConfigDirectory)}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const prefix = envPrefix.length > 0 ? `${envPrefix} ` : "";
      return `${prefix}bun ${shQuote(runnerPath)} hook ${hookId}`;
    },
    timeout,
    once,
  } satisfies HookCommand;
};
