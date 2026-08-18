#!/usr/bin/env bun
import * as fs from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { namespacePrefix, NS_ACTIVE_ENV } from "../vfs/ns-vfs";
import { PREPARATION_LAUNCHER_PATH_ENV } from "./runtime-host-process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const launcherPath = join(projectRoot, "src", "cli", "launcher.ts");
const doruRuntimeHostRunnerPath = join(projectRoot, "src", "cli", "doru-runtime-host-runner.mjs");
const runtimeHostRunnerPath = join(projectRoot, "src", "cli", "runtime-host-runner.mjs");
const tsconfigPath = join(projectRoot, "tsconfig.json");
const DORU_RUNTIME_HOST_PAYLOAD_ENV = "CCC_DORU_RUNTIME_HOST_PAYLOAD";

type LaunchSpec = {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

type BuildLaunchSpecOptions = {
  cliArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runtimeHostPath?: string;
};

// Preserve the explicit-runner hook, but let it hand preparation to Bun instead of loading config itself.
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
    CCC_BUN_EXEC_PATH: process.execPath,
    TSX_TSCONFIG_PATH: tsconfigPath,
  };
  const compileCacheDir = resolveCompileCacheDir(baseEnv);
  const env: NodeJS.ProcessEnv =
    compileCacheDir ? { ...baseEnv, NODE_COMPILE_CACHE: compileCacheDir } : baseEnv;
  env[PREPARATION_LAUNCHER_PATH_ENV] = launcherPath;
  const runtimeHostPath = options.runtimeHostPath;
  if (!runtimeHostPath) throw new Error("CCC runtime host path is required");
  const nodeBinary = getNodeBinary(env);
  const resolvedNodeBinary = Bun.which(nodeBinary, { PATH: env.PATH, cwd }) ?? nodeBinary;

  if (!doruEnabled) {
    const runner = getTypeScriptRunner(env);
    if (runner) {
      return {
        command: runner,
        args: [runtimeHostRunnerPath, resolvedNodeBinary, runtimeHostPath, ...forwardedArgs],
        env,
        cwd,
      };
    }

    return {
      command: nodeBinary,
      args: [runtimeHostPath, ...forwardedArgs],
      env,
      cwd,
    };
  }

  env[DORU_RUNTIME_HOST_PAYLOAD_ENV] = JSON.stringify({
    nodeBinary: resolvedNodeBinary,
    runtimeHostPath,
    forwardedArgs,
  });

  return {
    command: "npx",
    args: ["--yes", "doru", "--ui", doruRuntimeHostRunnerPath],
    env,
    cwd,
  };
};

const run = async () => {
  const { buildRuntimeHost } = await import("./runtime-host-build");
  const runtimeHostPath = await buildRuntimeHost();
  const spec = buildLaunchSpec({ runtimeHostPath });

  const nsPrefix = namespacePrefix(spec.env);
  if (nsPrefix) {
    spec.args = [...nsPrefix.slice(1), spec.command, ...spec.args];
    spec.command = nsPrefix[0]!;
    spec.env[NS_ACTIVE_ENV] = "1";
  }

  try {
    const executable = Bun.which(spec.command, { PATH: spec.env.PATH, cwd: spec.cwd }) ?? spec.command;
    const execve = process.execve;
    if (!execve) throw new Error("Bun process replacement is unavailable");
    execve(executable, [spec.command, ...spec.args], spec.env);
  } catch (err) {
    console.error("Failed to start CCC:", err);
    process.exit(1);
  }
};

if (import.meta.main) {
  run().catch((error: unknown) => {
    console.error("Failed to start CCC:", error);
    process.exit(1);
  });
}
