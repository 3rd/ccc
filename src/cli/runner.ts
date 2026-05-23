#!/usr/bin/env bun
import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { StringDecoder } from "string_decoder";
import { fileURLToPath, pathToFileURL } from "url";
import { doesHookBatchEntryMatchInput } from "@/hooks/batching";
import { eventRecorder } from "@/hooks/event-recorder";
import {
  getHook,
  type HookAgentScope,
  type HookBatchCommandEntry,
  type HookBatchCommandSource,
  isSubagentLocalHookInput,
} from "@/hooks/hook-generator";
import type { ClaudeHookInput } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import { isMCPLayerDisabled } from "@/types/mcps";
import { buildPlugins } from "@/config/builders/build-plugins";
import { loadConfigFromLayers, mergeMCPs } from "@/config/layers";
import { Context } from "@/context/Context";
import { createMCPProxy } from "@/mcps/mcp-generator";
import { loadCCCPluginsFromConfig } from "@/plugins";
import { getPluginMCPs } from "@/plugins/registry";
import "@/hooks/builtin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const launcherRoot = dirname(dirname(__dirname));

const resolveConfigDirectory = () => {
  const override = process.env.CCC_CONFIG_DIR?.trim();
  if (override) {
    if (existsSync(override)) return override;
    const maybeRelative = join(launcherRoot, override);
    if (existsSync(maybeRelative)) return maybeRelative;
  }

  const dev = join(launcherRoot, "dev-config");
  if (existsSync(dev)) return dev;
  return join(launcherRoot, "config");
};

const discover = (kind: "hooks" | "mcps") => {
  const cfgDir = resolveConfigDirectory();
  const out: string[] = [];

  const pushIf = (p: string) => {
    if (existsSync(p)) out.push(p);
  };

  // global
  pushIf(join(cfgDir, "global", `${kind}.ts`));

  // presets
  const presetsDir = join(cfgDir, "presets");
  if (existsSync(presetsDir)) {
    for (const entry of readdirSync(presetsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) pushIf(join(presetsDir, entry.name, `${kind}.ts`));
    }
  }

  // projects
  const projectsDir = join(cfgDir, "projects");
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) pushIf(join(projectsDir, entry.name, `${kind}.ts`));
    }
  }

  return out.map((p) => pathToFileURL(p).href);
};

const getHookInputTimeoutMs = (envName: string, fallbackMs: number) => {
  const rawValue = process.env[envName]?.trim();
  if (!rawValue) return fallbackMs;

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return fallbackMs;
  return parsedValue;
};

const HOOK_INPUT_IDLE_TIMEOUT_MS = getHookInputTimeoutMs("CCC_HOOK_INPUT_IDLE_TIMEOUT_MS", 5000);
const HOOK_INPUT_TOTAL_TIMEOUT_MS = getHookInputTimeoutMs("CCC_HOOK_INPUT_TOTAL_TIMEOUT_MS", 10_000);

const readStdin = async () => {
  return new Promise<string>((resolve, reject) => {
    let jsonCandidate = "";
    let isSettled = false;
    const decoder = new StringDecoder("utf8");
    let hasStartedJson = false;
    let jsonDepth = 0;
    let inString = false;
    let isEscaped = false;
    let idleTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }

      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = undefined;
      }
    };

    const cleanup = () => {
      clearTimers();
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
    };

    const finish = (value: string) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(error);
    };

    const scheduleIdleTimeout = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(
          new Error(
            `Hook stdin idle timeout after ${HOOK_INPUT_IDLE_TIMEOUT_MS}ms before a complete JSON object was received`,
          ),
        );
      }, HOOK_INPUT_IDLE_TIMEOUT_MS);
      idleTimer.unref?.();
    };

    const consumeText = (text: string) => {
      for (const char of text) {
        if (!hasStartedJson) {
          if (/\s/u.test(char)) continue;
          if (char !== "{") {
            fail(
              new Error(`Hook stdin must start with a top-level JSON object, got ${JSON.stringify(char)}`),
            );
            return;
          }

          hasStartedJson = true;
          jsonDepth = 1;
          jsonCandidate = "{";
          continue;
        }

        jsonCandidate += char;

        if (inString) {
          if (isEscaped) {
            isEscaped = false;
            continue;
          }

          if (char === "\\") {
            isEscaped = true;
            continue;
          }

          if (char === '"') {
            inString = false;
          }

          continue;
        }

        if (char === '"') {
          inString = true;
          continue;
        }

        if (char === "{") {
          jsonDepth += 1;
          continue;
        }

        if (char === "}") {
          jsonDepth -= 1;
          if (jsonDepth === 0) {
            finish(jsonCandidate);
            return;
          }
        }
      }
    };

    const onData = (chunk: Buffer | string) => {
      scheduleIdleTimeout();
      consumeText(typeof chunk === "string" ? chunk : decoder.write(chunk));
    };

    const onEnd = () => {
      if (isSettled) return;
      consumeText(decoder.end());
      if (isSettled) return;

      if (!hasStartedJson) {
        fail(new Error("No input received on stdin"));
        return;
      }

      fail(new Error("Hook stdin ended before a complete JSON object was received"));
    };

    const onError = (error: Error) => {
      fail(error);
    };

    scheduleIdleTimeout();
    totalTimer = setTimeout(() => {
      fail(
        new Error(
          `Hook stdin total timeout after ${HOOK_INPUT_TOTAL_TIMEOUT_MS}ms before a complete JSON object was received`,
        ),
      );
    }, HOOK_INPUT_TOTAL_TIMEOUT_MS);
    totalTimer.unref?.();

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
};

const loadCCCPlugins = async (context: Context) => {
  const pluginsConfig = await buildPlugins(context);
  const loadResult = await loadCCCPluginsFromConfig(context, pluginsConfig.ccc ?? {});

  for (const err of loadResult.discoveryErrors) {
    console.warn(`CCC plugin discovery error: ${err.path} - ${err.error}`);
  }
  for (const err of loadResult.loadErrors) {
    console.warn(`CCC plugin load error: ${err.plugin} - ${err.error}`);
  }

  return loadResult.plugins;
};

const readHookInput = async (): Promise<ClaudeHookInput> => {
  let inputJson: string;
  try {
    inputJson = await readStdin();
  } catch (error) {
    console.error(error instanceof Error ? error.message : `Failed to read hook input: ${String(error)}`);
    process.exit(2);
  }

  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("hook_event_name" in parsed) ||
      !("session_id" in parsed) ||
      !("cwd" in parsed)
    ) {
      console.error("Invalid hook input shape:", parsed);
      process.exit(2);
    }
    return parsed as ClaudeHookInput;
  } catch (error) {
    console.error("Invalid hook input JSON:", error);
    process.exit(2);
  }
};

const bindHookInstanceId = (input: ClaudeHookInput) => {
  // Critical: bind hook runner to a stable instance id before loading plugins.
  // Prefer launcher-provided CCC_INSTANCE_ID (passed via hook command env).
  // Fallback to hook input session_id only when env is absent.
  if (!process.env.CCC_INSTANCE_ID && typeof input.session_id === "string" && input.session_id.length > 0) {
    process.env.CCC_INSTANCE_ID = input.session_id;
  }
};

const loadHookRuntime = async (
  input: ClaudeHookInput,
  options: {
    loadConfigHooks: boolean;
    loadPlugins: boolean;
  },
) => {
  if (options.loadConfigHooks) {
    for (const href of discover("hooks")) {
      await import(href);
    }
  }

  if (!options.loadPlugins) {
    return;
  }

  const contextCwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const context = new Context(contextCwd);
  await context.init();
  const loadedPlugins = await loadCCCPlugins(context);
  context.loadedPlugins = loadedPlugins;

  // trigger plugin hooks registration
  for (const plugin of loadedPlugins) {
    if (plugin.enabled && plugin.definition.hooks) {
      plugin.definition.hooks(plugin.context);
    }
  }
};

const decodeBatchEntries = (payload: string): HookBatchCommandEntry[] => {
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed)) {
      throw new TypeError("Batch payload must be an array");
    }

    return parsed.map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("hookId" in entry) ||
        typeof entry.hookId !== "string" ||
        !("scope" in entry) ||
        (entry.scope !== "all" && entry.scope !== "main") ||
        !("source" in entry) ||
        (entry.source !== "builtin" && entry.source !== "config" && entry.source !== "plugin")
      ) {
        throw new Error("Invalid batch hook entry");
      }

      const matchers =
        "matchers" in entry && Array.isArray(entry.matchers) ?
          entry.matchers.filter((matcher: unknown): matcher is string => typeof matcher === "string")
        : [];

      return {
        hookId: entry.hookId,
        matchers,
        scope: entry.scope,
        source: entry.source,
      };
    });
  } catch (error) {
    console.error("Invalid hook batch payload:", error);
    process.exit(2);
  }
};

const runHook = async (id: string, scope: HookAgentScope = "main", source?: HookBatchCommandSource) => {
  const input = await readHookInput();
  if (scope === "main" && isSubagentLocalHookInput(input)) {
    process.exit(0);
  }

  bindHookInstanceId(input);

  const runtimeOptions =
    source === "builtin" ? { loadConfigHooks: false, loadPlugins: false }
    : source === "config" ? { loadConfigHooks: true, loadPlugins: false }
    : source === "plugin" ? { loadConfigHooks: true, loadPlugins: true }
    : { loadConfigHooks: true, loadPlugins: true };

  await loadHookRuntime(input, {
    loadConfigHooks: runtimeOptions.loadConfigHooks,
    loadPlugins: runtimeOptions.loadPlugins,
  });

  const fn = getHook(id);
  if (!fn) {
    console.error("Hook not found:", id);
    process.exit(2);
  }

  try {
    const result = await Promise.resolve(fn(input));
    eventRecorder.recordHookCall(id, input, result);
    if (result) {
      const json = JSON.stringify(result);
      process.stdout.write(`${json}\n`);
    }
    process.exit(0);
  } catch (error) {
    eventRecorder.recordHookCall(id, input, undefined, error);
    throw error;
  }
};

const runHookBatch = async (payload: string) => {
  const input = await readHookInput();
  const entries = decodeBatchEntries(payload);
  const matchingEntries = entries.filter((entry) => doesHookBatchEntryMatchInput(entry, input));

  if (matchingEntries.length === 0) {
    process.exit(0);
  }

  bindHookInstanceId(input);

  await loadHookRuntime(input, {
    loadConfigHooks: matchingEntries.some((entry) => entry.source === "config"),
    loadPlugins: matchingEntries.some((entry) => entry.source === "plugin"),
  });

  const settled = await Promise.allSettled(
    matchingEntries.map(async (entry) => {
      const fn = getHook(entry.hookId);
      if (!fn) {
        throw new Error(`Hook not found: ${entry.hookId}`);
      }

      const result = await Promise.resolve(fn(input));
      if (result !== undefined) {
        throw new Error(`Batchable hook ${entry.hookId} returned hook output`);
      }

      return { entry };
    }),
  );
  const errors: string[] = [];

  for (const [index, entry] of matchingEntries.entries()) {
    const result = settled[index];

    if (!entry || !result) continue;

    if (result.status === "fulfilled") {
      eventRecorder.recordHookCall(entry.hookId, input);
      continue;
    }

    eventRecorder.recordHookCall(entry.hookId, input, undefined, result.reason);
    errors.push(
      `${entry.hookId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  process.exit(0);
};

const runMCP = async (mcpName: string) => {
  const context = new Context(process.cwd());
  await context.init();

  // load CCC plugins for their MCPs
  const loadedPlugins = await loadCCCPlugins(context);
  context.loadedPlugins = loadedPlugins;

  // find MCP (check both config layers and plugins)
  const layers = await loadConfigFromLayers<MCPServers>(context, "mcps.ts");
  const merged = mergeMCPs(layers.global, ...layers.presets, layers.project);

  // add plugin MCPs
  const pluginMCPs = getPluginMCPs(loadedPlugins);
  Object.assign(merged, pluginMCPs);

  const mcpConfig = merged[mcpName];
  if (!mcpConfig || isMCPLayerDisabled(mcpConfig)) {
    console.error(`MCP not found: ${mcpName}`);
    process.exit(2);
  }

  if (mcpConfig.type === "inline") {
    const factory = mcpConfig.config;
    const server = await factory(context);
    await server.start({ transportType: "stdio" });
    return;
  }

  if (mcpConfig.type === "traditional" || mcpConfig.type === "http" || mcpConfig.type === "sse") {
    const config = mcpConfig.config;
    if ("filter" in config && typeof config.filter === "function") {
      const proxyData = createMCPProxy(config, config.filter);
      if (proxyData.type === "inline") {
        const server = await proxyData.config(context);
        await server.start({ transportType: "stdio" });
      }
    } else {
      console.error(`Cannot run external MCP '${mcpName}' without filter`);
      process.exit(2);
    }
  }
};

const main = async () => {
  const mode = process.argv[2];
  const id = process.argv[3];
  const scopeArg = process.argv[4];
  const sourceArg = process.argv[5];

  if (
    !mode ||
    !id ||
    (mode !== "hook" && mode !== "hook-batch" && mode !== "mcp" && mode !== "popup-input")
  ) {
    console.error("Usage: runner.ts <hook|hook-batch|mcp|popup-input> <id> [scope] [source]");
    process.exit(2);
  }

  const scope: HookAgentScope = scopeArg === "all" ? "all" : "main";
  const source: HookBatchCommandSource | undefined =
    sourceArg === "builtin" || sourceArg === "config" || sourceArg === "plugin" ? sourceArg : undefined;

  try {
    if (mode === "popup-input") {
      const { runPopupInput } = await import("@/cli/tui/popup-input-runner");
      runPopupInput(id);
      return;
    }

    if (mode === "hook") {
      await runHook(id, scope, source);
    } else if (mode === "hook-batch") {
      await runHookBatch(id);
    } else {
      await runMCP(id);
    }
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error && "stderr" in error) {
      const output = error as { stdout?: string; stderr?: string };
      console.error(`${mode.toUpperCase()} runner failed:`);
      if (output.stdout) console.error(output.stdout);
      if (output.stderr) console.error(output.stderr);
    } else {
      console.error(`${mode.toUpperCase()} runner failed:`, error);
    }
    process.exit(2);
  }
};

main();
