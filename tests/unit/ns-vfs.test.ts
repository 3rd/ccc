import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
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
  test("registers every virtual entry in one supervisor batch", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");
    const directory = mkdtempSync(join(tmpdir(), "ccc-vfs-batch-test-"));
    const capturePath = join(directory, "payload.bin");
    const senderPath = join(directory, "sender.mjs");
    writeFileSync(
      senderPath,
      `#!/usr/bin/env bash
cat > "$3"
`,
    );
    chmodSync(senderPath, 0o755);

    const originalEnvironment = {
      AGENTS_VFS_NOTIFY_SOCKET: process.env.AGENTS_VFS_NOTIFY_SOCKET,
      AGENTS_VFS_NOTIFY_TOKEN: process.env.AGENTS_VFS_NOTIFY_TOKEN,
      CCC_BUN_EXEC_PATH: process.env.CCC_BUN_EXEC_PATH,
    };
    const token = "a".repeat(64);
    process.env.AGENTS_VFS_NOTIFY_SOCKET = capturePath;
    process.env.AGENTS_VFS_NOTIFY_TOKEN = token;
    process.env.CCC_BUN_EXEC_PATH = senderPath;

    try {
      expect(
        setupNamespaceVfs(["/virtual/root"], [
          { nativePath: "/virtual/root/file.txt", content: "contents" },
        ]),
      ).toBe(true);

      const payload = readFileSync(capturePath);
      expect(payload.subarray(0, 64).toString("ascii")).toBe(token);
      expect(payload.subarray(64, 65).toString("ascii")).toBe("B");
      expect(payload.readUInt32LE(65)).toBe(2);

      let offset = 69;
      expect(payload.subarray(offset, offset + 1).toString("ascii")).toBe("D");
      offset += 1;
      const rootLength = payload.readUInt32LE(offset);
      offset += 4;
      expect(payload.subarray(offset, offset + rootLength).toString("utf8")).toBe("/virtual/root");
      offset += rootLength;

      expect(payload.subarray(offset, offset + 1).toString("ascii")).toBe("F");
      offset += 1;
      const pathLength = payload.readUInt32LE(offset);
      offset += 4;
      const contentLength = Number(payload.readBigUInt64LE(offset));
      offset += 8;
      expect(payload.subarray(offset, offset + pathLength).toString("utf8")).toBe(
        "/virtual/root/file.txt",
      );
      offset += pathLength;
      expect(payload.subarray(offset, offset + contentLength).toString("utf8")).toBe("contents");
      offset += contentLength;
      expect(offset).toBe(payload.length);
    } finally {
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("accepts an empty virtual tree without opening a supervisor connection", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");
    const directory = mkdtempSync(join(tmpdir(), "ccc-vfs-empty-batch-test-"));

    const originalEnvironment = {
      AGENTS_VFS_NOTIFY_SOCKET: process.env.AGENTS_VFS_NOTIFY_SOCKET,
      AGENTS_VFS_NOTIFY_TOKEN: process.env.AGENTS_VFS_NOTIFY_TOKEN,
      CCC_BUN_EXEC_PATH: process.env.CCC_BUN_EXEC_PATH,
    };
    process.env.AGENTS_VFS_NOTIFY_SOCKET = "unused-empty-batch-socket";
    process.env.AGENTS_VFS_NOTIFY_TOKEN = "a".repeat(64);
    process.env.CCC_BUN_EXEC_PATH = join(directory, "missing-sender");

    try {
      expect(setupNamespaceVfs([], [])).toBe(true);
    } finally {
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(directory, { force: true, recursive: true });
    }
  });

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
