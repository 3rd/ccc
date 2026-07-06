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

/**
 * Launcher-side (inside the namespace): mounts tmpfs over each root and
 * writes the virtual files into the mounts. Returns false (and writes
 * nothing) when mounting fails, so content is never materialized onto the
 * real filesystem.
 */
export const setupNamespaceVfs = (roots: string[], files: NsVfsFile[]): boolean => {
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
