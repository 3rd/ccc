#!/usr/bin/env tsx
import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getHook } from "@/hooks/hook-generator";
import type { MCPServers } from "@/types/mcps";
import { loadConfigFromLayers, mergeMCPs } from "@/config/layers";
import { Context } from "@/context/Context";
import { createMCPProxy } from "@/mcps/mcp-generator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const launcherRoot = dirname(dirname(__dirname));

const resolveConfigDirectory = (): "config" | "dev-config" => {
  const dev = join(launcherRoot, "dev-config");
  return existsSync(dev) ? "dev-config" : "config";
};

const discover = (kind: "hooks" | "mcps"): string[] => {
  const cfgDir = join(launcherRoot, resolveConfigDirectory());
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

const main = async () => {
  const mode = process.argv[2];
  const id = process.argv[3];

  if (!mode || !id || (mode !== "hook" && mode !== "mcp")) {
    console.error("Usage: runner.ts <hook|mcp> <id>");
    process.exit(2);
  }

  try {
    // hooks
    if (mode === "hook") {
      // import all hooks configs to register handlers
      for (const href of discover("hooks")) await import(href);

      const fn = getHook(id);
      if (!fn) {
        console.error("Hook not found:", id);
        process.exit(2);
      }

      const inputJson = await readStdin();
      if (!inputJson) {
        console.error("No input received on stdin");
        process.exit(2);
      }
      const input = JSON.parse(inputJson);
      const result = await Promise.resolve(fn(input));
      if (result) process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } else {
      // mcps - ID = MCP name
      const mcpName = id;

      const context = new Context(process.cwd());

      // find MCP
      const layers = await loadConfigFromLayers<MCPServers>(context, "mcps.ts");
      const merged = mergeMCPs(layers.global, ...layers.presets, layers.project);
      const mcpConfig = merged[mcpName];
      if (!mcpConfig) {
        console.error(`MCP not found: ${mcpName}`);
        process.exit(2);
      }

      if (mcpConfig.type === "inline") {
        const factory = mcpConfig.config;
        const server = await factory(context);
        await server.start({ transportType: "stdio" });
      } else if (mcpConfig.type === "traditional" || mcpConfig.type === "http" || mcpConfig.type === "sse") {
        // external MCP - check for filter
        const config = mcpConfig.config;
        if ("filter" in config && typeof config.filter === "function") {
          // proxy for filtering
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
    }
  } catch (error) {
    console.error(`${mode.toUpperCase()} runner failed:`, error);
    process.exit(2);
  }
};

main();
