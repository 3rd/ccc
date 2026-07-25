import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, test } from "bun:test";

const execFileAsync = promisify(execFile);

// CCC_NS_VFS=0: keep the child on the in-process VFS so no kernel mounts are left over
// the temp HOME when the suite runs inside a CCC session (see virtual-fs-workflows.test.ts
// for the EBUSY failure mode).
const runInVfs = async (home: string, body: string) => {
  const script = `
import fs from "fs";
import { join } from "path";
import { homedir } from "os";
import { setupVirtualFileSystem } from "./src/utils/virtual-fs.ts";

setupVirtualFileSystem({ settings: { model: "opusplan" }, userPrompt: "" });

const settingsPath = join(homedir(), ".claude", "settings.json");
${body}
`;
  const { stdout } = await execFileAsync("bun", ["--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, CCC_NS_VFS: "0" },
    timeout: 5000,
  });
  return JSON.parse(stdout);
};

describe("settings.json write absorption", () => {
  test("an atomic save through renameSync is visible to later reads and never touches the real file", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-settings-write-home-"));
    try {
      const result = await runInVfs(
        home,
        `
const staging = settingsPath + ".tmp." + process.pid + ".abcdef";
const next = { ...JSON.parse(fs.readFileSync(settingsPath, "utf8")), effortLevel: "max" };
fs.writeFileSync(staging, JSON.stringify(next, null, 2));
fs.renameSync(staging, settingsPath);

const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
console.log(JSON.stringify({ effortLevel: after.effortLevel, model: after.model }));
`,
      );

      expect(result).toEqual({ effortLevel: "max", model: "opusplan" });
      // the volume absorbed both halves: no real settings file, no leftover staging file
      expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
      expect((await readdir(join(home, ".claude"))).filter((name) => name.includes(".tmp."))).toEqual([]);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("writeFileSync, promises.writeFile and promises.rename all absorb", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-settings-write-home-"));
    try {
      const result = await runInVfs(
        home,
        `
fs.writeFileSync(settingsPath, JSON.stringify({ step: "sync" }));
const afterSync = JSON.parse(fs.readFileSync(settingsPath, "utf8")).step;

await fs.promises.writeFile(settingsPath, JSON.stringify({ step: "promises" }));
const afterPromises = JSON.parse(fs.readFileSync(settingsPath, "utf8")).step;

const staging = settingsPath + ".tmp.renamed";
fs.writeFileSync(staging, JSON.stringify({ step: "renamed" }));
await fs.promises.rename(staging, settingsPath);
const afterRename = JSON.parse(fs.readFileSync(settingsPath, "utf8")).step;

console.log(JSON.stringify({ afterSync, afterPromises, afterRename }));
`,
      );

      expect(result).toEqual({ afterSync: "sync", afterPromises: "promises", afterRename: "renamed" });
      expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("the other protected paths still reject writes", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-settings-write-home-"));
    try {
      const result = await runInVfs(
        home,
        `
const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
const codes = {};
try {
  fs.writeFileSync(claudeMdPath, "overwritten");
} catch (error) {
  codes.claudeMd = error.code;
}
try {
  fs.renameSync(settingsPath, settingsPath + ".bak");
} catch (error) {
  codes.settingsAsSource = error.code;
}
console.log(JSON.stringify(codes));
`,
      );

      expect(result).toEqual({ claudeMd: "EACCES", settingsAsSource: "EACCES" });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});
