#!/usr/bin/env bun
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { namespacePrefix, NS_ACTIVE_ENV } from "../vfs/ns-vfs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const launcherPath = join(projectRoot, "src", "cli", "launcher.ts");
const tsxRunnerPath = join(projectRoot, "src", "cli", "tsx-runner.mjs");
const tsconfigPath = join(projectRoot, "tsconfig.json");

type LaunchSpec = {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  tempFile?: {
    content: string;
    path: string;
  };
};

type BuildLaunchSpecOptions = {
  cliArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  tempFilePath?: string;
};

const resolveTsxApiPath = () => {
  return Bun.resolveSync("tsx/esm/api", projectRoot);
};

const createDoruRunnerSource = (tsxApiPath: string, forwardedArgs: string[]) => {
  return `import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { register } = require(${JSON.stringify(tsxApiPath)});
const launcherPath = ${JSON.stringify(launcherPath)};
const forwardedArgs = ${JSON.stringify(forwardedArgs)};

register({ tsconfig: ${JSON.stringify(tsconfigPath)} });
process.argv = [process.execPath, launcherPath, ...forwardedArgs];

await import(pathToFileURL(launcherPath).href);
`;
};

const createTempFilePath = () => {
  return join(tmpdir(), `ccc-doru-${randomUUID()}.mjs`);
};

// an explicit runner (tsx, bun, …) opts out of the in-process registration below
const getTypeScriptRunner = (env: NodeJS.ProcessEnv) => env.CCC_TYPESCRIPT_RUNNER?.trim() || undefined;

const getNodeBinary = (env: NodeJS.ProcessEnv) => env.CCC_NODE?.trim() || "node";

const MAX_COMPILE_CACHE_ENTRIES = 8000;

const compileCacheEntryCount = (dir: string) => {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      count += 1;
      continue;
    }
    count += fs.readdirSync(join(dir, entry.name)).length;
  }
  return count;
};

const resolveCompileCacheDir = (env: NodeJS.ProcessEnv) => {
  if (env.CCC_COMPILE_CACHE?.trim() === "0") return undefined;
  if (env.NODE_COMPILE_CACHE) return env.NODE_COMPILE_CACHE;

  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  const dir = join(cacheHome, "ccc", "v8-compile-cache");
  try {
    if (compileCacheEntryCount(dir) > MAX_COMPILE_CACHE_ENTRIES) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // absent or unreadable: node creates it, or silently skips caching
  }
  return dir;
};

const splitCliArgs = (cliArgs: string[]) => {
  if (cliArgs[0] !== "--doru") {
    return {
      doruEnabled: false,
      forwardedArgs: cliArgs,
    };
  }

  return {
    doruEnabled: true,
    forwardedArgs: cliArgs.slice(1),
  };
};

export const buildLaunchSpec = (options: BuildLaunchSpecOptions = {}): LaunchSpec => {
  const cliArgs = options.cliArgs ?? process.argv.slice(2);
  const { doruEnabled, forwardedArgs } = splitCliArgs(cliArgs);
  const cwd = options.cwd ?? process.cwd();
  const baseEnv = {
    ...process.env,
    ...options.env,
    TSX_TSCONFIG_PATH: tsconfigPath,
  };
  const compileCacheDir = resolveCompileCacheDir(baseEnv);
  const env = compileCacheDir ? { ...baseEnv, NODE_COMPILE_CACHE: compileCacheDir } : baseEnv;

  if (!doruEnabled) {
    // default: plain node running a runner that registers tsx in-process
    const runner = getTypeScriptRunner(env);
    if (runner) {
      return {
        command: runner,
        args: [launcherPath, ...forwardedArgs],
        env,
        cwd,
      };
    }

    return {
      command: getNodeBinary(env),
      args: [tsxRunnerPath, ...forwardedArgs],
      env,
      cwd,
    };
  }

  const tempFilePath = options.tempFilePath ?? createTempFilePath();
  const tsxApiPath = resolveTsxApiPath();

  return {
    command: "npx",
    args: ["--yes", "doru", "--ui", tempFilePath],
    env,
    cwd,
    tempFile: {
      path: tempFilePath,
      content: createDoruRunnerSource(tsxApiPath, forwardedArgs),
    },
  };
};

const removeTempFile = (tempFilePath?: string) => {
  if (!tempFilePath) return;

  try {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  } catch {}
};

const run = () => {
  const spec = buildLaunchSpec();
  if (spec.tempFile) {
    fs.writeFileSync(spec.tempFile.path, spec.tempFile.content, "utf8");
  }

  const nsPrefix = namespacePrefix(spec.env);
  if (nsPrefix) {
    spec.args = [...nsPrefix.slice(1), spec.command, ...spec.args];
    spec.command = nsPrefix[0]!;
    spec.env[NS_ACTIVE_ENV] = "1";
  }

  const child = spawn(spec.command, spec.args, {
    stdio: "inherit",
    env: spec.env,
    cwd: spec.cwd,
  });

  child.on("exit", (code) => {
    removeTempFile(spec.tempFile?.path);
    process.exit(code || 0);
  });

  child.on("error", (err) => {
    removeTempFile(spec.tempFile?.path);
    console.error("Failed to start CCC:", err);
    process.exit(1);
  });
};

if (import.meta.main) {
  run();
}
