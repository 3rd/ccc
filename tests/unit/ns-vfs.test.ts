import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { createServer, type Socket } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, test } from "bun:test";
import { NOTIFY_SOCKET_ENV, NOTIFY_TOKEN_ENV, NS_ACTIVE_ENV, NS_KILL_SWITCH_ENV, namespacePrefix } from "@/vfs/ns-vfs";

const projectRoot = resolve(import.meta.dir, "..", "..");
const prefix = namespacePrefix({ [NS_KILL_SWITCH_ENV]: process.env[NS_KILL_SWITCH_ENV] });
const canRun = prefix !== null;

describe.if(canRun)("namespace VFS", () => {
  test("mounts tmpfs, writes content, children see it but cannot change it, outside does not", () => {
    const virtualRoot = mkdtempSync(join(tmpdir(), "ccc-ns-vfs-test-"));
    const innerScript = `
delete process.env.${NOTIFY_SOCKET_ENV};
delete process.env.${NOTIFY_TOKEN_ENV};
const { setupNamespaceVfs } = await import("${join(projectRoot, "src", "vfs", "ns-vfs.ts")}");
const { spawnSync } = await import("child_process");
const root = ${JSON.stringify(virtualRoot)};
const ok = await setupNamespaceVfs([root], [
  { nativePath: root + "/demo/SKILL.md", content: "# ns demo\\n" },
  { nativePath: root + "/demo/references/notes.md", content: "ns notes\\n" },
]);
const cat = spawnSync("cat", [root + "/demo/references/notes.md"], { encoding: "utf8" });
const ls = spawnSync("ls", [root + "/demo"], { encoding: "utf8" });
const nested = spawnSync("bash", ["-c", "cat " + root + "/demo/SKILL.md"], { encoding: "utf8" });
const overwrite = spawnSync("bash", ["-c", "echo changed > " + root + "/demo/SKILL.md"], { encoding: "utf8" });
const afterOverwrite = spawnSync("cat", [root + "/demo/SKILL.md"], { encoding: "utf8" });
console.log(JSON.stringify({
  ok,
  cat: cat.stdout,
  ls: ls.stdout,
  nested: nested.stdout,
  overwriteStatus: overwrite.status,
  afterOverwrite: afterOverwrite.stdout,
}));
`;

    try {
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
      expect(result.status, result.stderr).toBe(0);
      const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
        ok: boolean;
        cat: string;
        ls: string;
        nested: string;
        overwriteStatus: number | null;
        afterOverwrite: string;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.cat).toBe("ns notes\n");
      expect(parsed.ls.split("\n").filter(Boolean).sort()).toEqual(["SKILL.md", "references"]);
      expect(parsed.nested).toBe("# ns demo\n");

      expect(parsed.overwriteStatus).not.toBe(0);
      expect(parsed.afterOverwrite).toBe("# ns demo\n");

      // outside the namespace only the empty mountpoint dir may exist
      expect(readdirSync(virtualRoot)).toEqual([]);
    } finally {
      rmSync(virtualRoot, { recursive: true, force: true });
    }
  });
});

const restoreEnvironment = (saved: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const listenOnAbstractSocket = async (socketName: string, onConnection: (connection: Socket) => void) => {
  const server = createServer(onConnection);
  await new Promise<void>((resolveListen) => server.listen(`\0${socketName}`, resolveListen));

  return server;
};

const startAcknowledgingSupervisor = async (socketName: string, byteCount: number) => {
  const chunks: Buffer[] = [];
  const server = await listenOnAbstractSocket(socketName, (connection) => {
    connection.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length < byteCount) return;

      connection.write(Buffer.from([0]));
    });
  });

  return { received: () => Buffer.concat(chunks), close: () => server.close() };
};

describe("namespace VFS gating", () => {
  test("registers every virtual entry in one supervisor batch", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");
    const socketName = `ccc-vfs-batch-test-${process.pid}`;
    const token = "a".repeat(64);

    const headerLength = 64 + 1 + 4;
    const rootEntryLength = 1 + 4 + "/virtual/root".length;
    const fileEntryLength = 1 + 4 + 8 + "/virtual/root/file.txt".length + "contents".length;
    const supervisor = await startAcknowledgingSupervisor(socketName, headerLength + rootEntryLength + fileEntryLength);

    const originalEnvironment = {
      AGENTS_VFS_NOTIFY_SOCKET: process.env.AGENTS_VFS_NOTIFY_SOCKET,
      AGENTS_VFS_NOTIFY_TOKEN: process.env.AGENTS_VFS_NOTIFY_TOKEN,
    };
    process.env.AGENTS_VFS_NOTIFY_SOCKET = socketName;
    process.env.AGENTS_VFS_NOTIFY_TOKEN = token;

    try {
      expect(namespacePrefix({ [NOTIFY_SOCKET_ENV]: socketName, [NOTIFY_TOKEN_ENV]: token })).toBeNull();
      expect(
        await setupNamespaceVfs(["/virtual/root"], [
          { nativePath: "/virtual/root/file.txt", content: "contents" },
        ]),
      ).toBe(true);

      const payload = supervisor.received();
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
      restoreEnvironment(originalEnvironment);
      supervisor.close();
    }
  });

  test("treats a supervisor that closes without acknowledging as a failed registration", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");
    const socketName = `ccc-vfs-unanswered-test-${process.pid}`;
    const server = await listenOnAbstractSocket(socketName, (connection) => connection.end());

    const originalEnvironment = {
      AGENTS_VFS_NOTIFY_SOCKET: process.env.AGENTS_VFS_NOTIFY_SOCKET,
      AGENTS_VFS_NOTIFY_TOKEN: process.env.AGENTS_VFS_NOTIFY_TOKEN,
      [NS_ACTIVE_ENV]: process.env[NS_ACTIVE_ENV],
    };
    process.env.AGENTS_VFS_NOTIFY_SOCKET = socketName;
    process.env.AGENTS_VFS_NOTIFY_TOKEN = "a".repeat(64);
    delete process.env[NS_ACTIVE_ENV];

    try {
      expect(
        await setupNamespaceVfs(["/virtual/root"], [{ nativePath: "/virtual/root/file.txt", content: "contents" }]),
      ).toBe(false);
    } finally {
      restoreEnvironment(originalEnvironment);
      server.close();
    }
  });

  test("accepts an empty virtual tree without opening a supervisor connection", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");

    const originalEnvironment = {
      AGENTS_VFS_NOTIFY_SOCKET: process.env.AGENTS_VFS_NOTIFY_SOCKET,
      AGENTS_VFS_NOTIFY_TOKEN: process.env.AGENTS_VFS_NOTIFY_TOKEN,
    };
    process.env.AGENTS_VFS_NOTIFY_SOCKET = "unused-empty-batch-socket";
    process.env.AGENTS_VFS_NOTIFY_TOKEN = "a".repeat(64);

    try {
      expect(await setupNamespaceVfs([], [])).toBe(true);
    } finally {
      restoreEnvironment(originalEnvironment);
    }
  });

  test("kill switch disables the prefix", () => {
    expect(namespacePrefix({ ...process.env, [NS_KILL_SWITCH_ENV]: "0" })).toBeNull();
  });

  test("setup is inert without the active marker", async () => {
    const { setupNamespaceVfs } = await import("@/vfs/ns-vfs");
    const cleared = [NS_ACTIVE_ENV, NOTIFY_SOCKET_ENV, NOTIFY_TOKEN_ENV];
    const prior = Object.fromEntries(cleared.map((key) => [key, process.env[key]]));
    for (const key of cleared) delete process.env[key];
    const root = join(tmpdir(), `ccc-ns-inert-${process.pid}`);
    try {
      expect(await setupNamespaceVfs([root], [])).toBe(false);
      expect(existsSync(root)).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  });
});
