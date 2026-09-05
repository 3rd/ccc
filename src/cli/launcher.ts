#!/usr/bin/env bun
import * as fs from "fs";
import { createRequire } from "node:module";
import * as path from "path";
import { fileURLToPath } from "node:url";
import p from "picocolors";
import type { ClaudeMarketplaceConfig } from "@/config/plugins";
import type { AgentDefinition } from "@/config/schema";
import { prepareContextInstanceId } from "@/context/instance-id";
import type { ResolvedCli } from "@/native/resolver";
import type { RuntimePatch } from "@/patches/cli-patches";
import { log } from "@/utils/log";
import { createStartupLogger } from "@/utils/startup";
import type { RuntimeHostPayload } from "./runtime-host";
import { PREPARATION_LAUNCHER_PATH_ENV, RUNTIME_HOST_PAYLOAD_FD_ENV } from "./runtime-host-process";

type ResolveResult = ResolvedCli & { source: string };

const hasLongFlag = (args: string[], flag: string) => {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
};

const getLongFlagValue = (args: string[], flag: string) => {
  const eqPrefix = `${flag}=`;

  for (let i = args.length - 1; i >= 0; i -= 1) {
    const current = args[i];
    if (!current) continue;

    if (current.startsWith(eqPrefix)) {
      const value = current.slice(eqPrefix.length);
      return value.length > 0 ? value : undefined;
    }

    if (current === flag) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) return next;
      return undefined;
    }
  }

  return undefined;
};

const resolveClaudeCli = async (launcherRoot: string): Promise<ResolveResult> => {
  const { resolveCliForLaunch, resolveCliFromExecutable } = await import("@/native/resolver");
  if (process.env.CLAUDE_PATH) {
    return {
      ...resolveCliFromExecutable(process.env.CLAUDE_PATH, launcherRoot),
      source: "env override",
    };
  }

  // try node_modules/.bin/claude
  const localBinPath = path.join(launcherRoot, "node_modules/.bin/claude");
  if (fs.existsSync(localBinPath)) {
    return { ...resolveCliFromExecutable(localBinPath, launcherRoot), source: "local bin" };
  }

  // try resolving the package
  let claudePkgPath: string | undefined;
  try {
    const req = createRequire(import.meta.url);
    claudePkgPath = req.resolve("@anthropic-ai/claude-code/package.json", {
      paths: [launcherRoot],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error;
  }

  if (claudePkgPath) {
    const claudeDir = path.dirname(claudePkgPath);
    return { ...resolveCliForLaunch(claudeDir), source: "local package" };
  }

  // fallback to global claude
  let claudeBinPath: string;
  try {
    claudeBinPath = await (await import("zx")).which("claude");
  } catch {
    throw new Error("Could not find Claude Code in node_modules or globally.");
  }
  return { ...resolveCliFromExecutable(claudeBinPath, launcherRoot), source: "global bin" };
};

// eslint-disable-next-line sonarjs/cognitive-complexity
const run = async () => {
  if (!process.env[RUNTIME_HOST_PAYLOAD_FD_ENV]) {
    const { buildRuntimeHost } = await import("./runtime-host-build");
    const runtimeHostPath = await buildRuntimeHost();
    const nodeBinary = process.env.CCC_NODE?.trim() || "node";
    const executable = Bun.which(nodeBinary) ?? nodeBinary;
    const execve = process.execve;
    if (!execve) throw new Error("Bun process replacement is unavailable");
    execve(executable, [nodeBinary, runtimeHostPath, ...process.argv.slice(2)], {
      ...process.env,
      CCC_BUN_EXEC_PATH: process.execPath,
      [PREPARATION_LAUNCHER_PATH_ENV]: fileURLToPath(import.meta.url),
    });
  }

  const incomingArgs = process.argv.slice(2);
  // only accept --debug=<value> form; bare --debug/-d always means "1"
  const incomingDebugEqValue = incomingArgs
    .findLast((a) => a.startsWith("--debug="))
    ?.slice("--debug=".length);
  const incomingDebugEnabled = hasLongFlag(incomingArgs, "--debug") || incomingArgs.includes("-d");
  if (!process.env.DEBUG && incomingDebugEnabled) {
    process.env.DEBUG = incomingDebugEqValue || "1";
  }

  const shouldEnableLogger = (): boolean => {
    const interactive = Boolean(process.stdout.isTTY);
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
    return interactive && !hasQuiet;
  };

  const instanceId = prepareContextInstanceId();
  const startupMessagesEnabled = shouldEnableLogger();
  const startup = createStartupLogger({ enabled: startupMessagesEnabled });
  startup.setInstanceId(instanceId);

  // init context
  const ctxTask = startup.start("Resolve project context");
  const { Context } = await import("@/context/Context");
  const context = new Context(process.cwd());
  await context.init();

  let virtualClaudeStateJson: string | undefined;
  try {
    const { buildTrustedClaudeState } = await import("@/utils/workspace-trust");
    const trustOverride = buildTrustedClaudeState([context.project.rootDirectory, context.workingDirectory]);
    virtualClaudeStateJson = trustOverride.claudeStateJson;
    log.info("LAUNCHER", `Prepared virtual Claude workspace trust from ${trustOverride.claudeStatePath}`);
    for (const trustedPath of trustOverride.trustedPaths) {
      log.debug("LAUNCHER", `  - ${trustedPath}`);
    }
  } catch (error) {
    log.warn(
      "LAUNCHER",
      `Failed to prepare virtual Claude workspace trust: ${error instanceof Error ? error.message : error}`,
    );
  }

  (await import("@/hooks/hook-generator")).setInstanceId(context.instanceId, context.configDirectory);
  process.env.CCC_INSTANCE_ID = context.instanceId;

  const os = await import("os");
  const crypto = await import("crypto");
  ctxTask.done();

  const pluginsConfig = await startup.run("Build plugins", async () =>
    (await import("@/config/builders/build-plugins")).buildPlugins(context),
  );

  // discover and load CCC plugins
  const pluginTask = startup.start("Load CCC plugins");
  try {
    const { loadCCCPluginsFromConfig } = await import("@/plugins");
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
  const mcps = await startup.run("Build MCPs", async () =>
    (await import("@/config/builders/build-mcps")).buildMCPs(context),
  );
  context.mcpServers = mcps;

  // build remaining configuration in parallel
  const settingsModule = import("@/config/builders/build-settings");
  const settingsPromise = startup.run("Build settings", async () =>
    (await settingsModule).buildSettings(context),
  );
  const systemPromptPromise = startup.run("Build system prompt", async () =>
    (await settingsModule).buildSystemPrompt(context),
  );
  const userPromptPromise = startup.run("Build user prompt", async () =>
    (await settingsModule).buildUserPrompt(context),
  );
  const commandsPromise = startup.run("Build commands", async () =>
    (await import("@/config/builders/build-commands")).buildCommands(context),
  );
  const agentsPromise = startup.run("Build agents", async () =>
    (await import("@/config/builders/build-agents")).buildAgents(context),
  );
  const skillsPromise = startup.run("Build skills", async () =>
    (await import("@/config/builders/build-skills")).buildSkills(context),
  );
  const rulesPromise = startup.run("Build rules", async () =>
    (await import("@/config/builders/build-rules")).buildRules(context),
  );
  const outputStylesPromise = startup.run("Build output styles", async () =>
    (await import("@/config/builders/build-output-styles")).buildOutputStyles(context),
  );
  const workflowsPromise = startup.run("Build workflows", async () =>
    (await import("@/config/builders/build-workflows")).buildWorkflows(context),
  );
  const [settings, systemPrompt, userPrompt, commands, agents, skills, rules, outputStyles, workflows] =
    await Promise.all([
      settingsPromise,
      systemPromptPromise,
      userPromptPromise,
      commandsPromise,
      agentsPromise,
      skillsPromise,
      rulesPromise,
      outputStylesPromise,
      workflowsPromise,
    ]);

  // oauth credentials are resolved from real process env before settings.json env is
  // applied, so a profile's token override must be promoted to process env pre-boot
  if (settings._profileName) {
    (await import("@/config/builders/resolve-profile")).exportProfileEnv(
      settings._availableProfiles?.[settings._profileName],
    );
  }

  // the plugins-config marketplace shape is flat ({ source: "local", path }); Claude's
  // settings.json expects the nested settings shape ({ source: { source: "directory", path } }).
  // Splicing the flat shape verbatim makes Claude reject and skip settings.json entirely
  // ("Expected object, but received string").
  const toSettingsMarketplace = (entry: ClaudeMarketplaceConfig): { source: Record<string, unknown> } => {
    if (entry.source === "local") return { source: { source: "directory", path: entry.path ?? "" } };
    if (entry.source === "github") {
      return {
        source: { source: "github", repo: entry.repo ?? "", ...(entry.path ? { path: entry.path } : {}) },
      };
    }
    return { source: { source: "url", url: entry.url ?? "" } };
  };

  const settingsWithPlugins = {
    ...settings,
    ...(pluginsConfig.claude?.enabledPlugins && { enabledPlugins: pluginsConfig.claude.enabledPlugins }),
    ...(pluginsConfig.claude?.extraKnownMarketplaces && {
      extraKnownMarketplaces: Object.fromEntries(
        Object.entries(pluginsConfig.claude.extraKnownMarketplaces).map(([name, entry]) => [
          name,
          toSettingsMarketplace(entry),
        ]),
      ),
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
    const { isMCPLayerDisabled } = await import("@/types/mcps");
    const layers = await loadConfigFromLayers<import("@/types/mcps").MCPServers>(context, "mcps.ts");
    const mergedMcpServers = mergeMCPs(layers.global, ...layers.presets, layers.project);
    const mcpData = mergedMcpServers[mcpName];
    if (!mcpData || isMCPLayerDisabled(mcpData) || mcpData.type !== "inline") {
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

    const processedMcps = await (await import("@/config/builders/build-mcps")).buildMCPs(context);
    const { loadConfigFromLayers, mergeMCPs } = await import("@/config/layers");
    const { isMCPLayerDisabled } = await import("@/types/mcps");
    const layers = await loadConfigFromLayers<import("@/types/mcps").MCPServers>(context, "mcps.ts");
    const mergedMcpServers = mergeMCPs(layers.global, ...layers.presets, layers.project);
    // Drop disabled entries so debug-mcp treats them as absent (same as
    // hasMCP and the runtime registration).
    for (const [name, data] of Object.entries(mergedMcpServers)) {
      if (isMCPLayerDisabled(data)) delete mergedMcpServers[name];
    }

    await debugMCP(context, mergedMcpServers, mcpName, processedMcps);
    process.exit(0);
  }

  // --doctor
  if (process.argv.includes("--doctor")) {
    const { runDoctor } = await import("@/cli/doctor");
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
        outputStyles,
        workflows,
        mcps,
      },
      { json: process.argv.includes("--json") },
    );
    process.exit(0);
  }

  // --print-config
  if (process.argv.includes("--print-config")) {
    console.log(p.blue("\nSettings:"));
    // strip diagnostic fields from output
    const { _profileName, _availableProfiles, ...printableSettings } = settings;
    console.log(JSON.stringify(printableSettings, null, 2));
    const profileNames = Object.keys(_availableProfiles ?? {}).sort();
    if (profileNames.length > 0) {
      console.log(p.blue("\nProfiles:"));
      if (_profileName) console.log(`  active: ${_profileName}`);
      for (const name of profileNames) {
        const marker = name === _profileName ? " (active)" : "";
        console.log(`  ${name}${marker}`);
      }
    }
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
    console.log(p.blue("\nOutput styles:"));
    console.log(Array.from(outputStyles.keys()));
    console.log(p.blue("\nWorkflows:"));
    console.log(Array.from(workflows.files.keys()));
    console.log(p.blue("\nMCPs:"));
    console.log(mcps);
    console.log(p.blue("\nCCC Plugins:"));
    const pluginInfos = (await import("@/plugins")).getPluginInfo(context.loadedPlugins);
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
        if (info.components.workflows.length > 0) {
          console.log(`    Workflows: ${info.components.workflows.join(", ")}`);
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
    const { dumpConfig } = await import("@/config/dump-config");
    await dumpConfig(context, {
      settings: settingsWithPlugins as Record<string, unknown>,
      systemPrompt,
      userPrompt,
      commands,
      agents,
      skills,
      rules,
      outputStyles,
      workflows: workflows.files,
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
  log.debug(
    "BUILD-SUMMARY",
    `  Output styles: ${outputStyles.size} files (${Array.from(outputStyles.keys()).join(", ")})`,
  );
  log.debug(
    "BUILD-SUMMARY",
    `  Workflows: ${workflows.files.size} files (${Array.from(workflows.files.keys()).join(", ")})`,
  );
  log.debug("BUILD-SUMMARY", `  MCPs: ${Object.keys(mcps || {}).join(", ") || "none"}`);

  // resolve claude cli path first (needed for runtime patches in VFS)
  const resolveTask = startup.start("Resolve Claude CLI");
  let extractedCliPath: string;
  let graphDir: string | undefined;
  try {
    const resolved = await resolveClaudeCli(context.launcherDirectory);
    extractedCliPath = resolved.extractedCliPath;
    graphDir = resolved.graphDir;
    log.info("LAUNCHER", `Found extracted Claude CLI: ${extractedCliPath}`);
    if (process.env.USE_BUILTIN_RIPGREP === undefined) {
      process.env.USE_BUILTIN_RIPGREP = "0";
      log.debug("LAUNCHER", "Native mode: set USE_BUILTIN_RIPGREP=0 (using system ripgrep)");
    }
    const certEnv = (await import("@/native/cert-env")).applyNativeCertEnvDefaults();
    if (certEnv) {
      log.debug(
        "LAUNCHER",
        `Native mode: SSL_CERT_DIR=${certEnv.certDir ?? "(unset)"} SSL_CERT_FILE=${certEnv.certFile ?? "(unset)"}`,
      );
    }
    // Anchor createRequire() outside the cache directory.
    process.env.CCC_CLAUDE_WRAPPER_PKG_JSON = resolved.modulePackageJsonPath;
    log.debug(
      "LAUNCHER",
      `Native mode: CCC_CLAUDE_WRAPPER_PKG_JSON=${process.env.CCC_CLAUDE_WRAPPER_PKG_JSON}`,
    );
    resolveTask.done(resolved.source);
  } catch (error) {
    resolveTask.fail("Claude CLI not found");
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // extract runtime patches from settings
  const patches = (settings as { patches?: RuntimePatch[] }).patches;

  // expose featureFlags overrides to the patched growthbook flag reader
  const featureFlags = (settings as { featureFlags?: Record<string, unknown> }).featureFlags;
  if (featureFlags && Object.keys(featureFlags).length > 0) {
    (globalThis as { __cccFeatureFlags?: Record<string, unknown> }).__cccFeatureFlags = featureFlags;
    log.info("LAUNCHER", `Exposed __cccFeatureFlags: ${Object.keys(featureFlags).join(", ")}`);
    if (process.env.CCC_DEBUG_FEATURE_FLAGS) {
      process.stderr.write(`[ccc] __cccFeatureFlags set: ${JSON.stringify(featureFlags)}\n`);
    }
  } else if (process.env.CCC_DEBUG_FEATURE_FLAGS) {
    process.stderr.write(`[ccc] __cccFeatureFlags NOT set (featureFlags=${JSON.stringify(featureFlags)})\n`);
  }

  // setup vfs
  const virtualFileSystem = await startup.run("Mount VFS", async () => {
    const { prepareVirtualFileSystem } = await import("@/utils/virtual-fs");
    return prepareVirtualFileSystem({
      settings: settingsWithPlugins as unknown as Record<string, unknown>,
      claudeStateJson: virtualClaudeStateJson,
      userPrompt,
      commands,
      agents,
      skills,
      rules,
      outputStyles,
      workflows: workflows.files,
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
    permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
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
    outputFormat?: "json" | "stream-json" | "text";
    disableSlashCommands?: boolean;
    maxBudgetUsd?: number;
    dangerouslySkipPermissions?: boolean;
    sessionId?: string;
    fromPr?: number | string;
    teammateMode?: "auto" | "in-process" | "tmux";
    appendSystemPrompt?: string;
    appendSystemPromptFile?: string;
    // append to every Task-tool subagent's system prompt (print mode only) (v2.1.207)
    appendSubagentSystemPrompt?: string;
    appendSubagentSystemPromptFile?: string;
    betas?: string[];
    maxTurns?: number;
    noSessionPersistence?: boolean;
    permissionPromptTool?: string;
    includePartialMessages?: boolean;
    inputFormat?: "stream-json" | "text";
    jsonSchema?: string;
    allowDangerouslySkipPermissions?: boolean;
    settings?: string;
    effort?: "high" | "low" | "max" | "medium";
    file?: string[];
    debugFile?: string;
    replayUserMessages?: boolean;
    // create a new git worktree for this session (v2.1.49)
    worktree?: boolean | string;
    // create a tmux session for the worktree (requires --worktree) (v2.1.49)
    tmux?: boolean | string;
    // thinking mode: enabled (= adaptive), adaptive, disabled (v2.1.61)
    thinking?: "adaptive" | "disabled" | "enabled";
  };
  const settingsCli = (settings as { cli?: CliFlags }).cli || {};

  // propagate settings.cli.debug to env if not already set (env > argv > settings)
  if (!process.env.DEBUG && settingsCli.debug !== undefined) {
    process.env.DEBUG = typeof settingsCli.debug === "string" ? settingsCli.debug : "1";
  }

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

  // --append-subagent-system-prompt (print mode only, v2.1.207)
  if (!hasCliArg("--append-subagent-system-prompt") && settingsCli.appendSubagentSystemPrompt) {
    args.push("--append-subagent-system-prompt", settingsCli.appendSubagentSystemPrompt);
  }

  // --append-subagent-system-prompt-file (print mode only, v2.1.261)
  if (!hasCliArg("--append-subagent-system-prompt-file") && settingsCli.appendSubagentSystemPromptFile) {
    args.push("--append-subagent-system-prompt-file", settingsCli.appendSubagentSystemPromptFile);
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

  // --thinking (enabled, adaptive, disabled) (v2.1.61)
  if (!hasCliArg("--thinking") && settingsCli.thinking) {
    args.push("--thinking", settingsCli.thinking);
  }

  log.info("LAUNCHER", `Launching Claude from: ${extractedCliPath}`);
  log.debug("LAUNCHER", `Arguments: ${args.join(" ")}`);
  log.debug("LAUNCHER", `Additional args from CLI: ${process.argv.slice(2).join(" ") || "none"}`);
  log.info("LAUNCHER", `Log file: ${log.getLogPath()}`);

  if (startupMessagesEnabled) {
    const launchArgs = [...args, ...process.argv.slice(2)];
    const printDebugPath = (label: string, value: string | null | undefined) => {
      if (value) process.stdout.write(`${p.dim(`  ${label}:`)} ${value}\n`);
    };

    printDebugPath("ccc debug log", log.getLogPath());
    const cccCacheDir = log.getCacheDir();
    printDebugPath("ccc hooks log", cccCacheDir ? path.join(cccCacheDir, "hooks.jsonl") : null);

    const explicitClaudeDebugFile = getLongFlagValue(launchArgs, "--debug-file");
    if (explicitClaudeDebugFile) {
      printDebugPath("claude debug file", explicitClaudeDebugFile);
    } else if (hasLongFlag(launchArgs, "--debug") || hasLongFlag(launchArgs, "--enable-lsp-logging")) {
      const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
      printDebugPath("claude debug directory", path.join(claudeConfigDir, "debug"));
    }
  }

  // apply runtime patches to CLI file (ESM imports bypass VFS)
  let importPath = extractedCliPath;

  const patchTask = startup.start("Apply runtime patches");
  const { applyBuiltInPatches, applyUserPatches } = await import("@/patches/cli-patches");
  const { computePatchKey, dropPatchedEntry, materializePatchedGraph, patchCacheMode, readPatched, writePatchedGraphAtomic } =
    await import("@/patches/patched-cache");
  const { PREAMBLE_VERSION } = await import("@/native/preamble");
  const { readGraphManifest } = await import("@/native/cache");
  const { readGraphText, splitGraphText } = await import("@/native/graph-text");
  const patchList = patches ?? [];
  const cacheMode = patchCacheMode();
  const patchKey =
    cacheMode === "off" ? undefined : (
      computePatchKey({
        extractedCliPath,
        preambleVersion: PREAMBLE_VERSION,
        patches: patchList,
        salt: process.env.CCC_PATCH_CACHE_SALT,
      })
    );
  const cached = patchKey ? readPatched(patchKey) : null;

  // these drive the stale-patch report below, so a cache hit has to restore them too
  const allApplied: string[] = [];
  const allMissed: string[] = [];

  const applyPatchesTo = (content: string) => {
    const applied: string[] = [];
    const missed: string[] = [];

    // apply built-in patches (lsp fixes, feature disabling)
    const builtIn = applyBuiltInPatches(content);
    content = builtIn.content;
    applied.push(...builtIn.applied);
    missed.push(...builtIn.missed);

    // apply user-defined patches from settings
    if (patchList.length > 0) {
      const user = applyUserPatches(content, patchList);
      content = user.content;
      applied.push(...user.applied);
      missed.push(...user.missed);
    }
    return { content, applied, missed };
  };

  // graph variant: patches run over the joined module text so anchors that span
  // two modules still match, then the result is split back into module files
  const deriveGraphPatched = (dir: string) => {
    const graph = readGraphText(dir);
    const result = applyPatchesTo(graph.combined);
    const parts = splitGraphText(graph, result.content);

    const patchedModules = new Map<string, string>();
    for (const [index, rel] of graph.modules.entries()) {
      if (parts[index] !== graph.originals[index]) patchedModules.set(rel, parts[index]!);
    }

    return {
      graph,
      patchedModules: patchedModules.size > 0 ? patchedModules : null,
      applied: result.applied,
      missed: result.missed,
    };
  };

  if (cached) {
    if (cached.patchedPath) importPath = cached.patchedPath;
    allApplied.push(...cached.applied);
    allMissed.push(...cached.missed);
    log.info("LAUNCHER", `Reused patched CLI ${patchKey}: ${cached.patchedPath ?? "(unpatched)"}`);
  } else {
    const derived = deriveGraphPatched(graphDir);
    allApplied.push(...derived.applied);
    allMissed.push(...derived.missed);

    if (patchKey) {
      const entry = writePatchedGraphAtomic(patchKey, graphDir, derived.patchedModules, derived.applied, derived.missed);
      if (entry.patchedPath) importPath = entry.patchedPath;
    } else if (derived.patchedModules !== null) {
      // cache disabled: content-addressed temp graph copy. the copy embeds every
      // unpatched file too (preamble, shims, untouched modules), so the key covers
      // the source graph's identity (entry stat plus preamble version, the same
      // identity computePatchKey trusts), not just the patched module text
      const entryStat = fs.statSync(extractedCliPath);
      const hasher = crypto
        .createHash("md5")
        .update(graphDir)
        .update("\0")
        .update(PREAMBLE_VERSION)
        .update("\0")
        .update(String(entryStat.size))
        .update("\0")
        .update(String(entryStat.mtimeMs))
        .update("\0");
      for (const [rel, content] of [...derived.patchedModules.entries()].sort()) {
        hasher.update(rel).update("\0").update(content).update("\0");
      }
      const hash = hasher.digest("hex").slice(0, 8);
      const tempGraphDir = path.join(os.tmpdir(), `claude-graph-patched-${hash}`);
      const manifest = readGraphManifest(graphDir);
      const entryPath = manifest ? path.join(tempGraphDir, manifest.entry) : null;
      if (entryPath && !fs.existsSync(entryPath)) {
        materializePatchedGraph(tempGraphDir, graphDir, derived.patchedModules);
      }
      if (entryPath) importPath = entryPath;
    }

    if (allApplied.length > 0) {
      log.info(
        "LAUNCHER",
        `Applied ${allApplied.length}/${allApplied.length + allMissed.length} runtime patches`,
      );
      for (const patchName of allApplied) log.debug("LAUNCHER", `  + ${patchName}`);
    }
  }

  // CCC_PATCH_CACHE=verify: re-derive and compare, so a key that misses an input shows up as a
  // warning here instead of as an unexplained behaviour change
  if (cached && cacheMode === "verify" && patchKey) {
      const derived = deriveGraphPatched(graphDir);
      const sameLabels =
        derived.applied.join("\0") === cached.applied.join("\0") &&
        derived.missed.join("\0") === cached.missed.join("\0");
      let sameContent = (derived.patchedModules === null) === (cached.patchedPath === null);
      if (sameContent && derived.patchedModules !== null && cached.patchedPath !== null) {
        const manifest = readGraphManifest(graphDir);
        const cachedGraphDir =
          manifest && cached.patchedPath.endsWith(manifest.entry)
            ? cached.patchedPath.slice(0, -manifest.entry.length - 1)
            : null;
        if (!cachedGraphDir) {
          sameContent = false;
        } else {
          // every module is compared, patched or not: a key collision can leave
          // the cached graph patched in modules the fresh derivation left alone,
          // and that divergence must fail verification
          for (const [index, rel] of derived.graph.modules.entries()) {
            const content = derived.patchedModules.get(rel) ?? derived.graph.originals[index]!;
            let cachedContent: string;
            try {
              cachedContent = fs.readFileSync(path.join(cachedGraphDir, rel), "utf8");
            } catch {
              sameContent = false;
              break;
            }
            if (cachedContent.replaceAll(cachedGraphDir, graphDir) !== content) {
              sameContent = false;
              break;
            }
          }
        }
      }
      if (!sameContent || !sameLabels) {
        log.warn("LAUNCHER", `Patch cache mismatch for ${patchKey}; rebuilding from source`);
        dropPatchedEntry(patchKey);
        const entry = writePatchedGraphAtomic(patchKey, graphDir, derived.patchedModules, derived.applied, derived.missed);
        importPath = entry.patchedPath ?? extractedCliPath;
        allApplied.length = 0;
        allMissed.length = 0;
        allApplied.push(...derived.applied);
        allMissed.push(...derived.missed);
      } else {
        log.info("LAUNCHER", `Patch cache verified: ${patchKey}`);
      }
  }

  const total = allApplied.length + allMissed.length;
  if (total === 0) {
    patchTask.skip("none configured");
  } else if (allMissed.length === 0) {
    patchTask.done(`${allApplied.length}/${total}`);
  } else {
    patchTask.done(`${allApplied.length}/${total}, ${allMissed.length} stale`);
    if (startupMessagesEnabled) {
      for (const patchName of allMissed) {
        process.stdout.write(`  ${p.yellow("!")} ${p.dim("stale:")} ${patchName}\n`);
      }
    }
    log.warn("LAUNCHER", `${allMissed.length} stale patches against CLI:`);
    for (const patchName of allMissed) log.warn("LAUNCHER", `  - ${patchName}`);
  }

  const launchTask = startup.start("Launching Claude...");
  const { stripProfileFromArgv } = await import("@/config/builders/resolve-profile");
  const cleanedUserArgs = stripProfileFromArgv(process.argv.slice(2));
  const runtimePayload: RuntimeHostPayload = {
    version: 1,
    claudeArgv: [extractedCliPath, ...args, ...cleanedUserArgs],
    importPath,
    featureFlags,
    environment: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    runtimeLogPath: log.getLogPath() ?? undefined,
    virtualFileSystem,
  };

  launchTask.done();
  if (startupMessagesEnabled) process.stdout.write("\n");
  delete runtimePayload.environment[RUNTIME_HOST_PAYLOAD_FD_ENV];
  delete runtimePayload.environment[PREPARATION_LAUNCHER_PATH_ENV];
  delete runtimePayload.environment.CCC_BUN_EXEC_PATH;
  const payloadFd = Number(process.env[RUNTIME_HOST_PAYLOAD_FD_ENV]);
  if (!Number.isInteger(payloadFd) || payloadFd < 0) throw new Error("Invalid CCC runtime payload descriptor");
  fs.writeFileSync(payloadFd, JSON.stringify(runtimePayload));
};

run();
