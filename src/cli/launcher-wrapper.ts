#!/usr/bin/env bun
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const launcherPath = join(projectRoot, "src", "cli", "launcher.ts");
const tsconfigPath = join(projectRoot, "tsconfig.json");
const DEFAULT_TYPESCRIPT_RUNNER = "tsx";

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

const getTypeScriptRunner = (env: NodeJS.ProcessEnv) => {
  const runner = env.CCC_TYPESCRIPT_RUNNER?.trim();
  return runner || DEFAULT_TYPESCRIPT_RUNNER;
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
  const env = {
    ...process.env,
    ...options.env,
    TSX_TSCONFIG_PATH: tsconfigPath,
  };

  if (!doruEnabled) {
    return {
      command: getTypeScriptRunner(env),
      args: [launcherPath, ...forwardedArgs],
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
