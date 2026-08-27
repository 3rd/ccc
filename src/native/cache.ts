import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { log } from "@/utils/log";
import { NATIVE_BUNFS_ROOT_PREFIX } from "./constants";

const CACHE_SUBPATH = path.join("ccc", "claude-cli");
const GRAPH_DIR_NAME = "graph";
const GRAPH_META_FILE_NAME = "graph.meta.json";
export const GRAPH_MANIFEST_FILE_NAME = "__ccc_manifest.json";

const MAX_CACHED_VERSIONS = 3;
// a session lazily imports graph files for its whole lifetime, so prune must not
// delete a graph a live session may still read: dirs written or hit within this
// grace (the read paths refresh dir mtime) survive the count caps
export const GRAPH_PRUNE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const xdgCacheHome = () => process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
export const getCacheRoot = () => path.join(xdgCacheHome(), CACHE_SUBPATH);
export const getVersionCacheDir = (version: string) => path.join(getCacheRoot(), version);

interface CacheMeta {
  binarySize: number;
  binaryMtimeMs: number;
  /** hash of the preamble text and graph layout; bumps auto-invalidate old caches */
  preambleVersion: string;
}

type SemverParts = [major: number, minor: number, patch: number];

const binaryStillMatches = (meta: CacheMeta, binaryPath: string) => {
  try {
    const st = fs.statSync(binaryPath);
    return st.size === meta.binarySize && st.mtimeMs === meta.binaryMtimeMs;
  } catch {
    return false;
  }
};

const parseSemverParts = (v: string): SemverParts => {
  const [maj, min, pat] = v.split(".").map((n) => Number.parseInt(n) || 0);
  return [maj ?? 0, min ?? 0, pat ?? 0];
};

const compareSemverDesc = (a: string, b: string) => {
  const [a1, a2, a3] = parseSemverParts(a);
  const [b1, b2, b3] = parseSemverParts(b);
  if (b1 !== a1) return b1 - a1;
  if (b2 !== a2) return b2 - a2;
  return b3 - a3;
};

// ---------------------------------------------------------------------------
// module-graph cache (claude-code >= 2.1.242)
//
// `<version>/graph/` holds the materialized module tree (root/... files plus
// the ccc shim modules). Module files are stored with their bunfs prefix
// already substituted for the final absolute graph path, so the tree is
// directly importable. `__ccc_manifest.json` inside the graph dir lists the
// rewritten module files so the patch pipeline knows which files carry code.
// ---------------------------------------------------------------------------

export interface GraphManifest {
  version: 1;
  /** graph-relative path of the entry module, e.g. "root/cli.mjs" */
  entry: string;
  /** graph-relative paths of rewritten JS modules (patchable text files) */
  modules: string[];
  /** graph-relative paths whose contents embed the absolute graph dir (modules + ccc shims) */
  substituted: string[];
}

export interface MaterializedGraphFile {
  /** path relative to the graph dir, e.g. "root/_0.js" */
  relPath: string;
  contents: Buffer | string;
  /** substitute the bunfs prefix for the final absolute graph path on write */
  substitutePrefix: boolean;
}

export interface CachedGraph {
  graphDir: string;
  entryPath: string;
  manifest: GraphManifest;
}

const isGraphManifest = (value: unknown): value is GraphManifest => {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<GraphManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.entry === "string" &&
    Array.isArray(manifest.modules) &&
    manifest.modules.every((entry) => typeof entry === "string") &&
    Array.isArray(manifest.substituted) &&
    manifest.substituted.every((entry) => typeof entry === "string")
  );
};

const readGraphMeta = (version: string): CacheMeta | null => {
  const p = path.join(getVersionCacheDir(version), GRAPH_META_FILE_NAME);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as CacheMeta).binarySize === "number" &&
      typeof (parsed as CacheMeta).binaryMtimeMs === "number" &&
      typeof (parsed as CacheMeta).preambleVersion === "string"
    ) {
      return parsed as CacheMeta;
    }
    return null;
  } catch {
    return null;
  }
};

export const readGraphManifest = (graphDir: string): GraphManifest | null => {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(graphDir, GRAPH_MANIFEST_FILE_NAME), "utf8"),
    );
    return isGraphManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const readCachedGraph = (
  version: string,
  binaryPath: string,
  currentPreambleVersion: string,
): CachedGraph | null => {
  const graphDir = path.join(getVersionCacheDir(version), GRAPH_DIR_NAME);
  const meta = readGraphMeta(version);
  if (!meta) return null;
  if (meta.preambleVersion !== currentPreambleVersion) {
    log.info(
      "NATIVE",
      `graph cache invalid: preamble version changed (${meta.preambleVersion} → ${currentPreambleVersion})`,
    );
    return null;
  }
  if (!binaryStillMatches(meta, binaryPath)) {
    log.info("NATIVE", `graph cache invalid: binary changed since extraction (${version})`);
    return null;
  }
  const manifest = readGraphManifest(graphDir);
  if (!manifest) return null;
  const entryPath = path.join(graphDir, manifest.entry);
  if (!fs.existsSync(entryPath)) return null;
  touchForPruneGrace(getVersionCacheDir(version));
  return { graphDir, entryPath, manifest };
};

/** marks a cache dir as recently used so prune's grace period protects it (best-effort) */
export const touchForPruneGrace = (dir: string) => {
  try {
    const now = new Date();
    fs.utimesSync(dir, now, now);
  } catch {
    // read-only cache: the dir just loses grace protection
  }
};

/**
 * Publishes a fully written staging dir at `finalGraphDir`. Directories have no
 * atomic replace; retiring the previous graph with a rename keeps the
 * missing-path window to the instant between the two renames, instead of the
 * full delete-then-rename span a concurrent reader could fall into.
 */
export const publishGraphDir = (stagingDir: string, finalGraphDir: string) => {
  const retiredDir = `${finalGraphDir}.old-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(finalGraphDir, retiredDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    fs.renameSync(stagingDir, finalGraphDir);
    return;
  }
  fs.renameSync(stagingDir, finalGraphDir);
  fs.rmSync(retiredDir, { recursive: true, force: true });
};

const writeGraphTo = (
  versionDir: string,
  files: MaterializedGraphFile[],
  manifest: GraphManifest,
  meta: CacheMeta,
): CachedGraph => {
  fs.mkdirSync(versionDir, { recursive: true });
  const finalGraphDir = path.join(versionDir, GRAPH_DIR_NAME);
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const stagingDir = path.join(versionDir, `${GRAPH_DIR_NAME}.tmp-${suffix}`);
  const substitutedPrefix = `${finalGraphDir}${path.sep}root${path.sep}`;

  for (const file of files) {
    const target = path.join(stagingDir, file.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (file.substitutePrefix) {
      const text = typeof file.contents === "string" ? file.contents : file.contents.toString("utf8");
      fs.writeFileSync(target, text.replaceAll(NATIVE_BUNFS_ROOT_PREFIX, substitutedPrefix));
    } else {
      fs.writeFileSync(target, file.contents);
    }
  }
  fs.writeFileSync(path.join(stagingDir, GRAPH_MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2));

  publishGraphDir(stagingDir, finalGraphDir);

  const tmpMeta = path.join(versionDir, `${GRAPH_META_FILE_NAME}.tmp-${suffix}`);
  fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
  fs.renameSync(tmpMeta, path.join(versionDir, GRAPH_META_FILE_NAME));

  return { graphDir: finalGraphDir, entryPath: path.join(finalGraphDir, manifest.entry), manifest };
};

export const writeCachedGraphAtomic = (
  version: string,
  files: MaterializedGraphFile[],
  manifest: GraphManifest,
  binaryPath: string,
  preambleVersion: string,
): CachedGraph => {
  const binStat = fs.statSync(binaryPath);
  const meta: CacheMeta = {
    binarySize: binStat.size,
    binaryMtimeMs: binStat.mtimeMs,
    preambleVersion,
  };

  const primaryDir = getVersionCacheDir(version);
  let cached: CachedGraph;
  try {
    cached = writeGraphTo(primaryDir, files, manifest, meta);
  } catch (error) {
    const fallbackDir = path.join(os.tmpdir(), "ccc-claude-cli", version);
    const e = error as NodeJS.ErrnoException;
    log.warn(
      "NATIVE",
      `cache dir ${primaryDir} not writable (${e.code ?? "unknown"}); falling back to ${fallbackDir}`,
    );
    cached = writeGraphTo(fallbackDir, files, manifest, meta);
  }

  pruneOldVersions(version);
  return cached;
};

export const pruneOldVersions = (keepVersion: string) => {
  const root = getCacheRoot();
  if (!fs.existsSync(root)) return;

  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+/.test(e.name))
    .map((e) => e.name);

  const survivors = new Set<string>([keepVersion]);
  const others = entries
    .filter((v) => v !== keepVersion)
    .sort(compareSemverDesc)
    .slice(0, Math.max(0, MAX_CACHED_VERSIONS - 1));
  for (const v of others) survivors.add(v);

  for (const v of entries) {
    if (survivors.has(v)) continue;
    const dir = path.join(root, v);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs < GRAPH_PRUNE_GRACE_MS) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      log.info("NATIVE", `pruned old cache: ${v}`);
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      log.warn("NATIVE", `failed to prune ${dir}: ${e.code ?? e.message}`);
    }
  }
};
