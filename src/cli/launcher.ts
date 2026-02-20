#!/usr/bin/env tsx
import * as fs from "fs";
import { createRequire } from "node:module";
import * as path from "path";
import p from "picocolors";
import { which } from "zx";
import { setInstanceId } from "@/hooks/hook-generator";
import type { AgentDefinition } from "@/config/schema";
import { runDoctor } from "@/cli/doctor";
import { buildAgents } from "@/config/builders/build-agents";
import { buildCommands } from "@/config/builders/build-commands";
import { buildMCPs } from "@/config/builders/build-mcps";
import { buildPlugins } from "@/config/builders/build-plugins";
import { buildRules } from "@/config/builders/build-rules";
import { buildSettings, buildSystemPrompt, buildUserPrompt } from "@/config/builders/build-settings";
import { buildSkills } from "@/config/builders/build-skills";
import { dumpConfig } from "@/config/dump-config";
import { Context } from "@/context/Context";
import { applyBuiltInPatches, applyUserPatches, type RuntimePatch } from "@/patches/cli-patches";
import { getPluginInfo, loadCCCPluginsFromConfig } from "@/plugins";
import { log } from "@/utils/log";
import { createStartupLogger } from "@/utils/startup";
import { setupVirtualFileSystem } from "@/utils/virtual-fs";

type ResolveResult = { path: string; source: string };

const resolveClaudeCli = async (launcherRoot: string): Promise<ResolveResult> => {
  if (process.env.CLAUDE_PATH) {
    return { path: process.env.CLAUDE_PATH, source: "env override" };
  }

  // try node_modules/.bin/claude
  const localBinPath = path.join(launcherRoot, "node_modules/.bin/claude");
  if (fs.existsSync(localBinPath)) {
    return { path: fs.realpathSync(localBinPath), source: "local bin" };
  }

  // try resolving the package
  try {
    const req = createRequire(import.meta.url);
    const claudePkgPath = req.resolve("@anthropic-ai/claude-code/package.json", {
      paths: [launcherRoot],
    });
    const claudeDir = path.dirname(claudePkgPath);
    const claudePkg = JSON.parse(fs.readFileSync(claudePkgPath, "utf8"));
    const mainEntry = claudePkg.bin?.["claude"] || claudePkg.main || "cli.js";
    const claudeModulePath = path.join(claudeDir, mainEntry);

    if (fs.existsSync(claudeModulePath)) {
      return { path: claudeModulePath, source: "local package" };
    }
  } catch {}

  // fallback to global claude
  try {
    const claudeBinPath = await which("claude");
    return { path: fs.realpathSync(claudeBinPath), source: "global bin" };
  } catch {
    throw new Error("Could not find Claude Code neither in node_modules nor globally.");
  }
};

// eslint-disable-next-line sonarjs/cognitive-complexity
const run = async () => {
  const shouldEnableLogger = (): boolean => {
    const interactive = Boolean(process.stdout.isTTY);
    const debug = Boolean(process.env.DEBUG);
    const args = process.argv;
    const quietFlags = [
      "--print-config",
      "--print-system-prompt",
      "--print-user-prompt",
      "--dump-config",
      "--doctor",
      "--json",
      "--debug-mcp",
      "--debug-mcp-run",
      "--timing",
    ];
    const hasQuiet = quietFlags.some((f) => args.includes(f));
    return interactive && !debug && !hasQuiet;
  };

  const startup = createStartupLogger({ enabled: shouldEnableLogger() });

  // init context
  const ctxTask = startup.start("Resolve project context");
  const context = new Context(process.cwd());
  await context.init();
  setInstanceId(context.instanceId, context.configDirectory);
  process.env.CCC_INSTANCE_ID = context.instanceId;

  // create temp file for events
  const os = await import("os");
  const crypto = await import("crypto");
  const tmpDir = os.tmpdir();
  const randomId = crypto.randomBytes(6).toString("hex");
  const eventsFile = path.join(tmpDir, `ccc-events-${randomId}.jsonl`);
  fs.writeFileSync(eventsFile, "");
  process.env.CCC_EVENTS_FILE = eventsFile;

  // clean up events file on exit
  const cleanupEventsFile = () => {
    try {
      if (fs.existsSync(eventsFile)) fs.unlinkSync(eventsFile);
    } catch {}
  };
  process.on("exit", cleanupEventsFile);
  process.on("SIGINT", () => {
    cleanupEventsFile();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanupEventsFile();
    process.exit(0);
  });

  ctxTask.done();

  const pluginsConfig = await startup.run("Build plugins", () => buildPlugins(context));

  // discover and load CCC plugins
  const pluginTask = startup.start("Load CCC plugins");
  try {
    const loadResult = await loadCCCPluginsFromConfig(context, pluginsConfig.ccc ?? {});
    context.loadedPlugins = loadResult.plugins;

    for (const err of loadResult.discoveryErrors) {
      log.warn("PLUGINS", `Discovery error: ${err.path} - ${err.error}`);
    }
    for (const err of loadResult.loadErrors) {
      log.warn("PLUGINS", `Load error: ${err.plugin} - ${err.error}`);
    }

    const count = loadResult.plugins.length;
    pluginTask.done(count > 0 ? `${count} plugin(s)` : "none");
  } catch (error) {
    pluginTask.fail("failed");
    log.error("PLUGINS", `Plugin loading failed: ${error}`);
  }

  // build MCPs first so context.hasMCP() is available during prompt building
  const mcps = await startup.run("Build MCPs", () => buildMCPs(context));
  context.mcpServers = mcps;

  // build remaining configuration in parallel
  const settingsPromise = startup.run("Build settings", () => buildSettings(context));
  const systemPromptPromise = startup.run("Build system prompt", () => buildSystemPrompt(context));
  const userPromptPromise = startup.run("Build user prompt", () => buildUserPrompt(context));
  const commandsPromise = startup.run("Build commands", () => buildCommands(context));
  const agentsPromise = startup.run("Build agents", () => buildAgents(context));
  const skillsPromise = startup.run("Build skills", () => buildSkills(context));
  const rulesPromise = startup.run("Build rules", () => buildRules(context));
  const [settings, systemPrompt, userPrompt, commands, agents, skills, rules] = await Promise.all([
    settingsPromise,
    systemPromptPromise,
    userPromptPromise,
    commandsPromise,
    agentsPromise,
    skillsPromise,
    rulesPromise,
  ]);

  const settingsWithPlugins = {
    ...settings,
    ...(pluginsConfig.claude?.enabledPlugins && { enabledPlugins: pluginsConfig.claude.enabledPlugins }),
    ...(pluginsConfig.claude?.extraKnownMarketplaces && {
      extraKnownMarketplaces: pluginsConfig.claude.extraKnownMarketplaces,
    }),
  };

  // --debug-mcp-run <name> (internal handler for debugging inline MCPs)
  const debugMcpRunIndex = process.argv.indexOf("--debug-mcp-run");
  if (debugMcpRunIndex !== -1) {
    const mcpName = process.argv[debugMcpRunIndex + 1];
    if (!mcpName) {
      console.error(p.red("Error: --debug-mcp-run requires an MCP name"));
      process.exit(1);
    }

    // load MCP
    const { loadConfigFromLayers, mergeMCPs } = await import("@/config/layers");
    const layers = await loadConfigFromLayers<import("@/types/mcps").MCPServers>(context, "mcps.ts");
    const mergedMcpServers = mergeMCPs(layers.global, ...layers.presets, layers.project);
    const mcpData = mergedMcpServers[mcpName];
    if (!mcpData || mcpData.type !== "inline") {
      console.error(p.red(`Error: MCP "${mcpName}" not found or not an inline MCP`));
      process.exit(1);
    }

    // start server
    console.error(`Debug mode: Starting inline MCP server "${mcpName}"...`);
    const server = await mcpData.config(context);
    await server.start({
      transportType: "stdio",
    });

    return;
  }

  // --debug-mcp <name>
  const debugMcpIndex = process.argv.indexOf("--debug-mcp");
  if (debugMcpIndex !== -1) {
    const mcpName = process.argv[debugMcpIndex + 1];
    if (!mcpName) {
      console.error(p.red("Error: --debug-mcp requires an MCP name"));
      console.error(p.gray("Usage: ccc --debug-mcp <mcp-name>"));
      process.exit(1);
    }
    const { debugMCP } = await import("@/cli/debug-mcp");

    const processedMcps = await buildMCPs(context);
    const { loadConfigFromLayers, mergeMCPs } = await import("@/config/layers");
    const layers = await loadConfigFromLayers<import("@/types/mcps").MCPServers>(context, "mcps.ts");
    const mergedMcpServers = mergeMCPs(layers.global, ...layers.presets, layers.project);

    await debugMCP(context, mergedMcpServers, mcpName, processedMcps);
    process.exit(0);
  }

  // --doctor
  if (process.argv.includes("--doctor")) {
    await runDoctor(
      context,
      {
        settings: settingsWithPlugins as Record<string, unknown>,
        systemPrompt,
        userPrompt,
        commands,
        agents,
        skills,
        rules,
        mcps,
      },
      { json: process.argv.includes("--json") },
    );
    process.exit(0);
  }

  // --print-config
  if (process.argv.includes("--print-config")) {
    console.log(p.blue("\nSettings:"));
    console.log(JSON.stringify(settings, null, 2));
    console.log(p.blue("\nPlugins:"));
    console.log(JSON.stringify(pluginsConfig, null, 2));
    console.log(p.blue("\nSkills:"));
    if (skills.length === 0) {
      console.log("  (none)");
    } else {
      for (const skill of skills) {
        console.log(`  ${skill.name} (${skill.files.length} files)`);
      }
    }
    console.log(p.blue("\nSystem prompt:"));
    console.log(systemPrompt.slice(0, 200) + (systemPrompt.length > 200 ? "..." : ""));
    console.log(p.blue("\nUser prompt:"));
    console.log(userPrompt.slice(0, 200) + (userPrompt.length > 200 ? "..." : ""));
    console.log(p.blue("\nCommands:"));
    console.log(Array.from(commands.keys()));
    console.log(p.blue("\nAgents:"));
    console.log(Array.from(agents.keys()));
    console.log(p.blue("\nRules:"));
    console.log(Array.from(rules.keys()));
    console.log(p.blue("\nMCPs:"));
    console.log(mcps);
    console.log(p.blue("\nCCC Plugins:"));
    const pluginInfos = getPluginInfo(context.loadedPlugins);
    if (pluginInfos.length === 0) {
      console.log("  (none)");
    } else {
      for (const info of pluginInfos) {
        console.log(`  ${info.name} (v${info.version}) [${info.enabled ? "enabled" : "disabled"}]`);
        if (info.components.commands.length > 0) {
          console.log(`    Commands: ${info.components.commands.join(", ")}`);
        }
        if (info.components.agents.length > 0) {
          console.log(`    Agents: ${info.components.agents.join(", ")}`);
        }
        if (info.components.mcps.length > 0) {
          console.log(`    MCPs: ${info.components.mcps.join(", ")}`);
        }
        const hookEvents = Object.entries(info.components.hooks)
          .filter(([, count]) => count > 0)
          .map(([event, count]) => `${event}(${count})`)
          .join(", ");
        if (hookEvents) {
          console.log(`    Hooks: ${hookEvents}`);
        }
        if (info.components.prompts.system || info.components.prompts.user) {
          const promptTypes = [];
          if (info.components.prompts.system) promptTypes.push("system");
          if (info.components.prompts.user) promptTypes.push("user");
          console.log(`    Prompts: ${promptTypes.join(", ")}`);
        }
      }
    }
    console.log(p.blue("\nContext:"));
    console.log(context);
    process.exit(0);
  }

  // --print-system-prompt
  if (process.argv.includes("--print-system-prompt")) {
    console.log(systemPrompt);
    process.exit(0);
  }

  // --print-user-prompt
  if (process.argv.includes("--print-user-prompt")) {
    console.log(userPrompt);
    process.exit(0);
  }

  // --dump-config
  if (process.argv.includes("--dump-config")) {
    await dumpConfig(context, {
      settings: settingsWithPlugins as Record<string, unknown>,
      systemPrompt,
      userPrompt,
      commands,
      agents,
      skills,
      mcps,
    });
    process.exit(0);
  }

  // --timing
  if (process.argv.includes("--timing")) {
    startup.printTiming();
    process.exit(0);
  }

  // init logging
  log.init(context.workingDirectory, context.instanceId);
  log.info("LAUNCHER", "Starting CCC launcher");
  log.info("LAUNCHER", `Working directory: ${context.workingDirectory}`);
  log.debug("PROJECT", "Project context information:");
  log.debug("PROJECT", `  Instance ID: ${context.instanceId}`);
  log.debug("PROJECT", `  Launcher directory: ${context.launcherDirectory}`);
  log.debug("PROJECT", `  Root directory: ${context.project.rootDirectory}`);
  log.debug("PROJECT", `  Is Git repo: ${context.isGitRepo()}`);
  log.debug(
    "PROJECT",
    `  Git branch: ${context.isGitRepo() ? context.getGitBranch() : "Not inside a git repository"}`,
  );
  log.debug("PROJECT", `  Platform: ${context.getPlatform()}`);
  log.debug("PROJECT", `  OS Version: ${context.getOsVersion()}`);
  if (context.project.tags && context.project.tags.length > 0) {
    log.debug("PROJECT", `Project tags: ${context.project.tags.join(", ")}`);
  }
  log.debug("PRESETS", "Detected project presets:");
  if (context.project.presets.length > 0) {
    for (const preset of context.project.presets) {
      log.debug("PRESETS", `  - ${preset.name}`);
    }
  } else {
    log.debug("PRESETS", "  No presets detected");
  }
  if (context.project.projectConfig) {
    log.debug("PROJECT-CONFIG", `Using project configuration: ${context.project.projectConfig.name}`);
  } else {
    log.debug("PROJECT-CONFIG", "No project-specific configuration found");
  }

  log.debug("CONFIG-SOURCES", "Configuration layer sources:");
  log.debug("CONFIG-SOURCES", "  1. Global configuration: config/global/");
  if (context.project.presets.length > 0) {
    log.debug("CONFIG-SOURCES", `  2. Preset configurations:`);
    for (const preset of context.project.presets) {
      log.debug("CONFIG-SOURCES", `    - `, `config/presets/${preset.name}/`);
    }
  }
  if (context.project.projectConfig) {
    log.debug(
      "CONFIG-SOURCES",
      `  3. Project configuration: config/projects/${context.project.projectConfig.name}/`,
    );
  }
  log.debug("BUILD-SUMMARY", "Built configuration components:");
  log.debug("BUILD-SUMMARY", `  Settings keys: ${Object.keys(settings).join(", ")}`);
  log.debug("BUILD-SUMMARY", `  System prompt length: ${systemPrompt.length} chars`);
  log.debug("BUILD-SUMMARY", `  User prompt length: ${userPrompt.length} chars`);
  log.debug(
    "BUILD-SUMMARY",
    `  Commands: ${commands.size} files (${Array.from(commands.keys()).join(", ")})`,
  );
  log.debug("BUILD-SUMMARY", `  Agents: ${agents.size} files (${Array.from(agents.keys()).join(", ")})`);
  log.debug("BUILD-SUMMARY", `  Rules: ${rules.size} files (${Array.from(rules.keys()).join(", ")})`);
  log.debug("BUILD-SUMMARY", `  MCPs: ${Object.keys(mcps || {}).join(", ") || "none"}`);

  // resolve claude cli path first (needed for runtime patches in VFS)
  const resolveTask = startup.start("Resolve Claude CLI");
  let claudeModulePath: string;
  try {
    const resolved = await resolveClaudeCli(context.launcherDirectory);
    claudeModulePath = resolved.path;
    log.info("LAUNCHER", `Found Claude CLI: ${claudeModulePath}`);
    resolveTask.done(resolved.source);
  } catch (error) {
    resolveTask.fail("Claude CLI not found");
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // extract runtime patches from settings
  const patches = (settings as { patches?: RuntimePatch[] }).patches;

  // setup vfs
  await startup.run("Mount VFS", async () => {
    setupVirtualFileSystem({
      settings: settingsWithPlugins as unknown as Record<string, unknown>,
      userPrompt,
      commands,
      agents,
      skills,
      rules,
      workingDirectory: context.workingDirectory,
      disableParentClaudeMds: context.project.projectConfig?.disableParentClaudeMds,
    });
  });

  // build args
  const args: string[] = [];
  args.push("--mcp-config", JSON.stringify({ mcpServers: mcps }));
  args.push("--append-system-prompt", systemPrompt);

  // pass through --plugin-dir args from CLI or plugins config
  const cliPluginDirs = process.argv
    .map((arg, i, arr) => (arr[i - 1] === "--plugin-dir" ? arg : null))
    .filter((dir): dir is string => dir !== null);

  for (const dir of cliPluginDirs) {
    args.push("--plugin-dir", dir);
  }

  if (cliPluginDirs.length === 0 && pluginsConfig.claude?.pluginDirs) {
    for (const dir of pluginsConfig.claude.pluginDirs) {
      args.push("--plugin-dir", dir);
    }
  }

  // pass through CLI-only flags from settings.cli (CLI args override settings)
  // see: https://code.claude.com/docs/en/cli-reference#cli-flags
  type CliFlags = {
    tools?: string[] | "default";
    disallowedTools?: string[];
    allowedTools?: string[];
    addDir?: string[];
    permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions" | "delegate" | "dontAsk";
    verbose?: boolean;
    debug?: boolean | string;
    chrome?: boolean;
    ide?: boolean;
    enableLspLogging?: boolean;
    agent?: string;
    agents?: Record<string, AgentDefinition>;
    forkSession?: boolean;
    fallbackModel?: string;
    settingSources?: ("local" | "project" | "user")[];
    strictMcpConfig?: boolean;
    loopy?: boolean;
    init?: boolean;
    initOnly?: boolean;
    maintenance?: boolean;
    model?: string;
    systemPrompt?: string;
    systemPromptFile?: string;
    mcpDebug?: boolean;
    outputFormat?: "json" | "stream-json" | "text";
    disableSlashCommands?: boolean;
    maxBudgetUsd?: number;
    dangerouslySkipPermissions?: boolean;
    sessionId?: string;
    fromPr?: string | number;
    teammateMode?: "auto" | "in-process" | "tmux";
    appendSystemPrompt?: string;
    appendSystemPromptFile?: string;
    betas?: string[];
    maxTurns?: number;
    noSessionPersistence?: boolean;
    permissionPromptTool?: string;
    includePartialMessages?: boolean;
    inputFormat?: "text" | "stream-json";
    jsonSchema?: string;
    allowDangerouslySkipPermissions?: boolean;
    settings?: string;
    effort?: "low" | "medium" | "high" | "max";
    file?: string[];
    debugFile?: string;
    replayUserMessages?: boolean;
    // create a new git worktree for this session (v2.1.49)
    worktree?: boolean | string;
    // create a tmux session for the worktree (requires --worktree) (v2.1.49)
    tmux?: boolean | string;
  };
  const settingsCli = (settings as { cli?: CliFlags }).cli || {};

  const hasCliArg = (flag: string) => process.argv.includes(flag);

  // --tools (comma-separated, "default", or "" to disable)
  if (!hasCliArg("--tools") && settingsCli.tools !== undefined) {
    if (settingsCli.tools === "default") {
      args.push("--tools", "default");
    } else if (Array.isArray(settingsCli.tools)) {
      args.push("--tools", settingsCli.tools.length > 0 ? settingsCli.tools.join(",") : "");
    }
  }

  // --disallowedTools (comma-separated)
  if (!hasCliArg("--disallowedTools") && settingsCli.disallowedTools?.length) {
    args.push("--disallowedTools", settingsCli.disallowedTools.join(","));
  }

  // --allowedTools (comma-separated)
  if (!hasCliArg("--allowedTools") && settingsCli.allowedTools?.length) {
    args.push("--allowedTools", settingsCli.allowedTools.join(","));
  }

  // --add-dir (multiple flags, one per dir)
  if (!hasCliArg("--add-dir") && settingsCli.addDir?.length) {
    for (const dir of settingsCli.addDir) {
      args.push("--add-dir", dir);
    }
  }

  // --permission-mode
  if (!hasCliArg("--permission-mode") && settingsCli.permissionMode) {
    args.push("--permission-mode", settingsCli.permissionMode);
  }

  // --verbose
  if (!hasCliArg("--verbose") && settingsCli.verbose) {
    args.push("--verbose");
  }

  // --debug (boolean or string filter)
  if (!hasCliArg("--debug") && settingsCli.debug !== undefined) {
    if (typeof settingsCli.debug === "string") {
      args.push("--debug", settingsCli.debug);
    } else if (settingsCli.debug) {
      args.push("--debug");
    }
  }

  // --chrome / --no-chrome
  if (!hasCliArg("--chrome") && !hasCliArg("--no-chrome") && settingsCli.chrome !== undefined) {
    args.push(settingsCli.chrome ? "--chrome" : "--no-chrome");
  }

  // --ide
  if (!hasCliArg("--ide") && settingsCli.ide) {
    args.push("--ide");
  }

  // --enable-lsp-logging
  if (!hasCliArg("--enable-lsp-logging") && settingsCli.enableLspLogging) {
    args.push("--enable-lsp-logging");
  }

  // --agent
  if (!hasCliArg("--agent") && settingsCli.agent) {
    args.push("--agent", settingsCli.agent);
  }

  // --agents (JSON string)
  if (!hasCliArg("--agents") && settingsCli.agents && Object.keys(settingsCli.agents).length > 0) {
    args.push("--agents", JSON.stringify(settingsCli.agents));
  }

  // --fork-session
  if (!hasCliArg("--fork-session") && settingsCli.forkSession) {
    args.push("--fork-session");
  }

  // --fallback-model
  if (!hasCliArg("--fallback-model") && settingsCli.fallbackModel) {
    args.push("--fallback-model", settingsCli.fallbackModel);
  }

  // --setting-sources (comma-separated)
  if (!hasCliArg("--setting-sources") && settingsCli.settingSources?.length) {
    args.push("--setting-sources", settingsCli.settingSources.join(","));
  }

  // --strict-mcp-config
  if (!hasCliArg("--strict-mcp-config") && settingsCli.strictMcpConfig) {
    args.push("--strict-mcp-config");
  }

  // --loopy
  if (!hasCliArg("--loopy") && settingsCli.loopy) {
    args.push("--loopy");
  }

  // --init (v2.1.10)
  if (!hasCliArg("--init") && settingsCli.init) {
    args.push("--init");
  }

  // --init-only (v2.1.10)
  if (!hasCliArg("--init-only") && settingsCli.initOnly) {
    args.push("--init-only");
  }

  // --maintenance (v2.1.10)
  if (!hasCliArg("--maintenance") && settingsCli.maintenance) {
    args.push("--maintenance");
  }

  // --model (v1.0.111)
  if (!hasCliArg("--model") && settingsCli.model) {
    args.push("--model", settingsCli.model);
  }

  // --system-prompt (v2.0.64)
  if (!hasCliArg("--system-prompt") && settingsCli.systemPrompt) {
    args.push("--system-prompt", settingsCli.systemPrompt);
  }

  // --system-prompt-file (v1.0.51)
  if (!hasCliArg("--system-prompt-file") && settingsCli.systemPromptFile) {
    args.push("--system-prompt-file", settingsCli.systemPromptFile);
  }

  // --mcp-debug (v0.2.31)
  if (!hasCliArg("--mcp-debug") && settingsCli.mcpDebug) {
    args.push("--mcp-debug");
  }

  // --output-format (v0.2.66)
  if (!hasCliArg("--output-format") && settingsCli.outputFormat) {
    args.push("--output-format", settingsCli.outputFormat);
  }

  // --disable-slash-commands (v2.0.60)
  if (!hasCliArg("--disable-slash-commands") && settingsCli.disableSlashCommands) {
    args.push("--disable-slash-commands");
  }

  // --max-budget-usd (v2.0.28)
  if (!hasCliArg("--max-budget-usd") && settingsCli.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(settingsCli.maxBudgetUsd));
  }

  // --dangerously-skip-permissions (v2.0.31)
  if (!hasCliArg("--dangerously-skip-permissions") && settingsCli.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  // --session-id (v2.0.73)
  if (!hasCliArg("--session-id") && settingsCli.sessionId) {
    args.push("--session-id", settingsCli.sessionId);
  }

  // --from-pr (v2.1.27)
  if (!hasCliArg("--from-pr") && settingsCli.fromPr !== undefined) {
    args.push("--from-pr", String(settingsCli.fromPr));
  }

  // --teammate-mode (v2.1.32)
  if (!hasCliArg("--teammate-mode") && settingsCli.teammateMode) {
    args.push("--teammate-mode", settingsCli.teammateMode);
  }

  // --append-system-prompt (v2.1.32)
  if (!hasCliArg("--append-system-prompt") && settingsCli.appendSystemPrompt) {
    args.push("--append-system-prompt", settingsCli.appendSystemPrompt);
  }

  // --append-system-prompt-file (v2.1.32)
  if (!hasCliArg("--append-system-prompt-file") && settingsCli.appendSystemPromptFile) {
    args.push("--append-system-prompt-file", settingsCli.appendSystemPromptFile);
  }

  // --betas (comma-separated)
  if (!hasCliArg("--betas") && settingsCli.betas?.length) {
    args.push("--betas", settingsCli.betas.join(","));
  }

  // --max-turns (number, print mode only)
  if (!hasCliArg("--max-turns") && settingsCli.maxTurns !== undefined) {
    args.push("--max-turns", String(settingsCli.maxTurns));
  }

  // --no-session-persistence (print mode only)
  if (!hasCliArg("--no-session-persistence") && settingsCli.noSessionPersistence) {
    args.push("--no-session-persistence");
  }

  // --permission-prompt-tool (non-interactive mode)
  if (!hasCliArg("--permission-prompt-tool") && settingsCli.permissionPromptTool) {
    args.push("--permission-prompt-tool", settingsCli.permissionPromptTool);
  }

  // --include-partial-messages (requires print + stream-json)
  if (!hasCliArg("--include-partial-messages") && settingsCli.includePartialMessages) {
    args.push("--include-partial-messages");
  }

  // --input-format (print mode only)
  if (!hasCliArg("--input-format") && settingsCli.inputFormat) {
    args.push("--input-format", settingsCli.inputFormat);
  }

  // --json-schema (print mode only)
  if (!hasCliArg("--json-schema") && settingsCli.jsonSchema) {
    args.push("--json-schema", settingsCli.jsonSchema);
  }

  // --allow-dangerously-skip-permissions
  if (!hasCliArg("--allow-dangerously-skip-permissions") && settingsCli.allowDangerouslySkipPermissions) {
    args.push("--allow-dangerously-skip-permissions");
  }

  // --settings (path to settings file or JSON string)
  if (!hasCliArg("--settings") && settingsCli.settings) {
    args.push("--settings", settingsCli.settings);
  }

  // --effort (low, medium, high, max)
  if (!hasCliArg("--effort") && settingsCli.effort) {
    args.push("--effort", settingsCli.effort);
  }

  // --file (multiple flags, one per file spec)
  if (!hasCliArg("--file") && !hasCliArg("--files") && settingsCli.file?.length) {
    for (const f of settingsCli.file) {
      args.push("--file", f);
    }
  }

  // --debug-file (path to write debug logs)
  if (!hasCliArg("--debug-file") && settingsCli.debugFile) {
    args.push("--debug-file", settingsCli.debugFile);
  }

  // --replay-user-messages (stream-json mode)
  if (!hasCliArg("--replay-user-messages") && settingsCli.replayUserMessages) {
    args.push("--replay-user-messages");
  }

  // --worktree [name] (v2.1.49)
  if (!hasCliArg("--worktree") && !hasCliArg("-w") && settingsCli.worktree !== undefined) {
    if (typeof settingsCli.worktree === "string") {
      args.push("--worktree", settingsCli.worktree);
    } else if (settingsCli.worktree) {
      args.push("--worktree");
    }
  }

  // --tmux (requires --worktree) (v2.1.49)
  if (!hasCliArg("--tmux") && settingsCli.tmux !== undefined) {
    if (typeof settingsCli.tmux === "string") {
      args.push("--tmux", settingsCli.tmux);
    } else if (settingsCli.tmux) {
      args.push("--tmux");
    }
  }

  log.info("LAUNCHER", `Launching Claude from: ${claudeModulePath}`);
  log.debug("LAUNCHER", `Arguments: ${args.join(" ")}`);
  log.debug("LAUNCHER", `Additional args from CLI: ${process.argv.slice(2).join(" ") || "none"}`);
  log.info("LAUNCHER", `Log file: ${log.getLogPath()}`);

  // apply runtime patches to CLI file (ESM imports bypass VFS)
  let importPath = claudeModulePath;
  const osModule = await import("os");
  const cryptoModule = await import("crypto");

  let content = fs.readFileSync(claudeModulePath, "utf8");
  const allApplied: string[] = [];

  // apply built-in patches (lsp fixes, feature disabling)
  const builtIn = applyBuiltInPatches(content);
  content = builtIn.content;
  allApplied.push(...builtIn.applied);

  // apply user-defined patches from settings
  if (patches && patches.length > 0) {
    const user = applyUserPatches(content, patches);
    content = user.content;
    allApplied.push(...user.applied);
  }

  if (allApplied.length > 0) {
    // write patched CLI to temp file
    const patchTmpDir = osModule.tmpdir();
    const hash = cryptoModule.createHash("md5").update(content).digest("hex").slice(0, 8);
    const patchedPath = path.join(patchTmpDir, `claude-cli-patched-${hash}.mjs`);
    fs.writeFileSync(patchedPath, content);
    importPath = patchedPath;
    log.info("LAUNCHER", `Applied ${allApplied.length} runtime patches`);
    for (const patchName of allApplied) {
      log.debug("LAUNCHER", `  - ${patchName}`);
    }
  }

  const launchTask = startup.start("Launching Claude...");
  process.argv = [process.argv[0]!, claudeModulePath, ...args, ...process.argv.slice(2)];
  launchTask.done();
  await import(importPath);
};

run();
