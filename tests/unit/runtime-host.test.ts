import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildRuntimeHost } from "@/cli/runtime-host-build";
import {
  validateRuntimeHostPayload,
  type RuntimeHostPayload,
  withoutTsxNodeOptions,
} from "@/cli/runtime-host";
import {
  PREPARATION_LAUNCHER_PATH_ENV,
  RUNTIME_HOST_PAYLOAD_FD_ENV,
  RUNTIME_HOST_PID_ENV,
} from "@/cli/runtime-host-process";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "ccc-runtime-host-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const makePayload = (home: string, importPath: string): RuntimeHostPayload => ({
  version: 1,
  claudeArgv: [importPath, "--runtime-test"],
  importPath,
  featureFlags: { runtimeTest: true },
  environment: {},
  virtualFileSystem: {
    version: 1,
    files: [
      { path: join(home, ".claude.json"), content: "{}" },
      { path: join(home, ".claude", "settings.json"), content: "{}" },
      { path: join(home, ".claude", "CLAUDE.md"), content: "runtime prompt" },
    ],
    virtualCommands: [],
    virtualAgents: [],
    virtualSkills: [],
    virtualRoots: [],
  },
});

const writePreparationScript = (directory: string, payload: RuntimeHostPayload) => {
  const preparationPath = join(directory, "prepare.mjs");
  writeFileSync(
    preparationPath,
    `import fs from "node:fs";
const payload = ${JSON.stringify(payload)};
payload.environment = Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined));
delete payload.environment.${RUNTIME_HOST_PAYLOAD_FD_ENV};
delete payload.environment.${PREPARATION_LAUNCHER_PATH_ENV};
delete payload.environment.${RUNTIME_HOST_PID_ENV};

fs.writeFileSync(${JSON.stringify(join(directory, "runtime-host-pid"))}, String(process.env.${RUNTIME_HOST_PID_ENV}));
fs.writeFileSync(Number(process.env.${RUNTIME_HOST_PAYLOAD_FD_ENV}), JSON.stringify(payload));
`,
  );
  return preparationPath;
};

const launchHost = async (options: {
  directory: string;
  debug?: string;
  fakeClaudeSource: string;
  graphRoot?: string;
  runtimeLogPath?: string;
}) => {
  const fakeClaudePath = join(options.graphRoot ?? options.directory, "fake-claude.mjs");
  writeFileSync(fakeClaudePath, options.fakeClaudeSource);
  const payload = makePayload(options.directory, fakeClaudePath);
  payload.runtimeLogPath = options.runtimeLogPath;
  const preparationPath = writePreparationScript(options.directory, payload);
  const hostPath = await buildRuntimeHost();
  return spawn("node", [hostPath], {
    cwd: options.directory,
    env: {
      ...process.env,
      CCC_EVENTS_FILE: undefined,
      HOME: options.directory,
      DEBUG: options.debug ?? "1",
      CCC_BUN_EXEC_PATH: process.execPath,
      [PREPARATION_LAUNCHER_PATH_ENV]: preparationPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const waitForClose = (child: ReturnType<typeof spawn>) =>
  new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });

const waitForJsonLine = (child: ReturnType<typeof spawn>, expectedType: string) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let pending = "";
    const onData = (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === expectedType) {
          child.stdout?.off("data", onData);
          resolve(Object.fromEntries(Object.entries(parsed)));
          return;
        }
      }
    };
    child.once("error", reject);
    child.stdout?.on("data", onData);
  });

const waitForTermination = (child: ReturnType<typeof spawn>) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

describe("runtime host", () => {
  test("validates every boundary field", () => {
    const directory = makeTemporaryDirectory();
    const payload = makePayload(directory, pathToFileURL(join(directory, "fake.mjs")).href);

    expect(validateRuntimeHostPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    expect(() => validateRuntimeHostPayload({ ...payload, version: 2 })).toThrow("version");
    expect(() =>
      validateRuntimeHostPayload({
        ...payload,
        virtualFileSystem: { ...payload.virtualFileSystem, files: [{ path: 1, content: "bad" }] },
      }),
    ).toThrow("files[0].path");
  });

  test("removes only tsx loaders from inherited Node options", () => {
    expect(withoutTsxNodeOptions("--max-old-space-size=4096 --import tsx --trace-warnings")).toBe(
      "--max-old-space-size=4096 --trace-warnings",
    );
    expect(withoutTsxNodeOptions("--require=/tmp/register.cjs")).toBe("--require=/tmp/register.cjs");
  });

  test("prepares in Bun with the host's pid, then imports the target in that Node host", async () => {
    const directory = makeTemporaryDirectory();
    const resultPath = join(directory, "result.json");
    const runtimeLogPath = join(directory, "runtime.log");
    writeFileSync(runtimeLogPath, "");
    const child = await launchHost({
      directory,
      runtimeLogPath,
      fakeClaudeSource: `import fs from "node:fs";
import os from "node:os";
fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
  pid: process.pid,
  argv: process.argv,
  eventsFile: process.env.CCC_EVENTS_FILE,
  featureFlags: globalThis.__cccFeatureFlags,
  prompt: fs.readFileSync(os.homedir() + "/.claude/CLAUDE.md", "utf8"),
}));
`,
    });
    const hostPid = child.pid;
    const exitCode = await waitForClose(child);

    expect(exitCode).toBe(0);
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    expect(result).toEqual({
      pid: hostPid,
      argv: expect.any(Array),
      eventsFile: expect.any(String),
      featureFlags: { runtimeTest: true },
      prompt: "runtime prompt",
    });
    expect(readFileSync(join(directory, "runtime-host-pid"), "utf8")).toBe(String(hostPid));
    expect(result.argv.slice(2)).toEqual(["--runtime-test"]);
    expect(result.argv[0]).toContain("node");
    expect(existsSync(result.eventsFile)).toBe(false);
    expect(readFileSync(runtimeLogPath, "utf8")).toContain("CLAUDE.md");
  });

  test("imports graph modules once, under their real path, through a symlinked graph root", async () => {
    const directory = makeTemporaryDirectory();
    const realRoot = join(directory, "graph-root");
    const linkedRoot = join(directory, "linked-root");
    const resultPath = join(directory, "result.json");
    mkdirSync(realRoot);
    symlinkSync(realRoot, linkedRoot);
    const resolvedRoot = realpathSync(realRoot);

    writeFileSync(join(realRoot, "package.json"), '{"type":"module"}\n');
    writeFileSync(
      join(realRoot, "chunk-shared.js"),
      `globalThis.sharedEvaluations = (globalThis.sharedEvaluations ?? 0) + 1;
export const sharedUrl = import.meta.url;
`,
    );
    writeFileSync(
      join(realRoot, "chunk-user.js"),
      `export { sharedUrl } from ${JSON.stringify(join(resolvedRoot, "chunk-shared.js"))};
`,
    );

    const child = await launchHost({
      directory,
      graphRoot: linkedRoot,
      fakeClaudeSource: `import fs from "node:fs";
import { sharedUrl } from ${JSON.stringify(join(linkedRoot, "chunk-shared.js"))};
import { sharedUrl as userSharedUrl } from ${JSON.stringify(join(linkedRoot, "chunk-user.js"))};
fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
  entryUrl: import.meta.url,
  sharedUrl,
  userSharedUrl,
  sharedEvaluations: globalThis.sharedEvaluations,
}));
`,
    });

    expect(await waitForClose(child)).toBe(0);
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toEqual({
      entryUrl: pathToFileURL(join(resolvedRoot, "fake-claude.mjs")).href,
      sharedUrl: pathToFileURL(join(resolvedRoot, "chunk-shared.js")).href,
      userSharedUrl: pathToFileURL(join(resolvedRoot, "chunk-shared.js")).href,
      sharedEvaluations: 1,
    });
  });

  test("preserves VFS diagnostics when DEBUG writes to stdout", async () => {
    const directory = makeTemporaryDirectory();
    const runtimeLogPath = join(directory, "runtime.log");
    writeFileSync(runtimeLogPath, "");
    const child = await launchHost({
      directory,
      debug: "stdout",
      runtimeLogPath,
      fakeClaudeSource: `import fs from "node:fs";
import os from "node:os";
fs.readFileSync(os.homedir() + "/.claude/CLAUDE.md", "utf8");
`,
    });
    const stdout = new Response(child.stdout).text();

    expect(await waitForClose(child)).toBe(0);
    expect(await stdout).toContain("[VFS]");
    expect(await stdout).toContain("CLAUDE.md");
  });

  test("reports a preparation process terminated by a signal as a failure", async () => {
    const directory = makeTemporaryDirectory();
    const preparationPath = join(directory, "prepare.mjs");
    writeFileSync(preparationPath, 'process.kill(process.pid, "SIGTERM");\n');
    const hostPath = await buildRuntimeHost();
    const child = spawn("node", [hostPath], {
      cwd: directory,
      env: {
        ...process.env,
        CCC_BUN_EXEC_PATH: process.execPath,
        [PREPARATION_LAUNCHER_PATH_ENV]: preparationPath,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = new Response(child.stderr).text();

    expect(await waitForClose(child)).not.toBe(0);
    expect(await stderr).toContain("CCC preparation terminated by SIGTERM");
  });

  test("refuses to start on Node releases older than 24", async () => {
    const directory = makeTemporaryDirectory();
    const preloadPath = join(directory, "node-22.cjs");
    writeFileSync(
      preloadPath,
      'Object.defineProperty(process, "versions", { value: { ...process.versions, node: "22.14.0" } });\n',
    );
    const hostPath = await buildRuntimeHost();
    const child = spawn("node", ["--require", preloadPath, hostPath], {
      cwd: directory,
      env: {
        ...process.env,
        CCC_BUN_EXEC_PATH: process.execPath,
        [PREPARATION_LAUNCHER_PATH_ENV]: join(directory, "prepare.mjs"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = new Response(child.stderr).text();

    expect(await waitForClose(child)).not.toBe(0);
    expect(await stderr).toContain("CCC requires Node.js 24 or newer");
  });

  test("the runner fallback forwards termination signals to the Node host", async () => {
    const directory = makeTemporaryDirectory();
    const preloadPath = join(directory, "without-execve.cjs");
    const fakeHostPath = join(directory, "fake-runtime-host.mjs");
    writeFileSync(preloadPath, 'Object.defineProperty(process, "execve", { configurable: true, value: undefined });\n');
    writeFileSync(
      fakeHostPath,
      'console.log(JSON.stringify({ type: "ready", pid: process.pid }));\nsetInterval(() => {}, 1000);\n',
    );
    const runnerPath = join(import.meta.dir, "../../src/cli/runtime-host-runner.mjs");
    const child = spawn("node", ["--require", preloadPath, runnerPath, "node", fakeHostPath], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ready = await waitForJsonLine(child, "ready");
    const hostPid = Number(ready.pid);
    expect(hostPid).toBeGreaterThan(0);
    const terminated = waitForTermination(child);

    child.kill("SIGTERM");

    expect(await terminated).toEqual({ code: null, signal: "SIGTERM" });
    expect(() => process.kill(hostPid, 0)).toThrow();
  });

  test("Claude can replace SIGINT handling without a Bun parent exiting", async () => {
    const directory = makeTemporaryDirectory();
    const child = await launchHost({
      directory,
      fakeClaudeSource: `
process.removeAllListeners("SIGINT");
process.on("SIGINT", () => console.log(JSON.stringify({ type: "cancelled", pid: process.pid })));
console.log(JSON.stringify({ type: "ready", pid: process.pid, eventsFile: process.env.CCC_EVENTS_FILE }));
setInterval(() => {}, 1000);
`,
    });
    const ready = await waitForJsonLine(child, "ready");
    const eventsFile = String(ready.eventsFile);
    expect(ready.pid).toBe(child.pid);
    expect(existsSync(eventsFile)).toBe(true);

    const cancelledLine = waitForJsonLine(child, "cancelled");
    child.kill("SIGINT");
    const cancelled = await cancelledLine;
    expect(cancelled.pid).toBe(child.pid);
    expect(child.exitCode).toBeNull();
    expect(existsSync(eventsFile)).toBe(true);

    const closed = waitForClose(child);
    child.kill("SIGTERM");
    expect(await closed).toBe(0);
    expect(existsSync(eventsFile)).toBe(false);
  });
});
