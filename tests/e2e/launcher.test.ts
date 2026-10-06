import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { buildLaunchSpec } from "@/cli/launcher-wrapper";
import { assertExitCode, assertStderrEmpty, assertStdoutContains } from "../utils/assertions";
import { LAUNCHER_ROOT, runCCC } from "../utils/test-runner";

const expectedDoruRunnerPath = join(LAUNCHER_ROOT, "src/cli/doru-runtime-host-runner.mjs");
const expectedRunnerPath = join(LAUNCHER_ROOT, "src/cli/runtime-host-runner.mjs");
const expectedRuntimeHostPath = "/tmp/ccc-runtime-host.mjs";
const expectedTsconfigPath = join(LAUNCHER_ROOT, "tsconfig.json");

const setupFakeNpx = () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "ccc-fake-npx-"));
  const runnerPathFile = join(fakeBinDir, "runner-path.txt");
  const npxPath = join(fakeBinDir, "npx");

  writeFileSync(
    npxPath,
    `#!/usr/bin/env bash
set -euo pipefail
runner_path="$4"
printf '%s' "$runner_path" > "$CCC_TEST_DORU_RUNNER_PATH_FILE"
node "$runner_path"
`,
    "utf8",
  );
  chmodSync(npxPath, 0o755);

  return {
    fakeBinDir,
    runnerPathFile,
  };
};

const createClaudeRunDirectories = () => {
  const root = mkdtempSync(join(tmpdir(), "ccc-print-mode-"));
  const home = join(root, "home");
  const configDir = join(root, "config");
  mkdirSync(home);
  mkdirSync(join(configDir, "global", "prompts"), { recursive: true });

  return { root, home, configDir };
};

const readClaudeArgv = (directories: ReturnType<typeof createClaudeRunDirectories>, claudeArgs: string[]) => {
  const payloadPath = join(directories.root, "payload.json");
  const payloadDescriptor = openSync(payloadPath, "w");

  try {
    Bun.spawnSync(["bun", join(LAUNCHER_ROOT, "src/cli/launcher.ts"), ...claudeArgs], {
      cwd: directories.root,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: directories.home,
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        CCC_CONFIG_DIR: directories.configDir,
        CCC_NS_VFS: "0",
        CCC_RUNTIME_PAYLOAD_FD: "3",
        CCC_RUNTIME_HOST_PID: String(process.pid),
      },
      stdio: ["ignore", "ignore", "ignore", payloadDescriptor],
    });
  } finally {
    closeSync(payloadDescriptor);
  }

  const payload: { claudeArgv: string[] } = JSON.parse(readFileSync(payloadPath, "utf8"));
  return payload.claudeArgv;
};

const captureMessageRequests = async (
  directories: ReturnType<typeof createClaudeRunDirectories>,
  claudeArgs: string[],
  environment: Record<string, string> = {},
) => {
  const messageBodies: string[] = [];
  const server = Bun.serve({
    port: 0,
    routes: {
      "/v1/messages": async (request) => {
        messageBodies.push(await request.text());
        return Response.json(
          { type: "error", error: { type: "invalid_request_error", message: "captured by test" } },
          { status: 400 },
        );
      },
    },
    fetch: () => Response.json({}),
  });

  try {
    const claude = Bun.spawn(["bun", join(LAUNCHER_ROOT, "src/cli/launcher-wrapper.ts"), ...claudeArgs], {
      cwd: directories.root,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: directories.home,
        SHELL: "/bin/bash",
        LANG: "C.UTF-8",
        TERM: "dumb",
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        CCC_CONFIG_DIR: directories.configDir,
        CCC_NS_VFS: "0",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
        ANTHROPIC_API_KEY: "test-key-not-real",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ...environment,
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await claude.exited;
  } finally {
    server.stop(true);
  }

  return messageBodies;
};

describe("launcher", () => {
  test("wrapper replaces itself with the Node runtime host by default", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--print-config"],
      cwd: "/tmp/ccc-test",
      env: { CCC_NODE: "/usr/bin/node", PATH: "/usr/bin" },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.command).toBe("/usr/bin/node");
    expect(spec.args[0]).toBe(expectedRuntimeHostPath);
    expect(spec.args[1]).toBe("--print-config");
    expect(spec.cwd).toBe("/tmp/ccc-test");
    expect(spec.env.PATH).toBe("/usr/bin");
    expect(spec.env.CCC_BUN_EXEC_PATH).toBe(process.execPath);
    expect(spec.env.TSX_TSCONFIG_PATH).toBe(expectedTsconfigPath);
  });

  test("wrapper runs the launcher through an explicit CCC_TYPESCRIPT_RUNNER", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--print-config"],
      cwd: "/tmp/ccc-test",
      env: { CCC_NODE: "/usr/bin/node", CCC_TYPESCRIPT_RUNNER: "tsx", PATH: "/usr/bin" },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.command).toBe("tsx");
    expect(spec.args[0]).toBe(expectedRunnerPath);
    expect(spec.args[1]).toBe("/usr/bin/node");
    expect(spec.args[2]).toBe(expectedRuntimeHostPath);
    expect(spec.args[3]).toBe("--print-config");
    expect(spec.env.TSX_TSCONFIG_PATH).toBe(expectedTsconfigPath);
  });

  test("wrapper points node at a stable V8 compile cache", () => {
    const spec = buildLaunchSpec({
      cliArgs: [],
      cwd: "/tmp/ccc-test",
      // an enclosing ccc session exports its own NODE_COMPILE_CACHE, which the wrapper honours
      env: { XDG_CACHE_HOME: "/tmp/ccc-test-cache", NODE_COMPILE_CACHE: undefined },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.env.NODE_COMPILE_CACHE).toBe("/tmp/ccc-test-cache/ccc/v8-compile-cache");
  });

  test("wrapper prunes the oldest compile cache entries once the cache exceeds its cap", () => {
    const cacheHome = mkdtempSync(join(tmpdir(), "ccc-compile-cache-test-"));
    const versionDir = join(cacheHome, "ccc", "v8-compile-cache", "v24-x64-test");
    const olderEntrySource = join(cacheHome, "older-entry");
    const newerEntrySource = join(cacheHome, "newer-entry");

    try {
      mkdirSync(versionDir, { recursive: true });
      writeFileSync(olderEntrySource, "");
      utimesSync(olderEntrySource, 1_700_000_000, 1_700_000_000);
      writeFileSync(newerEntrySource, "");

      for (let index = 0; index < 2001; index += 1) {
        linkSync(olderEntrySource, join(versionDir, `older-${index}`));
      }

      for (let index = 0; index < 6000; index += 1) {
        linkSync(newerEntrySource, join(versionDir, `newer-${index}`));
      }

      buildLaunchSpec({
        cliArgs: [],
        cwd: "/tmp/ccc-test",
        env: { XDG_CACHE_HOME: cacheHome, NODE_COMPILE_CACHE: undefined },
        runtimeHostPath: expectedRuntimeHostPath,
      });

      const retainedNames = readdirSync(versionDir);
      expect(retainedNames).toHaveLength(6000);
      expect(retainedNames.every((name) => name.startsWith("newer-"))).toBe(true);
    } finally {
      rmSync(cacheHome, { force: true, recursive: true });
    }
  }, 30_000);

  test("wrapper honours an explicit compile cache dir and the kill switch", () => {
    const explicit = buildLaunchSpec({
      cliArgs: [],
      cwd: "/tmp/ccc-test",
      env: { NODE_COMPILE_CACHE: "/tmp/ccc-explicit-cache" },
      runtimeHostPath: expectedRuntimeHostPath,
    });
    expect(explicit.env.NODE_COMPILE_CACHE).toBe("/tmp/ccc-explicit-cache");

    const disabled = buildLaunchSpec({
      cliArgs: [],
      cwd: "/tmp/ccc-test",
      env: { CCC_COMPILE_CACHE: "0", NODE_COMPILE_CACHE: "" },
      runtimeHostPath: expectedRuntimeHostPath,
    });
    expect(disabled.env.NODE_COMPILE_CACHE).toBe("");
  });

  test("wrapper enables doru only when the flag is leading", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--doru", "--print-config"],
      cwd: "/tmp/ccc-test",
      env: { CCC_NODE: "/usr/bin/node", PATH: "/usr/bin" },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.command).toBe("npx");
    expect(spec.args).toEqual(["--yes", "doru", "--ui", expectedDoruRunnerPath]);
    expect(JSON.parse(spec.env.CCC_DORU_RUNTIME_HOST_PAYLOAD ?? "")).toEqual({
      nodeBinary: "/usr/bin/node",
      runtimeHostPath: expectedRuntimeHostPath,
      forwardedArgs: ["--print-config"],
    });
    expect(spec.env.PATH).toBe("/usr/bin");
    expect(spec.env.TSX_TSCONFIG_PATH).toBe(expectedTsconfigPath);
  });

  test("wrapper preserves literal --doru values for Claude args", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--append-system-prompt", "--doru"],
      cwd: "/tmp/ccc-test",
      env: { CCC_NODE: "/usr/bin/node", PATH: "/usr/bin" },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.command).toBe("/usr/bin/node");
    expect(spec.args).toEqual([expectedRuntimeHostPath, "--append-system-prompt", "--doru"]);
  });

  test("wrapper preserves --doru after --", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--", "--doru"],
      cwd: "/tmp/ccc-test",
      env: { CCC_NODE: "/usr/bin/node", PATH: "/usr/bin" },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.command).toBe("/usr/bin/node");
    expect(spec.args).toEqual([expectedRuntimeHostPath, "--", "--doru"]);
  });

  test("wrapper --print-config exits successfully with minimal config", async () => {
    const result = await runCCC({
      entrypoint: "wrapper",
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertStdoutContains(result.stdout, "Settings:");
    assertStdoutContains(result.stdout, "Commands:");
    assertStdoutContains(result.stdout, "Agents:");
    assertStderrEmpty(result.stderr);
  });

  test("wrapper keeps the explicit TypeScript runner handoff without running preparation in it", async () => {
    const result = await runCCC({
      entrypoint: "wrapper",
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--print-config"],
      env: { CCC_TYPESCRIPT_RUNNER: "tsx" },
    });

    assertExitCode(result.exitCode, 0);
    assertStdoutContains(result.stdout, "Settings:");
    assertStderrEmpty(result.stderr);
  });

  test("wrapper --doru executes the static runtime host runner", async () => {
    const { fakeBinDir, runnerPathFile } = setupFakeNpx();

    try {
      const result = await runCCC({
        entrypoint: "wrapper",
        projectDir: "typescript-basic",
        configFixture: "minimal",
        args: ["--doru", "--print-config"],
        env: {
          CCC_TEST_DORU_RUNNER_PATH_FILE: runnerPathFile,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        },
      });

      assertExitCode(result.exitCode, 0);
      assertStdoutContains(result.stdout, "Settings:");
      assertStdoutContains(result.stdout, "Commands:");
      assertStdoutContains(result.stdout, "Agents:");

      const runnerPath = readFileSync(runnerPathFile, "utf8");
      expect(runnerPath).toBe(expectedDoruRunnerPath);
    } finally {
      rmSync(fakeBinDir, { force: true, recursive: true });
    }
  });

  test("--print-config exits successfully with minimal config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertStdoutContains(result.stdout, "Settings:");
    assertStdoutContains(result.stdout, "Commands:");
    assertStdoutContains(result.stdout, "Agents:");
  });

  test("--print-system-prompt outputs system prompt", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-system-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // should contain content from full-featured/config/global/prompts/system.md
    assertStdoutContains(result.stdout, "Test System Prompt");
  });

  test("--print-user-prompt outputs user prompt", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-user-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // should contain content from the user prompt
    assertStdoutContains(result.stdout, "Test User Prompt");
  });

  test("--dump-config writes the prepared configuration", async () => {
    const userPromptResult = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-user-prompt"],
    });
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--dump-config"],
    });
    const stdout = result.stdout.trimEnd();
    const dumpDir = stdout.slice(stdout.lastIndexOf("\n") + 1);
    const dumpRoot = join(LAUNCHER_ROOT, "tests", "fixtures", "projects", "typescript-basic", ".config-dump");
    expect(dumpDir.startsWith(`${dumpRoot}/`)).toBe(true);

    try {
      assertExitCode(result.exitCode, 0);
      const userPrompt = readFileSync(join(dumpDir, "user.md"), "utf8");
      expect(userPrompt).toContain("Test User Prompt");
      expect(userPrompt).toBe(userPromptResult.stdout.replace(/\n$/, ""));

      const settings = JSON.parse(readFileSync(join(dumpDir, "settings.json"), "utf8"));
      expect(settings.env.TEST_GLOBAL).toBe("true");
      expect(settings.env.TEST_API_KEY).toBe("[redacted]");

      const claudeState = JSON.parse(readFileSync(join(dumpDir, "claude.json"), "utf8"));
      expect(Object.keys(claudeState).filter((key) => key !== "cachedGrowthBookFeatures")).toEqual([]);

      expect(readFileSync(join(dumpRoot, ".gitignore"), "utf8")).toBe("*\n");
    } finally {
      rmSync(dumpRoot, { force: true, recursive: true });
    }
  });

  test("print mode sends the user prompt to the API without a real CLAUDE.md", async () => {
    const directories = createClaudeRunDirectories();
    writeFileSync(join(directories.configDir, "global", "prompts", "user.md"), "Print mode marker 7f3a91\n");

    try {
      const messageBodies = await captureMessageRequests(directories, ["-p", "say hi"]);

      expect(messageBodies.some((body) => body.includes("Print mode marker 7f3a91"))).toBe(true);
      expect(existsSync(join(directories.home, ".claude", "CLAUDE.md"))).toBe(false);
    } finally {
      rmSync(directories.root, { force: true, recursive: true });
    }
  }, 180_000);

  test("multi-value settings flags leave a leading prompt for Claude", async () => {
    const directories = createClaudeRunDirectories();
    writeFileSync(
      join(directories.configDir, "global", "settings.ts"),
      `export default { cli: { addDir: [${JSON.stringify(directories.root)}] } };\n`,
    );

    try {
      const messageBodies = await captureMessageRequests(directories, ["Leading prompt marker 4c81d2", "-p"]);

      expect(messageBodies.some((body) => body.includes("Leading prompt marker 4c81d2"))).toBe(true);
    } finally {
      rmSync(directories.root, { force: true, recursive: true });
    }
  }, 180_000);

  test("channel flags passed as --flag=value replace the configured channels", () => {
    const directories = createClaudeRunDirectories();
    writeFileSync(
      join(directories.configDir, "global", "settings.ts"),
      `export default { cli: { channels: ["plugin:configured@market"], dangerouslyLoadDevelopmentChannels: ["server:configured-dev"] } };\n`,
    );

    try {
      const claudeArgv = readClaudeArgv(directories, [
        "--channels=plugin:manual@market",
        "--dangerously-load-development-channels=server:manual-dev",
      ]);

      expect(claudeArgv.filter((arg) => arg.includes("channels"))).toEqual([
        "--channels=plugin:manual@market",
        "--dangerously-load-development-channels=server:manual-dev",
      ]);
    } finally {
      rmSync(directories.root, { force: true, recursive: true });
    }
  }, 120_000);

  test("a settings flag with an optional value leaves a leading prompt for Claude", async () => {
    const directories = createClaudeRunDirectories();
    const instanceId = randomUUID();
    writeFileSync(join(directories.configDir, "global", "settings.ts"), "export default { cli: { debug: true } };\n");

    try {
      const messageBodies = await captureMessageRequests(directories, ["Leading prompt marker 9d07e5", "-p"], {
        CCC_PRESEEDED_INSTANCE_ID: instanceId,
      });

      expect(messageBodies.some((body) => body.includes("Leading prompt marker 9d07e5"))).toBe(true);
    } finally {
      rmSync(directories.root, { force: true, recursive: true });
      rmSync(join(LAUNCHER_ROOT, ".cache", instanceId), { force: true, recursive: true });
    }
  }, 180_000);

  test("--doctor runs diagnostics", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--doctor"],
    });

    assertExitCode(result.exitCode, 0);
    // doctor output should contain diagnostic info
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
