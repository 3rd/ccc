#!/usr/bin/env tsx
import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

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

      const hookGenUrl = pathToFileURL(join(launcherRoot, "src", "hooks", "hook-generator.ts")).href;
      const { getHook } = await import(hookGenUrl);
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
      // mcps
      for (const href of discover("mcps")) await import(href);

      const mcpGenUrl = pathToFileURL(join(launcherRoot, "src", "mcps", "mcp-generator.ts")).href;
      const contextUrl = pathToFileURL(join(launcherRoot, "src", "context", "Context.ts")).href;

      const { getMCP } = await import(mcpGenUrl);
      const { Context } = await import(contextUrl);

      const factory = getMCP(id);
      if (!factory) {
        console.error("MCP not found:", id);
        process.exit(2);
      }

      const context = new Context(process.cwd());
      const server = await factory(context);
      await server.start({ transportType: "stdio" });
    }
  } catch (error) {
    console.error(`${mode.toUpperCase()} runner failed:`, error);
    process.exit(2);
  }
};

main();

