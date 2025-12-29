import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAUNCHER_ROOT = resolve(__dirname, "../..");
const FIXTURES_DIR = resolve(__dirname, "../fixtures");

// IMPORTANT: Use temp directory for test configs - NEVER touch dev-config
const TEST_CONFIG_BASE = join(tmpdir(), "ccc-test");

export interface RunCCCOptions {
  projectDir: string;
  configFixture?: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export interface RunCCCResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface TestConfigPaths {
  testId: string;
  configDir: string;
}

const setupTestEnvironment = (configFixture: string): TestConfigPaths => {
  const testId = randomBytes(8).toString("hex");
  const testDir = join(TEST_CONFIG_BASE, testId);
  const configDir = join(testDir, "config");

  // create isolated test directory
  mkdirSync(testDir, { recursive: true });

  // copy fixture config to temp directory
  const fixtureConfigPath = join(FIXTURES_DIR, "configs", configFixture, "config");
  cpSync(fixtureConfigPath, configDir, { recursive: true });

  // copy tsconfig.json so bun can resolve @/* path aliases in fixture TS files
  const tsconfigSrc = join(LAUNCHER_ROOT, "tsconfig.json");
  const tsconfigDest = join(testDir, "tsconfig.json");
  if (existsSync(tsconfigSrc)) {
    cpSync(tsconfigSrc, tsconfigDest);
  }

  // symlink src directory so @/* imports resolve correctly
  const srcDest = join(testDir, "src");
  const srcSrc = join(LAUNCHER_ROOT, "src");
  if (existsSync(srcSrc) && !existsSync(srcDest)) {
    symlinkSync(srcSrc, srcDest, "junction");
  }

  // symlink node_modules for dependencies
  const nodeModulesDest = join(testDir, "node_modules");
  const nodeModulesSrc = join(LAUNCHER_ROOT, "node_modules");
  if (existsSync(nodeModulesSrc) && !existsSync(nodeModulesDest)) {
    symlinkSync(nodeModulesSrc, nodeModulesDest, "junction");
  }

  return { testId, configDir };
};

const cleanupTestEnvironment = (testId: string): void => {
  const testDir = join(TEST_CONFIG_BASE, testId);
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
};

export const runCCC = async (options: RunCCCOptions): Promise<RunCCCResult> => {
  const { projectDir, configFixture, args = ["--print-config"], env = {}, timeout = 30_000 } = options;

  // resolve project directory
  const resolvedProjectDir =
    projectDir.startsWith("/") ? projectDir : join(FIXTURES_DIR, "projects", projectDir);

  if (!existsSync(resolvedProjectDir)) {
    throw new Error(`Project directory not found: ${resolvedProjectDir}`);
  }

  // setup isolated test environment if config fixture specified
  let testEnv: TestConfigPaths | null = null;
  const launcherPath = join(LAUNCHER_ROOT, "src/cli/launcher.ts");
  const testEnvVars: Record<string, string> = {};

  if (configFixture) {
    testEnv = setupTestEnvironment(configFixture);
    // use env var to point to the test config instead of copying the whole launcher
    testEnvVars.CCC_CONFIG_DIR = testEnv.configDir;
  }

  return new Promise((promiseResolve, promiseReject) => {
    // use bun instead of tsx - bun handles TypeScript natively and
    // properly resolves tsconfig paths regardless of cwd
    const child = spawn("bun", ["run", launcherPath, ...args], {
      cwd: resolvedProjectDir,
      env: {
        ...process.env,
        ...env,
        ...testEnvVars,
        HOME: process.env.HOME || "/home/bun",
        NODE_ENV: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      if (testEnv) cleanupTestEnvironment(testEnv.testId);
      promiseReject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      // cleanup isolated test environment
      if (testEnv) {
        cleanupTestEnvironment(testEnv.testId);
      }

      promiseResolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      if (testEnv) cleanupTestEnvironment(testEnv.testId);
      promiseReject(err);
    });
  });
};

export const getFixturePath = (type: "configs" | "projects", name: string): string => {
  return join(FIXTURES_DIR, type, name);
};

export { FIXTURES_DIR, LAUNCHER_ROOT };
