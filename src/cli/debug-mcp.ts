import { spawn } from "child_process";
import p from "picocolors";
import type { MCPServers } from "@/types/mcps";
import type { ClaudeMCPConfig } from "@/types/mcps";
import { Context } from "@/context/Context";

export const debugMCP = async (
  context: Context,
  mcpServers: MCPServers,
  mcpName: string,
  processedMcps?: Record<string, ClaudeMCPConfig>,
) => {
  console.log(p.blue(`\n🔍 Debug MCP: ${mcpName}`));
  console.log(p.gray("─".repeat(50)));

  // load MCP
  if (!mcpServers || !mcpServers[mcpName]) {
    console.error(p.red(`\n❌ MCP "${mcpName}" not available in current context`));
    console.log(p.gray("\nAvailable MCPs in this context:"));
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      for (const name of Object.keys(mcpServers)) {
        console.log(p.gray(`  • ${name}`));
      }
    } else {
      console.log(p.gray("  (none)"));
    }
    console.log(p.gray("\nHint: Check your configuration layers (global, presets, project)"));
    return;
  }

  const mcpData = mcpServers[mcpName];
  console.log(p.green(`✅ Found MCP "${mcpName}"`));

  // check for filter
  const hasFilter = mcpData.type === "traditional" && "filter" in mcpData.config;

  if (hasFilter) {
    console.log(p.gray("Type: External MCP with filter (using filtered proxy)"));
  } else if (mcpData.type === "inline") {
    // inline MCP
    console.log(p.gray("Type: Inline MCP (FastMCP)"));
  } else if (mcpData.type === "traditional") {
    // stdio
    const config = mcpData.config;
    console.log(p.gray("Type: External MCP (stdio)"));
    console.log(p.gray(`Command: ${config.command} ${config.args?.join(" ") || ""}`));
  } else if (mcpData.type === "http" || mcpData.type === "sse") {
    // HTTP/SSE
    const config = mcpData.config;
    console.log(
      p.yellow(`⚠️  ${mcpData.type.toUpperCase()} transport MCPs cannot be debugged with MCP Inspector`),
    );
    console.log(p.gray(`URL: ${config.url}`));
    console.log(p.gray("\nMCP Inspector only supports stdio transport MCPs"));
    return;
  } else {
    console.error(p.red("❌ Unknown MCP configuration type"));
    return;
  }

  // launch MCP Inspector
  console.log(p.blue("\n🚀 Launching MCP Inspector..."));
  console.log(p.gray("─".repeat(50)));

  let inspectorCmd: string;
  let inspectorArgs: string[];

  if (hasFilter || mcpData.type === "inline") {
    const processedConfig = processedMcps?.[mcpName];
    if (processedConfig && processedConfig.type === "stdio") {
      inspectorCmd = "npx";
      inspectorArgs = [
        "@modelcontextprotocol/inspector",
        processedConfig.command,
        ...(processedConfig.args || []),
      ];

      // set env from processed config
      if (processedConfig.env) {
        for (const [key, value] of Object.entries(processedConfig.env)) {
          if (typeof value === "string") {
            process.env[key] = value;
          }
        }
      }
    } else {
      console.error(p.red("❌ Processed MCP not found or not stdio type"));
      return;
    }
  } else if (mcpData.type === "traditional") {
    // external MCP without filter - run directly
    const config = mcpData.config;
    inspectorCmd = "npx";
    inspectorArgs = ["@modelcontextprotocol/inspector", config.command, ...(config.args || [])];

    // set env
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        process.env[key] = value;
      }
    }
  } else {
    console.error(p.red("❌ Unsupported MCP type for inspector"));
    return;
  }

  console.log(p.gray(`Command: ${inspectorCmd} ${inspectorArgs.join(" ")}`));
  console.log(p.gray("\nPress Ctrl+C to exit\n"));

  const isWindows = process.platform === "win32";
  const inspector = spawn(inspectorCmd, inspectorArgs, {
    stdio: "inherit",
    cwd: context.workingDirectory,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "development",
    },
    detached: !isWindows,
  });

  let cleanedUp = false;

  const cleanup = (signal?: NodeJS.Signals | number) => {
    if (cleanedUp) return;
    cleanedUp = true;

    console.log(p.gray("\n👋 Shutting down..."));

    // kill pg
    if (!isWindows && inspector.pid) {
      try {
        process.kill(-inspector.pid, "SIGTERM");
      } catch { }
    } else {
      inspector.kill("SIGTERM");
    }

    setTimeout(() => {
      if (!isWindows && inspector.pid) {
        try {
          process.kill(-inspector.pid, "SIGKILL");
        } catch { }
      }
      process.exit(typeof signal === "number" ? signal : 0);
    }, 500);
  };

  // handle inspector errors
  inspector.on("error", (err) => {
    console.error(p.red(`\n❌ Failed to launch MCP Inspector: ${err.message}`));
    if (err.message.includes("ENOENT")) {
      console.log(p.gray("\nMake sure MCP Inspector is installed:"));
      console.log(p.gray("  npm install -g @modelcontextprotocol/inspector"));
    }
    cleanup(1);
  });

  // handle inspector exit
  inspector.on("exit", (code, signal) => {
    if (!cleanedUp) {
      if (signal) {
        console.log(p.gray(`\nInspector terminated by signal: ${signal}`));
      } else if (code !== 0) {
        console.error(p.red(`\n❌ MCP Inspector exited with code ${code}`));
      }
      cleanup(code || 0);
    }
  });

  // handle other signals
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    process.on(signal, () => cleanup(0));
  }

  // cleanup on exit
  process.on("exit", () => {
    if (!cleanedUp && !isWindows && inspector.pid) {
      try {
        process.kill(-inspector.pid, "SIGKILL");
      } catch { }
    }
  });

  await new Promise<void>((resolve) => {
    inspector.on("close", () => {
      resolve();
    });
  });
};
