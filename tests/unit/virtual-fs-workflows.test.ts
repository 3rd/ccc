import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, test } from "bun:test";

const execFileAsync = promisify(execFile);

describe("workflow virtual filesystem", () => {
  test("injects generated files and blocks writes inside protected virtual directories", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-workflows-home-"));
    const script = `
import fs from "fs";
import { join } from "path";
import { homedir } from "os";
import { setupVirtualFileSystem } from "./src/utils/virtual-fs.ts";

setupVirtualFileSystem({
  settings: {},
  userPrompt: "",
  outputStyles: new Map([["style.md", "---\\nname: style\\n---\\n"]]),
  workflows: new Map([["x.js", "export const meta = { name: 'x', description: 'x' };\\n"]]),
});

const workflowPath = join(homedir(), ".claude", "workflows", "x.js");
const outputStylePath = join(homedir(), ".claude", "output-styles", "style.md");
const content = fs.readFileSync(workflowPath, "utf8");
const outputStyleContent = fs.readFileSync(outputStylePath, "utf8");
const openResult = await new Promise((resolve) => {
  fs.open(workflowPath, (error, fd) => {
    if (error) {
      resolve({ code: error.code });
      return;
    }
    fs.closeSync(fd);
    resolve({ ok: true });
  });
});
let syncWriteCode;
let asyncOpenCode;
let outputStyleWriteCode;
try {
  fs.writeFileSync(workflowPath, "bad");
} catch (error) {
  syncWriteCode = error?.code;
}
try {
  await fs.promises.open(workflowPath, "w");
} catch (error) {
  asyncOpenCode = error?.code;
}
try {
  fs.writeFileSync(outputStylePath, "bad");
} catch (error) {
  outputStyleWriteCode = error?.code;
}
console.log(JSON.stringify({ content, outputStyleContent, openResult, syncWriteCode, asyncOpenCode, outputStyleWriteCode }));
`;

    try {
      const { stdout } = await execFileAsync("bun", ["--eval", script], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home },
        timeout: 5000,
      });

      const result: unknown = JSON.parse(stdout);
      expect(result).toMatchObject({
        content: "export const meta = { name: 'x', description: 'x' };\n",
        outputStyleContent: "---\nname: style\n---\n",
        openResult: { ok: true },
        syncWriteCode: "EACCES",
        asyncOpenCode: "EACCES",
        outputStyleWriteCode: "EACCES",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});
