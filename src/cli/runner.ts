#!/usr/bin/env tsx
import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getHook } from "@/hooks/hook-generator";
import { eventRecorder } from "@/hooks/event-recorder";
import type { ClaudeHookInput } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
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

const resolveConfigDirectory = (): string => {
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

const discover = (kind: "hooks" | "mcps"): string[] => {
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

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
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

const runHook = async (id: string) => {
  const inputJson = await readStdin();
  if (!inputJson) {
    console.error("No input received on stdin");
    process.exit(2);
  }

  let input: ClaudeHookInput;
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
    input = parsed as ClaudeHookInput;
  } catch (error) {
    console.error("Invalid hook input JSON:", error);
    process.exit(2);
  }

  // Critical: bind hook runner to a stable instance id before loading plugins.
  // Prefer launcher-provided CCC_INSTANCE_ID (passed via hook command env).
  // Fallback to hook input session_id only when env is absent.
  if (!process.env.CCC_INSTANCE_ID && typeof input.session_id === "string" && input.session_id.length > 0) {
    process.env.CCC_INSTANCE_ID = input.session_id;
  }

  // import all hooks configs to register handlers
  for (const href of discover("hooks")) await import(href);

  // also load CCC plugin hooks
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
  if (!mcpConfig) {
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

  if (!mode || !id || (mode !== "hook" && mode !== "mcp")) {
    console.error("Usage: runner.ts <hook|mcp> <id>");
    process.exit(2);
  }

  try {
    if (mode === "hook") {
      await runHook(id);
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
