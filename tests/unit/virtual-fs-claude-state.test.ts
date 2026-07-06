import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, test } from "bun:test";

const execFileAsync = promisify(execFile);

describe("claudeState virtual filesystem passthrough", () => {
  test("merges claudeState keys into the virtual ~/.claude.json and keeps them out of settings.json", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccc-vfs-claude-state-home-"));
    const script = `
import fs from "fs";
import { join } from "path";
import { homedir } from "os";
import { setupVirtualFileSystem } from "./src/utils/virtual-fs.ts";

setupVirtualFileSystem({
  settings: { claudeState: { leftArrowOpensAgents: false }, featureFlags: { tengu_test_flag: true } },
  userPrompt: "",
});

const state = JSON.parse(fs.readFileSync(join(homedir(), ".claude.json"), "utf8"));
const settings = JSON.parse(fs.readFileSync(join(homedir(), ".claude", "settings.json"), "utf8"));
console.log(JSON.stringify({
  leftArrowOpensAgents: state.leftArrowOpensAgents,
  cachedFlag: state.cachedGrowthBookFeatures?.tengu_test_flag,
  claudeStateInSettings: "claudeState" in settings,
  featureFlagsInSettings: "featureFlags" in settings,
}));
`;

    try {
      const { stdout } = await execFileAsync("bun", ["--eval", script], {
        cwd: process.cwd(),
        // CCC_NS_VFS=0: keep the child on the in-process VFS so no kernel mounts are
        // left over the temp HOME when the suite runs inside a CCC session (see
        // virtual-fs-workflows.test.ts for the EBUSY failure mode).
        env: { ...process.env, HOME: home, CCC_NS_VFS: "0" },
        timeout: 5000,
      });

      expect(JSON.parse(stdout)).toEqual({
        leftArrowOpensAgents: false,
        cachedFlag: true,
        claudeStateInSettings: false,
        featureFlagsInSettings: false,
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});
