import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, test } from "bun:test";
import { NS_ACTIVE_ENV, NS_KILL_SWITCH_ENV, namespacePrefix } from "@/vfs/ns-vfs";

const projectRoot = resolve(import.meta.dir, "..", "..");
const prefix = namespacePrefix(process.env);
const canRun = prefix !== null;

const VIRTUAL_ROOT = join(tmpdir(), `ccc-ns-vfs-test-${process.pid}`);

const innerScript = `
const { setupNamespaceVfs } = await import("${join(projectRoot, "src", "vfs", "ns-vfs.ts")}");
const { spawnSync } = await import("child_process");
const root = ${JSON.stringify(VIRTUAL_ROOT)};
const ok = setupNamespaceVfs([root], [
  { nativePath: root + "/demo/SKILL.md", content: "# ns demo\\n" },
  { nativePath: root + "/demo/references/notes.md", content: "ns notes\\n" },
]);
const cat = spawnSync("cat", [root + "/demo/references/notes.md"], { encoding: "utf8" });
const ls = spawnSync("ls", [root + "/demo"], { encoding: "utf8" });
const nested = spawnSync("bash", ["-c", "cat " + root + "/demo/SKILL.md"], { encoding: "utf8" });
console.log(JSON.stringify({ ok, cat: cat.stdout, ls: ls.stdout, nested: nested.stdout }));
`;

describe.if(canRun)("namespace VFS", () => {
  test("mounts tmpfs, writes content, children see it, outside does not", () => {
    const result = spawnSync(
      prefix![0]!,
      [...prefix!.slice(1), "bun", "-e", innerScript],
      {
        encoding: "utf8",
        cwd: projectRoot,
        env: { ...process.env, [NS_ACTIVE_ENV]: "1" },
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
      ok: boolean;
      cat: string;
      ls: string;
      nested: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.cat).toBe("ns notes\n");
    expect(parsed.ls.split("\n").filter(Boolean).sort()).toEqual(["SKILL.md", "references"]);
    expect(parsed.nested).toBe("# ns demo\n");

    // outside the namespace only the empty mountpoint dir may exist
    if (existsSync(VIRTUAL_ROOT)) expect(readdirSync(VIRTUAL_ROOT)).toEqual([]);
  });
});

describe("namespace VFS gating", () => {
  test("kill switch disables the prefix", () => {
    expect(namespacePrefix({ ...process.env, [NS_KILL_SWITCH_ENV]: "0" })).toBeNull();
  });

  test("setup is inert without the active marker", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");
    const prior = process.env[NS_ACTIVE_ENV];
    delete process.env[NS_ACTIVE_ENV];
    try {
      expect(setupNamespaceVfs(["/tmp/ccc-ns-inert"], [])).toBe(false);
      expect(existsSync("/tmp/ccc-ns-inert")).toBe(false);
    } finally {
      if (prior !== undefined) process.env[NS_ACTIVE_ENV] = prior;
    }
  });
});
