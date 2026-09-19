import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
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
