import { execFile } from "child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, test } from "bun:test";

const execFileAsync = promisify(execFile);

const runInVfs = async (home: string, body: string) => {
  const script = `
import fs from "fs";
import { join } from "path";
import { homedir } from "os";
import { promisify } from "util";
import { setupVirtualFileSystem } from "./src/utils/virtual-fs.ts";

setupVirtualFileSystem({ settings: {}, userPrompt: "", skills: [{ name: "probe", files: [{ relativePath: "SKILL.md", content: "# probe" }] }] });
const skillPath = join(homedir(), ".claude", "skills", "probe", "SKILL.md");
${body}
`;
  const { stdout } = await execFileAsync("bun", ["--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, CCC_NS_VFS: "0" },
    timeout: 5000,
  });
  return JSON.parse(stdout);
};

describe("patched fs statics", () => {
  test("realpath.native and the custom promisify of exists survive the wrapper", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-fs-statics-home-"));
    try {
      const result = await runInVfs(
        home,
        `
const realpathNative = promisify(fs.realpath.native);
const existsAsync = promisify(fs.exists);
console.log(JSON.stringify({
  nativeType: typeof fs.realpath.native,
  resolved: await realpathNative(process.cwd()),
  exists: await existsAsync(process.cwd()),
}));
`,
      );

      expect(result).toEqual({ nativeType: "function", resolved: process.cwd(), exists: true });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("statSync and lstatSync serve virtual files and honor throwIfNoEntry and bigint", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-fs-statics-home-"));

    try {
      const result = await runInVfs(
        home,
        `
const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
const missingSkillPath = join(homedir(), ".claude", "skills", "missing", "SKILL.md");
console.log(JSON.stringify({
  claudeMdIsFile: fs.lstatSync(claudeMdPath).isFile(),
  skillSize: fs.lstatSync(skillPath).size,
  isMissingLstatUndefined: fs.lstatSync(missingSkillPath, { throwIfNoEntry: false }) === undefined,
  isMissingStatUndefined: fs.statSync(missingSkillPath, { throwIfNoEntry: false }) === undefined,
  bigintLstatSizeType: typeof fs.lstatSync(skillPath, { bigint: true }).size,
  bigintStatSizeType: typeof fs.statSync(skillPath, { bigint: true }).size,
}));
`,
      );

      expect(result).toEqual({
        claudeMdIsFile: true,
        skillSize: "# probe".length,
        isMissingLstatUndefined: true,
        isMissingStatUndefined: true,
        bigintLstatSizeType: "bigint",
        bigintStatSizeType: "bigint",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("async stat and lstat serve virtual files and reject missing ones", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-fs-statics-home-"));

    try {
      const result = await runInVfs(
        home,
        `
const missingSkillPath = join(homedir(), ".claude", "skills", "missing", "SKILL.md");
const callbackSize = (stat, filePath) =>
  new Promise((resolve, reject) => stat(filePath, (error, stats) => (error ? reject(error) : resolve(stats.size))));
console.log(JSON.stringify({
  promisesLstatSize: (await fs.promises.lstat(skillPath)).size,
  callbackStatSize: await callbackSize(fs.stat, skillPath),
  callbackLstatSize: await callbackSize(fs.lstat, skillPath),
  missingPromisesLstatCode: await fs.promises.lstat(missingSkillPath).then(() => "found", (error) => error.code),
  missingCallbackStatCode: await callbackSize(fs.stat, missingSkillPath).then(() => "found", (error) => error.code),
}));
`,
      );

      expect(result).toEqual({
        promisesLstatSize: "# probe".length,
        callbackStatSize: "# probe".length,
        callbackLstatSize: "# probe".length,
        missingPromisesLstatCode: "ENOENT",
        missingCallbackStatCode: "ENOENT",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("stat and lstat report the real parent folders of virtual files", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-fs-statics-home-"));

    try {
      const result = await runInVfs(
        home,
        `
const home = homedir();
const callbackMode = (stat) =>
  new Promise((resolve, reject) => stat(home, (error, stats) => (error ? reject(error) : resolve(stats.mode & 0o7777))));
console.log(JSON.stringify({
  lstatSyncMode: fs.lstatSync(home).mode & 0o7777,
  statSyncMode: fs.statSync(home).mode & 0o7777,
  promisesLstatMode: (await fs.promises.lstat(home)).mode & 0o7777,
  promisesStatMode: (await fs.promises.stat(home)).mode & 0o7777,
  callbackLstatMode: await callbackMode(fs.lstat),
}));
`,
      );

      expect(result).toEqual({
        lstatSyncMode: 0o700,
        statSyncMode: 0o700,
        promisesLstatMode: 0o700,
        promisesStatMode: 0o700,
        callbackLstatMode: 0o700,
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("stat and read agree on a settings file reached through a symlinked ~/.claude", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-fs-statics-home-"));
    const realClaudeDirectory = join(home, "dotfiles-claude");

    try {
      await mkdir(realClaudeDirectory);
      await writeFile(join(realClaudeDirectory, "settings.json"), '{ "kept": "on disk, longer than the virtual file" }');
      await symlink(realClaudeDirectory, join(home, ".claude"));

      const result = await runInVfs(
        home,
        `
const aliasPath = join(homedir(), "dotfiles-claude", "settings.json");
const readSize = fs.readFileSync(aliasPath).length;
console.log(JSON.stringify({
  statSyncMatchesRead: fs.statSync(aliasPath).size === readSize,
  lstatSyncMatchesRead: fs.lstatSync(aliasPath).size === readSize,
  promisesLstatMatchesRead: (await fs.promises.lstat(aliasPath)).size === readSize,
}));
`,
      );

      expect(result).toEqual({
        statSyncMatchesRead: true,
        lstatSyncMatchesRead: true,
        promisesLstatMatchesRead: true,
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("every realpath entry point returns a virtual skill path as-is", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-fs-statics-home-"));
    try {
      const result = await runInVfs(
        home,
        `
console.log(JSON.stringify({
  sync: fs.realpathSync(skillPath),
  syncNative: fs.realpathSync.native(skillPath),
  async: await promisify(fs.realpath)(skillPath),
  asyncNative: await promisify(fs.realpath.native)(skillPath),
  expected: skillPath,
}));
`,
      );

      expect(result).toEqual({
        sync: result.expected,
        syncNative: result.expected,
        async: result.expected,
        asyncNative: result.expected,
        expected: result.expected,
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});
