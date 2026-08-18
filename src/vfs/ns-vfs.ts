import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { createHash } from "node:crypto";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
// relative import: this module is reached from launcher-wrapper.ts, which
// runs under bare bun in standalone installs where "@/" alias resolution
// must not be assumed
import { log } from "../utils/log";

// mount-namespace VFS: the wrapper launches the whole session inside an
// unprivileged user+mount namespace; the launcher then mounts RAM-backed
// tmpfs over the virtual ~/.claude category roots and writes content in.
// Kernel-served, so every child process — static or dynamic, any runtime —
// sees the virtual tree with no preload or seccomp involvement. Nothing but
// empty mountpoint directories ever appears on the real filesystem.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NS_MOUNT_SOURCE = path.join(__dirname, "ns-mount.c");
const CACHE_DIR = path.resolve(__dirname, "..", "..", ".cache", "vfs");
const COMPILE_FLAGS = ["-O2", "-Wall", "-Werror"];

export const NS_ACTIVE_ENV = "CCC_NS_VFS_ACTIVE";
export const NS_KILL_SWITCH_ENV = "CCC_NS_VFS";

const unshareFlags = (): string[] => [
  "-U",
  `--map-user=${os.userInfo().uid}`,
  `--map-group=${os.userInfo().gid}`,
  "--keep-caps",
  "-m",
  "--propagation",
  "slave",
];

/**
 * Wrapper-side: returns the unshare argv prefix when the namespace VFS is
 * enabled and functional on this machine, or null to launch without it.
 */
export const namespacePrefix = (env: NodeJS.ProcessEnv): string[] | null => {
  if (env[NS_KILL_SWITCH_ENV] === "0") {
    log.vfs("Namespace VFS disabled via CCC_NS_VFS=0");
    return null;
  }
  if (process.platform !== "linux") return null;
  try {
    const probe = spawnSync("unshare", [...unshareFlags(), "true"], { stdio: "ignore", timeout: 5000 });
    if (probe.status !== 0) {
      log.vfs(`Namespace VFS unavailable: unshare probe exited ${probe.status}`);
      return null;
    }
  } catch (error) {
    log.vfs(`Namespace VFS unavailable: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  return ["unshare", ...unshareFlags(), "--"];
};

const compileNsMount = (): string => {
  const compiler = process.env.CC ?? "cc";
  const source = readFileSync(NS_MOUNT_SOURCE);
  const hash = createHash("sha256")
    .update(COMPILE_FLAGS.join("\0"))
    .update("\0")
    .update(compiler)
    .update("\0")
    .update(source)
    .digest("hex");
  const cachePath = path.join(CACHE_DIR, `ns-mount-${hash.slice(0, 32)}`);
  if (existsSync(cachePath)) return cachePath;

  mkdirSync(CACHE_DIR, { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  try {
    execFileSync(compiler, [...COMPILE_FLAGS, "-o", tempPath, NS_MOUNT_SOURCE], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    renameSync(tempPath, cachePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return cachePath;
};

export type NsVfsFile = {
  nativePath: string;
  content: string | Buffer;
};

const NOTIFY_SOCKET_ENV = "AGENTS_VFS_NOTIFY_SOCKET";
const NOTIFY_TOKEN_ENV = "AGENTS_VFS_NOTIFY_TOKEN";
const NOTIFY_TOKEN_HEX_BYTES = 64;
const NOTIFY_REGISTER_TIMEOUT_MS = 30_000;

const notifyEntry = (op: "F" | "D", nativePath: string, content?: Buffer): Buffer => {
  const path = Buffer.from(nativePath, "utf8");
  const header = Buffer.alloc(op === "D" ? 4 : 12);
  header.writeUInt32LE(path.byteLength, 0);
  if (op === "F") header.writeBigUInt64LE(BigInt(content?.byteLength ?? 0), 4);
  return Buffer.concat([
    Buffer.from(op, "ascii"),
    header,
    path,
    ...(content ? [content] : []),
  ]);
};

/**
 * Hands the virtual files to the outer launcher's notification supervisor instead of mounting them.
 * Synchronous on purpose: the caller is mid-config-build and the files must be resolvable before it
 * returns. Returns false when no supervisor is configured, which is the standalone-ccc path.
 */
const registerWithNotifySupervisor = (roots: string[], files: NsVfsFile[]): boolean => {
  const socketName = process.env[NOTIFY_SOCKET_ENV];
  const token = process.env[NOTIFY_TOKEN_ENV];
  if (!socketName || !token || token.length !== NOTIFY_TOKEN_HEX_BYTES) return false;

  const entries = [
    ...roots.map((root) => notifyEntry("D", root)),
    ...files.map((file) =>
      notifyEntry("F", file.nativePath, Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content)),
    ),
  ];
  if (entries.length === 0) return true;

  const count = Buffer.alloc(4);
  count.writeUInt32LE(entries.length, 0);
  const payload = Buffer.concat([Buffer.from(token, "ascii"), Buffer.from("B", "ascii"), count, ...entries]);

  // Node has no synchronous unix-socket write, and this runs mid-config-build where the files must
  // be resolvable by the time we return — so the batch send happens in a short-lived child we can block on.
  const sender = `
    const net = require('net');
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      const s = net.connect('\\0' + process.argv[1]);
      s.on('error', (error) => { console.error(error.message); process.exit(1); });
      s.on('data', (data) => data[0] === 0 ? process.exit(0) : process.exit(1));
      // the supervisor drops the connection unanswered on a bad handshake; without this the child
      // exits 0 as if it had registered the batch
      s.on('close', () => process.exit(1));
      s.write(Buffer.concat(chunks));
    });
  `;

  try {
    const senderRuntime = process.env.CCC_BUN_EXEC_PATH ?? process.execPath;
    execFileSync(senderRuntime, ["-e", sender, socketName], {
      input: payload,
      stdio: ["pipe", "ignore", "pipe"],
      // a supervisor that accepts and then stalls would otherwise block startup forever; the real
      // batch is one unix-socket round trip, so this only fires on a stuck peer
      timeout: NOTIFY_REGISTER_TIMEOUT_MS,
    });
  } catch (error) {
    log.warn("VFS", `Notify supervisor registration failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }

  log.vfs(`Notify supervisor: registered ${roots.length} root(s), ${files.length} file(s)`);
  return true;
};

/**
 * Launcher-side (inside the namespace): mounts tmpfs over each root and
 * writes the virtual files into the mounts. Returns false (and writes
 * nothing) when mounting fails, so content is never materialized onto the
 * real filesystem.
 */
export const setupNamespaceVfs = (roots: string[], files: NsVfsFile[]): boolean => {
  // A seccomp user-notification supervisor, when the outer launcher started one, serves these paths
  // to child processes without a mount namespace at all — which is the point, because an
  // unprivileged user namespace maps only our own uid and makes every root-owned file look like
  // nobody, breaking ssh and therefore git. Standalone ccc has no such env and keeps the mounts.
  if (registerWithNotifySupervisor(roots, files)) return true;

  // honor the kill switch here too, not just in namespacePrefix: a child process can
  // inherit CCC_NS_VFS_ACTIVE=1 from an enclosing CCC session (e.g. tests or nested
  // launches run inside one) and would otherwise mount tmpfs despite CCC_NS_VFS=0.
  if (process.env[NS_KILL_SWITCH_ENV] === "0") {
    log.vfs("Namespace VFS mounts skipped: disabled via CCC_NS_VFS=0");
    return false;
  }
  if (process.env[NS_ACTIVE_ENV] !== "1") return false;
  if (roots.length === 0) return false;

  try {
    const helper = compileNsMount();
    execFileSync(helper, roots, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    log.warn("VFS", `Namespace VFS mount failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }

  for (const file of files) {
    mkdirSync(path.dirname(file.nativePath), { recursive: true });
    writeFileSync(file.nativePath, file.content);
  }
  log.vfs(`Namespace VFS ready: ${roots.length} mount(s), ${files.length} file(s)`);
  return true;
};
