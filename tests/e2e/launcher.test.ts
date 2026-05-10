import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { buildLaunchSpec } from "@/cli/launcher-wrapper";
import { assertExitCode, assertStderrEmpty, assertStdoutContains } from "../utils/assertions";
import { LAUNCHER_ROOT, runCCC } from "../utils/test-runner";

const expectedLauncherPath = join(LAUNCHER_ROOT, "src/cli/launcher.ts");
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
  test("wrapper launches tsx directly by default", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--print-config"],
      cwd: "/tmp/ccc-test",
      env: { PATH: "/usr/bin" },
    });

    expect(spec.command).toBe("tsx");
    expect(spec.args[0]).toBe(expectedLauncherPath);
    expect(spec.args[1]).toBe("--print-config");
    expect(spec.tempFile).toBeUndefined();
    expect(spec.cwd).toBe("/tmp/ccc-test");
    expect(spec.env.PATH).toBe("/usr/bin");
    expect(spec.env.TSX_TSCONFIG_PATH).toBe(expectedTsconfigPath);
  });

  test("wrapper enables doru only when the flag is leading", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--doru", "--print-config"],
      cwd: "/tmp/ccc-test",
      env: { PATH: "/usr/bin" },
      tempFilePath: "/tmp/ccc-doru-test.mjs",
    });

    expect(spec.command).toBe("npx");
    expect(spec.args).toEqual(["--yes", "doru", "--ui", "/tmp/ccc-doru-test.mjs"]);
    expect(spec.tempFile?.path).toBe("/tmp/ccc-doru-test.mjs");
    expect(spec.tempFile?.content).toContain('const forwardedArgs = ["--print-config"];');
    expect(spec.env.PATH).toBe("/usr/bin");
    expect(spec.env.TSX_TSCONFIG_PATH).toBe(expectedTsconfigPath);
  });

  test("wrapper preserves literal --doru values for Claude args", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--append-system-prompt", "--doru"],
      cwd: "/tmp/ccc-test",
      env: { PATH: "/usr/bin" },
    });

    expect(spec.command).toBe("tsx");
    expect(spec.args).toEqual([expectedLauncherPath, "--append-system-prompt", "--doru"]);
    expect(spec.tempFile).toBeUndefined();
  });

  test("wrapper preserves --doru after --", () => {
    const spec = buildLaunchSpec({
      cliArgs: ["--", "--doru"],
      cwd: "/tmp/ccc-test",
      env: { PATH: "/usr/bin" },
    });

    expect(spec.command).toBe("tsx");
    expect(spec.args).toEqual([expectedLauncherPath, "--", "--doru"]);
    expect(spec.tempFile).toBeUndefined();
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

  test("wrapper --doru executes the generated runner and cleans it up", async () => {
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
      expect(dirname(runnerPath)).toBe(tmpdir());
      expect(basename(runnerPath)).toStartWith("ccc-doru-");
      expect(existsSync(runnerPath)).toBe(false);
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
