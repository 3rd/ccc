import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { log } from "@/utils/log";
import { BUILTIN_PATCHES_VERSION, patchSetDigest, type RuntimePatch } from "./cli-patches";

const CACHE_SUBPATH = path.join("ccc", "claude-cli-patched");
const CACHED_FILE_NAME = "cli.mjs";
const META_FILE_NAME = "meta.json";
const KEY_VERSION = "ccc-patch-cache-v1";
const MAX_CACHED_ENTRIES = 4;
const MIN_CACHED_FILE_SIZE = 1024 * 1024;

export type PatchCacheMode = "off" | "use" | "verify";

export const patchCacheMode = (env: NodeJS.ProcessEnv = process.env): PatchCacheMode => {
  const raw = env.CCC_PATCH_CACHE?.trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false") return "off";
  if (raw === "verify") return "verify";
  return "use";
};

export interface PatchCacheKeyInput {
  /** The extracted, unpatched bundle this entry was derived from. */
  extractedCliPath: string;
  /** Version of the node wrapper preamble baked into the extracted bundle. */
  preambleVersion: string;
  /** User patches, in application order. */
  patches: readonly RuntimePatch[];
  /**
   * Optional identity of the generated config the patches came from. Absent for a standalone CCC
   * launch, where the patch digest alone carries the identity.
   */
  configFingerprint?: string;
  salt?: string;
}

export interface PatchCacheEntry {
  /** null when no patch matched: the caller imports the unpatched bundle, exactly as before. */
  patchedPath: string | null;
  applied: string[];
  missed: string[];
}

interface PatchCacheMeta extends PatchCacheEntry {
  key: string;
  writtenAt: string;
}

const xdgCacheHome = () => process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
const cacheRoot = () => path.join(xdgCacheHome(), CACHE_SUBPATH);
const entryDir = (key: string) => path.join(cacheRoot(), key);

export const computePatchKey = (input: PatchCacheKeyInput): string => {
  // size + mtime rather than a content hash: this is the identity src/native/cache.ts already
  // trusts for the extracted bundle, and hashing 21MB would cost more than the patching it saves
  const stats = fs.statSync(input.extractedCliPath);
  return createHash("sha256")
    .update(KEY_VERSION)
    .update("\0")
    .update(path.resolve(input.extractedCliPath))
    .update("\0")
    .update(String(stats.size))
    .update("\0")
    .update(String(stats.mtimeMs))
    .update("\0")
    .update(input.preambleVersion)
    .update("\0")
    .update(BUILTIN_PATCHES_VERSION)
    .update("\0")
    .update(patchSetDigest(input.patches))
    .update("\0")
    .update(input.configFingerprint ?? "")
    .update("\0")
    .update(input.salt ?? "")
    .digest("hex")
    .slice(0, 16);
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const readMeta = (key: string): PatchCacheMeta | null => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(entryDir(key), META_FILE_NAME), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const meta = parsed as Partial<PatchCacheMeta>;
    if (meta.key !== key) return null;
    if (!isStringArray(meta.applied) || !isStringArray(meta.missed)) return null;
    if (meta.patchedPath !== null && typeof meta.patchedPath !== "string") return null;
    return meta as PatchCacheMeta;
  } catch {
    return null;
  }
};

export const readPatched = (key: string): PatchCacheEntry | null => {
  const meta = readMeta(key);
  if (!meta) return null;
  if (meta.patchedPath === null) return { patchedPath: null, applied: meta.applied, missed: meta.missed };

  // derived from the key rather than trusted from the metadata: this path is handed straight to
  // import(), and the entry we just read the metadata from is the only one it may refer to
  const patchedPath = path.join(entryDir(key), CACHED_FILE_NAME);
  try {
    if (fs.statSync(patchedPath).size < MIN_CACHED_FILE_SIZE) return null;
  } catch {
    return null;
  }
  return { patchedPath, applied: meta.applied, missed: meta.missed };
};

const writeTo = (dir: string, key: string, content: string | null, applied: string[], missed: string[]) => {
  fs.mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const patchedPath = content === null ? null : path.join(dir, CACHED_FILE_NAME);

  // bundle first, metadata second: a reader requires valid metadata, so a torn write reads as a
  // miss rather than pointing at a half-written bundle
  if (content !== null && patchedPath) {
    const tmpCli = path.join(dir, `${CACHED_FILE_NAME}.tmp-${suffix}`);
    fs.writeFileSync(tmpCli, content);
    fs.renameSync(tmpCli, patchedPath);
  }

  const meta: PatchCacheMeta = {
    key,
    patchedPath,
    applied,
    missed,
    writtenAt: new Date().toISOString(),
  };
  const tmpMeta = path.join(dir, `${META_FILE_NAME}.tmp-${suffix}`);
  fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
  fs.renameSync(tmpMeta, path.join(dir, META_FILE_NAME));

  return { patchedPath, applied, missed } satisfies PatchCacheEntry;
};

export const writePatchedAtomic = (
  key: string,
  content: string | null,
  applied: string[],
  missed: string[],
): PatchCacheEntry => {
  try {
    const entry = writeTo(entryDir(key), key, content, applied, missed);
    prunePatchedCache(key);
    return entry;
  } catch (error) {
    const primary = entryDir(key);
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    const fallbackDir = path.join(os.tmpdir(), "ccc-claude-cli-patched", key);
    log.warn("PATCH-CACHE", `cache dir ${primary} not writable (${code}); falling back to ${fallbackDir}`);
    return writeTo(fallbackDir, key, content, applied, missed);
  }
};

/** Keeps the newest entries by mtime. Write-path only: a warm hit must not readdir. */
export const prunePatchedCache = (keepKey: string): void => {
  try {
    const root = cacheRoot();
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== keepKey)
      .map((entry) => {
        const dir = path.join(root, entry.name);
        return { dir, mtimeMs: fs.statSync(dir).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    for (const stale of entries.slice(Math.max(0, MAX_CACHED_ENTRIES - 1))) {
      fs.rmSync(stale.dir, { recursive: true, force: true });
      log.debug("PATCH-CACHE", `pruned ${stale.dir}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("PATCH-CACHE", `prune failed: ${message}`);
  }
};

export const dropPatchedEntry = (key: string): void => {
  try {
    fs.rmSync(entryDir(key), { recursive: true, force: true });
  } catch {
    // best-effort
  }
};
