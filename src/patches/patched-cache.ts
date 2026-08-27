import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GRAPH_PRUNE_GRACE_MS, publishGraphDir, readGraphManifest, touchForPruneGrace } from "@/native/cache";
import { log } from "@/utils/log";
import { BUILTIN_PATCHES_VERSION, patchSetDigest, type RuntimePatch } from "./cli-patches";

const CACHE_SUBPATH = path.join("ccc", "claude-cli-patched");
const GRAPH_DIR_NAME = "graph";
const META_FILE_NAME = "meta.json";
const KEY_VERSION = "ccc-patch-cache-v1";
const MAX_CACHED_ENTRIES = 4;

export type PatchCacheMode = "off" | "use" | "verify";

export const patchCacheMode = (env: NodeJS.ProcessEnv = process.env): PatchCacheMode => {
  const raw = env.CCC_PATCH_CACHE?.trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false") return "off";
  if (raw === "verify") return "verify";
  return "use";
};

export interface PatchCacheKeyInput {
  /** Entry module of the extracted, unpatched graph this entry was derived from. */
  extractedCliPath: string;
  /** Version of the node wrapper preamble the graph was materialized with. */
  preambleVersion: string;
  /** User patches, in application order. */
  patches: readonly RuntimePatch[];
  salt?: string;
}

export interface PatchCacheEntry {
  /** null when no patch matched: the caller imports the unpatched graph entry. */
  patchedPath: string | null;
  applied: string[];
  missed: string[];
}

interface PatchCacheMeta extends PatchCacheEntry {
  key: string;
  writtenAt: string;
  /** graph-relative entry path when the patched artifact is a module-graph dir */
  graphEntry?: string;
}

const xdgCacheHome = () => process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
const cacheRoot = () => path.join(xdgCacheHome(), CACHE_SUBPATH);
const entryDir = (key: string) => path.join(cacheRoot(), key);

export const computePatchKey = (input: PatchCacheKeyInput): string => {
  // size + mtime of the graph entry rather than a content hash: this is the identity
  // src/native/cache.ts already trusts, and the whole graph is rewritten atomically on
  // every re-materialization, so the entry's stat moves whenever any module does
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
    if (meta.graphEntry !== undefined && typeof meta.graphEntry !== "string") return null;
    return meta as PatchCacheMeta;
  } catch {
    return null;
  }
};

export const readPatched = (key: string): PatchCacheEntry | null => {
  const meta = readMeta(key);
  if (!meta) return null;
  if (meta.patchedPath === null) {
    touchForPruneGrace(entryDir(key));
    return { patchedPath: null, applied: meta.applied, missed: meta.missed };
  }

  // derived from the key rather than trusted from the metadata: this path is handed straight to
  // import(), and the entry we just read the metadata from is the only one it may refer to
  if (meta.graphEntry === undefined) return null;
  const patchedPath = path.join(entryDir(key), GRAPH_DIR_NAME, meta.graphEntry);
  if (!fs.existsSync(patchedPath)) return null;
  touchForPruneGrace(entryDir(key));
  return { patchedPath, applied: meta.applied, missed: meta.missed };
};

const listFilesRecursive = (dir: string, prefix = ""): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
};

/**
 * Copies a materialized graph into `finalGraphDir`, overlaying `patchedModules`
 * (graph-relative path -> patched contents) and repointing the absolute graph
 * dir embedded in module contents at the copy. Returns the copied entry path.
 */
export const materializePatchedGraph = (
  finalGraphDir: string,
  sourceGraphDir: string,
  patchedModules: Map<string, string>,
): string => {
  const manifest = readGraphManifest(sourceGraphDir);
  if (!manifest) throw new Error(`patch-cache: no graph manifest under ${sourceGraphDir}`);

  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const stagingDir = `${finalGraphDir}.tmp-${suffix}`;
  const substituted = new Set(manifest.substituted);

  for (const rel of listFilesRecursive(sourceGraphDir)) {
    const target = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (substituted.has(rel)) {
      const text = patchedModules.get(rel) ?? fs.readFileSync(path.join(sourceGraphDir, rel), "utf8");
      fs.writeFileSync(target, text.replaceAll(sourceGraphDir, finalGraphDir));
    } else {
      fs.copyFileSync(path.join(sourceGraphDir, rel), target);
    }
  }

  publishGraphDir(stagingDir, finalGraphDir);
  return path.join(finalGraphDir, manifest.entry);
};

const writeGraphTo = (
  dir: string,
  key: string,
  sourceGraphDir: string,
  patchedModules: Map<string, string> | null,
  applied: string[],
  missed: string[],
): PatchCacheEntry => {
  fs.mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;

  const manifest = readGraphManifest(sourceGraphDir);
  if (!manifest) throw new Error(`patch-cache: no graph manifest under ${sourceGraphDir}`);

  let graphEntry: string | undefined;
  let patchedPath: string | null = null;

  if (patchedModules !== null) {
    patchedPath = materializePatchedGraph(path.join(dir, GRAPH_DIR_NAME), sourceGraphDir, patchedModules);
    graphEntry = manifest.entry;
  }

  const meta: PatchCacheMeta = {
    key,
    patchedPath,
    applied,
    missed,
    writtenAt: new Date().toISOString(),
    ...(graphEntry === undefined ? {} : { graphEntry }),
  };
  const tmpMeta = path.join(dir, `${META_FILE_NAME}.tmp-${suffix}`);
  fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
  fs.renameSync(tmpMeta, path.join(dir, META_FILE_NAME));

  return { patchedPath, applied, missed };
};

/**
 * `patchedModules` maps graph-relative paths to patched contents; null means
 * no patch matched and the caller imports the unpatched graph entry directly.
 */
export const writePatchedGraphAtomic = (
  key: string,
  sourceGraphDir: string,
  patchedModules: Map<string, string> | null,
  applied: string[],
  missed: string[],
): PatchCacheEntry => {
  try {
    const entry = writeGraphTo(entryDir(key), key, sourceGraphDir, patchedModules, applied, missed);
    prunePatchedCache(key);
    return entry;
  } catch (error) {
    const primary = entryDir(key);
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    const fallbackDir = path.join(os.tmpdir(), "ccc-claude-cli-patched", key);
    log.warn("PATCH-CACHE", `cache dir ${primary} not writable (${code}); falling back to ${fallbackDir}`);
    return writeGraphTo(fallbackDir, key, sourceGraphDir, patchedModules, applied, missed);
  }
};

/** Keeps the newest entries by mtime, sparing dirs still inside the prune grace. Write-path only: a warm hit must not readdir. */
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
      if (Date.now() - stale.mtimeMs < GRAPH_PRUNE_GRACE_MS) continue;
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
