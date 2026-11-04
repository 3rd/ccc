import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  computePreparationKey,
  createPreparationCacheEntry,
  findChangedDependency,
  instantiatePreparation,
  type PreparationToCache,
} from "@/cli/preparation-cache";
import type { RuntimeHostPayload } from "@/cli/runtime-host";

const tempDirs: string[] = [];

const makeTempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);

  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const BUILD_INSTANCE_ID = "4f1c8a19-0e2b-4c9d-8a7e-3b5d6f708192";
const BUILD_EVENTS_FILE = "/tmp/recording/ses_a1b2c3d4-0000-4000-8000-000000000001.events.jsonl";
const BUILD_SOCKET = "agents-vfs-notify-4021-0a1b2c3d4e5f60718293";
const OAUTH_TOKEN = "sk-ant-oat01-example-token-value-0123456789";

const launchEnv = (instanceId: string, eventsFile: string, socket: string) => ({
  HOME: "/home/example",
  PATH: "/usr/bin",
  CCC_PRESEEDED_INSTANCE_ID: instanceId,
  CCC_EVENTS_FILE: eventsFile,
  AGENTS_VFS_NOTIFY_SOCKET: socket,
  CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
});

const settingsWithHooks = (instanceId: string, eventsFile: string) => {
  const command = `CCC_INSTANCE_ID='${instanceId}' CCC_EVENTS_FILE='${eventsFile}' bun runner.ts`;

  return JSON.stringify({ hooks: { Stop: [{ command }] } });
};

const buildPayload = (env: Record<string, string>, instanceId: string) => ({
  version: 1,
  claudeArgv: ["/cli.mjs", "--mcp-config", JSON.stringify({ mcpServers: { search: { env: { API_TOKEN: OAUTH_TOKEN } } } })],
  importPath: "/graph/entry.mjs",
  environment: { ...env, CCC_INSTANCE_ID: instanceId, USE_BUILTIN_RIPGREP: "0" },
  virtualFileSystem: {
    version: 1,
    files: [
      { path: "/home/example/.claude.json", content: "{\"projects\":{}}\n" },
      { path: "/home/example/.claude/settings.json", content: settingsWithHooks(instanceId, env.CCC_EVENTS_FILE ?? "") },
    ],
    virtualCommands: [],
    virtualAgents: [],
    virtualSkills: [],
    virtualRoots: [],
    categoryContent: "filesystem",
  },
}) satisfies RuntimeHostPayload;

const preparationFor = (overrides: Partial<PreparationToCache> = {}): PreparationToCache => {
  const incomingEnv = launchEnv(BUILD_INSTANCE_ID, BUILD_EVENTS_FILE, BUILD_SOCKET);

  return {
    key: "0123456789abcdef0123456789abcdef",
    startedAtNs: BigInt(Date.now() + 1) * 1_000_000n,
    incomingEnv,
    instanceId: BUILD_INSTANCE_ID,
    workingDirectory: "/home/example/project",
    lookups: [],
    coveredTrees: [],
    excludedPaths: [],
    payload: buildPayload(incomingEnv, BUILD_INSTANCE_ID),
    categories: { roots: ["/home/example/.claude/skills"], files: [{ nativePath: "/home/example/.claude/skills/a/SKILL.md", sourcePath: "/skills/a/SKILL.md" }] },
    areCategoriesServed: true,
    trust: { claudeStatePath: "/home/example/.claude.json", trustedPaths: ["/home/example/project"], featureFlags: undefined, claudeState: undefined },
    patchKey: "patch-key",
    missedPatches: [],
    ...overrides,
  };
};

const createEntry = (preparation: PreparationToCache) => {
  const created = createPreparationCacheEntry(preparation);
  if (!created.entry) throw new Error(`entry not created: ${created.reason}`);

  return created.entry;
};

describe("preparation cache entries", () => {
  test("a reuse fills in its own launch's values and the stored entry holds no secret or per-launch value", () => {
    const entry = createEntry(preparationFor());
    const stored = JSON.stringify(entry);

    for (const value of [OAUTH_TOKEN, BUILD_INSTANCE_ID, BUILD_EVENTS_FILE, BUILD_SOCKET]) {
      expect(stored).not.toContain(value);
    }

    const nextInstanceId = "b0e4e8f1-5a2c-4d18-9b21-6a7cdeadbeef";
    const nextEventsFile = "/tmp/recording/ses_f9e8d7c6-0000-4000-8000-000000000002.events.jsonl";
    const nextEnv = launchEnv(nextInstanceId, nextEventsFile, "agents-vfs-notify-5032-ffeeddccbbaa99887766");
    const reused = instantiatePreparation(entry, nextEnv, nextInstanceId);
    const expected = buildPayload(nextEnv, nextInstanceId);

    expect(reused?.environment).toEqual(expected.environment);
    expect(reused?.virtualFileSystem.files[1]).toEqual(expected.virtualFileSystem.files[1]);
  });

  test("is not created when the preparation embeds a secret it cannot keep out of the entry", () => {
    const secret = 'pass"word with spaces 0123456789';
    const incomingEnv = { ...launchEnv(BUILD_INSTANCE_ID, BUILD_EVENTS_FILE, BUILD_SOCKET), SERVICE_PASSWORD: secret };
    const payload = buildPayload(incomingEnv, BUILD_INSTANCE_ID);
    payload.claudeArgv.push(`--mcp-secret=${secret}`);

    expect(createPreparationCacheEntry(preparationFor({ incomingEnv, payload })).reason).toContain("SERVICE_PASSWORD");
  });

  test("is not created when the preparation embeds a value derived from a per-launch variable", () => {
    const workerSocket = "/tmp/agents-post-tool-a1B2c3/worker-0042.sock";
    const incomingEnv = {
      ...launchEnv(BUILD_INSTANCE_ID, BUILD_EVENTS_FILE, BUILD_SOCKET),
      AGENTS_VFS_POST_TOOL_WORKER: JSON.stringify({ socketPath: workerSocket, token: "abc" }),
    };
    const payload = buildPayload(incomingEnv, BUILD_INSTANCE_ID);
    payload.claudeArgv.push(`--worker=${workerSocket}`);

    expect(createPreparationCacheEntry(preparationFor({ incomingEnv, payload })).reason).toContain(
      "AGENTS_VFS_POST_TOOL_WORKER",
    );
  });

  test("treats a token the key covers as constant even inside a per-launch value", () => {
    const checkout = makeTempDir("ccc-preparation-a1b2c3d4-0000-4000-8000-00000000abcd-");
    const executable = path.join(checkout, "foreground-job-control");
    fs.writeFileSync(executable, "");

    const incomingEnv = {
      ...launchEnv(BUILD_INSTANCE_ID, BUILD_EVENTS_FILE, BUILD_SOCKET),
      PWD: checkout,
      AGENTS_VFS_FOREGROUND_JOB_CONTROL: JSON.stringify({ executable, socketName: "agents-foreground-jobs-77-0f0c315cb8e7db09" }),
    };
    const payload = buildPayload(incomingEnv, BUILD_INSTANCE_ID);
    payload.claudeArgv.push(`--plugin-dir=${checkout}/plugins`);

    const entry = createEntry(preparationFor({ incomingEnv, payload, lookups: [{ isListing: false, path: executable }] }));

    expect(entry.dependencies.map(([, target]) => target)).toEqual([executable]);
  });

  test("keeps a path that matches the shell's previous directory unchanged on reuse", () => {
    const launcherCheckout = "/home/example/launcher";
    const incomingEnv = { ...launchEnv(BUILD_INSTANCE_ID, BUILD_EVENTS_FILE, BUILD_SOCKET), OLDPWD: launcherCheckout };
    const builtPayload = buildPayload(incomingEnv, BUILD_INSTANCE_ID);
    const addon = `${launcherCheckout}/.cache/native/bun-ant.node`;
    const payload = { ...builtPayload, environment: { ...builtPayload.environment, CCC_BUN_ANT_ADDON: addon } };

    const entry = createEntry(preparationFor({ incomingEnv, payload }));
    const nextEnv = { ...incomingEnv, OLDPWD: "/home/example/project" };
    const reused = instantiatePreparation(entry, nextEnv, BUILD_INSTANCE_ID);

    expect(reused?.environment.CCC_BUN_ANT_ADDON).toBe(addon);
    expect(reused?.environment.OLDPWD).toBe("/home/example/project");
  });

  test("is not reused when variables that held one value at build time diverge", () => {
    const entry = createEntry(preparationFor());
    const nextEnv = launchEnv("c3d2e1f0-4a5b-4c6d-8e7f-90a1b2c3d4e5", BUILD_EVENTS_FILE, BUILD_SOCKET);

    expect(instantiatePreparation(entry, nextEnv, "different-instance-id-0123456789")).toBeUndefined();
  });

  test("a looked-up directory stays valid when it gains entries, a listed one does not", () => {
    const root = makeTempDir("ccc-preparation-deps-");
    const looked = path.join(root, "looked");
    const listed = path.join(root, "listed");
    const file = path.join(root, "file.txt");
    fs.mkdirSync(looked);
    fs.mkdirSync(listed);
    fs.writeFileSync(file, "before");

    const entry = createEntry(preparationFor({
      lookups: [
        { isListing: false, path: looked },
        { isListing: true, path: listed },
        { isListing: false, path: file },
        { isListing: false, path: path.join(root, "absent.txt") },
      ],
    }));
    expect(findChangedDependency(entry)).toBeUndefined();

    fs.writeFileSync(path.join(looked, "new.txt"), "");
    expect(findChangedDependency(entry)).toBeUndefined();

    fs.writeFileSync(path.join(listed, "new.txt"), "");
    expect(findChangedDependency(entry)).toBe(listed);
  });

  test("a file that appears where a lookup found nothing invalidates the entry", () => {
    const root = makeTempDir("ccc-preparation-absent-");
    const absent = path.join(root, "tsconfig.json");
    const entry = createEntry(preparationFor({ lookups: [{ isListing: false, path: absent }] }));

    fs.writeFileSync(absent, "{}");
    expect(findChangedDependency(entry)).toBe(absent);
  });

  test("relies on a directory's listing for names the preparation found missing in it", () => {
    const root = makeTempDir("ccc-preparation-listed-");
    const marker = path.join(root, "go.mod");
    const entry = createEntry(preparationFor({
      lookups: [
        { isListing: true, path: root },
        { isListing: false, path: marker },
      ],
    }));
    expect(entry.dependencies.map(([kind, target]) => `${kind}${target}`)).toEqual([`L${root}`]);

    fs.writeFileSync(marker, "module example\n");
    expect(findChangedDependency(entry)).toBe(root);
  });

  test("is not created when a file it read changed after the preparation started", () => {
    const root = makeTempDir("ccc-preparation-racy-");
    const startedAtNs = BigInt(Date.now() - 10_000) * 1_000_000n;
    const file = path.join(root, "settings.ts");
    fs.writeFileSync(file, "export default {};\n");

    const created = createPreparationCacheEntry(preparationFor({ startedAtNs, lookups: [{ isListing: false, path: file }] }));

    expect(created.reason).toBe(`${file} changed during preparation`);
  });

  test("relies on a covered tree except below a symlink or a skipped directory", () => {
    const root = makeTempDir("ccc-preparation-covered-");
    const outside = makeTempDir("ccc-preparation-outside-");
    fs.mkdirSync(path.join(root, "plain"));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.symlinkSync(outside, path.join(root, "linked"));

    const plain = path.join(root, "plain", "a.ts");
    const skipped = path.join(root, "node_modules", "b.ts");
    const throughLink = path.join(root, "linked", "c.ts");

    const entry = createEntry(preparationFor({
      lookups: [plain, skipped, throughLink].map((target) => ({ isListing: false, path: target })),
      coveredTrees: [{ root, skipPaths: [], skipDirNames: ["node_modules"] }],
    }));

    expect(entry.dependencies.map(([, target]) => target)).toEqual([skipped, throughLink]);
  });

  test("narrows a listing of the working directory's ancestors to the entries the module resolver reads", () => {
    const entry = createEntry(preparationFor({
      workingDirectory: "/home/example/project",
      lookups: [{ isListing: true, path: "/home/example" }],
    }));

    expect(entry.dependencies.map(([kind, target]) => `${kind}${target}`)).toEqual([
      "P/home/example",
      "P/home/example/package.json",
      "P/home/example/node_modules",
      "P/home/example/tsconfig.json",
      "P/home/example/jsconfig.json",
      "P/home/example/bunfig.toml",
    ]);
  });
});

describe("preparation cache key", () => {
  const keyFor = (env: NodeJS.ProcessEnv, launcherDirectory: string) => {
    return computePreparationKey({ argv: ["--continue"], cwd: "/home/example/project", env, launcherDirectory });
  };

  test("ignores per-launch and cache-control values but not other variables", () => {
    const launcherDirectory = makeTempDir("ccc-preparation-launcher-");
    fs.mkdirSync(path.join(launcherDirectory, "src"));
    fs.writeFileSync(path.join(launcherDirectory, "src", "launcher.ts"), "export {};\n");

    const base = { HOME: "/home/example", CCC_EVENTS_FILE: BUILD_EVENTS_FILE };
    const key = keyFor(base, launcherDirectory);

    expect(keyFor({ ...base, CCC_EVENTS_FILE: "/tmp/recording/other.jsonl" }, launcherDirectory)).toBe(key);
    expect(keyFor({ ...base, CCC_PREPARATION_CACHE: "refresh" }, launcherDirectory)).toBe(key);
    expect(keyFor({ ...base, HOME: "/home/other" }, launcherDirectory)).not.toBe(key);
    expect(keyFor({ HOME: "/home/example" }, launcherDirectory)).not.toBe(key);
  });

  test("changes when a launcher source file changes", () => {
    const launcherDirectory = makeTempDir("ccc-preparation-launcher-");
    fs.mkdirSync(path.join(launcherDirectory, "src"));
    const source = path.join(launcherDirectory, "src", "launcher.ts");
    fs.writeFileSync(source, "export {};\n");
    const key = keyFor({ HOME: "/home/example" }, launcherDirectory);

    fs.writeFileSync(source, "export const changed = true;\n");
    expect(keyFor({ HOME: "/home/example" }, launcherDirectory)).not.toBe(key);
  });
});
