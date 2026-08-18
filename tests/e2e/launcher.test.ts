import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildLaunchSpec } from "@/cli/launcher-wrapper";
import { assertExitCode, assertStderrEmpty, assertStdoutContains } from "../utils/assertions";
import { LAUNCHER_ROOT, runCCC } from "../utils/test-runner";

const expectedLauncherPath = join(LAUNCHER_ROOT, "src/cli/launcher.ts");
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
      env: { XDG_CACHE_HOME: "/tmp/ccc-test-cache" },
      runtimeHostPath: expectedRuntimeHostPath,
    });

    expect(spec.env.NODE_COMPILE_CACHE).toBe("/tmp/ccc-test-cache/ccc/v8-compile-cache");
  });

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
