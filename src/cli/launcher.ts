#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";
import p from "picocolors";
import { fileURLToPath } from "url";
import { which } from "zx";
import { setInstanceId } from "@/hooks/hook-generator";
import { runDoctor } from "@/cli/doctor";
import { buildAgents } from "@/config/builders/build-agents";
import { buildCommands } from "@/config/builders/build-commands";
import { buildMCPs } from "@/config/builders/build-mcps";
import { buildSettings, buildSystemPrompt, buildUserPrompt } from "@/config/builders/build-settings";
import { Context } from "@/context/Context";
import { log } from "@/utils/log";
import { setupVirtualFileSystem } from "@/utils/virtual-fs";

const run = async () => {
  // init context
  const context = new Context(process.cwd());
  await context.init();
  setInstanceId(context.instanceId, context.configDirectory);

  // build MCPs first so context.hasMCP() is available during prompt building
  const mcps = await buildMCPs(context);
  context.mcpServers = mcps;

  // build remaining configuration in parallel
  const [settings, systemPrompt, userPrompt, commands, agents] = await Promise.all([
    buildSettings(context),
    buildSystemPrompt(context),
    buildUserPrompt(context),
    buildCommands(context),
    buildAgents(context),
  ]);

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
        settings: settings as Record<string, unknown>,
        systemPrompt,
        userPrompt,
        commands,
        agents,
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
    console.log(p.blue("\nSystem prompt:"));
    console.log(systemPrompt.slice(0, 200) + (systemPrompt.length > 200 ? "..." : ""));
    console.log(p.blue("\nUser prompt:"));
    console.log(userPrompt.slice(0, 200) + (userPrompt.length > 200 ? "..." : ""));
    console.log(p.blue("\nCommands:"));
    console.log(Array.from(commands.keys()));
    console.log(p.blue("\nAgents:"));
    console.log(Array.from(agents.keys()));
    console.log(p.blue("\nMCPs:"));
    console.log(mcps);
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
  log.debug("BUILD-SUMMARY", `  MCPs: ${Object.keys(mcps || {}).join(", ") || "none"}`);

  // setup vfs
  setupVirtualFileSystem({
    settings: settings as unknown as Record<string, unknown>,
    systemPrompt,
    userPrompt,
    commands,
    agents,
    workingDirectory: context.workingDirectory,
    disableParentClaudeMds: context.project.projectConfig?.disableParentClaudeMds,
  });

  // build args
  const args: string[] = [];
  args.push("--mcp-config", JSON.stringify({ mcpServers: mcps }));
  // moved to wider system override via output style
  // args.push("--append-system-prompt", systemPrompt);

  // find claude binary / use CLAUDE_PATH override
  let claudeModulePath: string;
  if (process.env.CLAUDE_PATH) {
    claudeModulePath = process.env.CLAUDE_PATH;
    log.info("LAUNCHER", `Using CLAUDE_PATH override: ${claudeModulePath}`);
  } else {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // try node_modules/.bin/claude
    const localBinPath = path.join(__dirname, "node_modules/.bin/claude");
    if (fs.existsSync(localBinPath)) {
      claudeModulePath = fs.realpathSync(localBinPath);
      log.info("LAUNCHER", `Found local Claude CLI in node_modules/.bin`);
    } else {
      // try resolving the package
      try {
        const claudePkgPath = require.resolve("@anthropic-ai/claude-code/package.json", {
          paths: [__dirname],
        });
        const claudeDir = path.dirname(claudePkgPath);
        // try main entry point or cli.js
        const claudePkg = JSON.parse(fs.readFileSync(claudePkgPath, "utf8"));
        const mainEntry = claudePkg.main || claudePkg.bin?.["claude"] || "cli.js";
        claudeModulePath = path.join(claudeDir, mainEntry);

        if (!fs.existsSync(claudeModulePath)) {
          throw new Error(`Claude CLI entry point not found at ${claudeModulePath}`);
        }
        log.info("LAUNCHER", `Found local Claude CLI via package resolution`);
      } catch {
        // fallback to global claude
        try {
          const claudeBinPath = await which("claude");
          claudeModulePath = fs.realpathSync(claudeBinPath);
          log.warn("LAUNCHER", "Using global Claude CLI (local not found)");
        } catch {
          console.error("Error: Could not find Claude Code neither in node_modules nor globally.");
          process.exit(1);
        }
      }
    }
  }

  log.info("LAUNCHER", `Launching Claude from: ${claudeModulePath}`);
  log.debug("LAUNCHER", `Arguments: ${args.join(" ")}`);
  log.debug("LAUNCHER", `Additional args from CLI: ${process.argv.slice(2).join(" ") || "none"}`);
  log.info("LAUNCHER", `Log file: ${log.getLogPath()}`);

  process.argv = [process.argv[0]!, claudeModulePath, ...args, ...process.argv.slice(2)];
  await import(claudeModulePath);
};

run();
