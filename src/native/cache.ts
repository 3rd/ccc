import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { log } from "@/utils/log";

const CACHE_SUBPATH = path.join("ccc", "claude-cli");
const CACHED_FILE_NAME = "cli.mjs";
const META_FILE_NAME = "cli.mjs.meta.json";

const MAX_CACHED_VERSIONS = 3;
const MIN_CACHED_FILE_SIZE = 1024 * 1024;

const xdgCacheHome = () => process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
export const getCacheRoot = () => path.join(xdgCacheHome(), CACHE_SUBPATH);
export const getVersionCacheDir = (version: string) => path.join(getCacheRoot(), version);
const cliFile = (version: string) => path.join(getVersionCacheDir(version), CACHED_FILE_NAME);
const metaFile = (version: string) => path.join(getVersionCacheDir(version), META_FILE_NAME);

interface CacheMeta {
  binarySize: number;
  binaryMtimeMs: number;
  /** hash of the preamble text used when wrapping; bumps auto-invalidate old caches */
  preambleVersion: string;
}

type SemverParts = [major: number, minor: number, patch: number];

const readMeta = (version: string): CacheMeta | null => {
  const p = metaFile(version);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "binarySize" in parsed &&
      "binaryMtimeMs" in parsed &&
      "preambleVersion" in parsed &&
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

const binaryStillMatches = (meta: CacheMeta, binaryPath: string) => {
  try {
    const st = fs.statSync(binaryPath);
    return st.size === meta.binarySize && st.mtimeMs === meta.binaryMtimeMs;
  } catch {
    return false;
  }
};

export const readCached = (version: string, binaryPath: string, currentPreambleVersion: string) => {
  const p = cliFile(version);
  if (!fs.existsSync(p)) return null;
  if (fs.statSync(p).size < MIN_CACHED_FILE_SIZE) return null;

  const meta = readMeta(version);
  if (!meta) {
    log.debug("NATIVE", `cache invalid: no metadata sidecar for ${version}`);
    return null;
  }
  if (meta.preambleVersion !== currentPreambleVersion) {
    log.info(
      "NATIVE",
      `cache invalid: preamble version changed (${meta.preambleVersion} → ${currentPreambleVersion})`,
    );
    return null;
  }
  if (!binaryStillMatches(meta, binaryPath)) {
    log.info("NATIVE", `cache invalid: binary changed since extraction (${version})`);
    return null;
  }
  return p;
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

const writeTo = (dir: string, content: string, meta: CacheMeta) => {
  fs.mkdirSync(dir, { recursive: true });

  const finalCli = path.join(dir, CACHED_FILE_NAME);
  const finalMeta = path.join(dir, META_FILE_NAME);
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpCli = path.join(dir, `${CACHED_FILE_NAME}.tmp-${suffix}`);
  const tmpMeta = path.join(dir, `${META_FILE_NAME}.tmp-${suffix}`);

  fs.writeFileSync(tmpCli, content);
  fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
  fs.renameSync(tmpCli, finalCli);
  fs.renameSync(tmpMeta, finalMeta);

  return finalCli;
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
      fs.rmSync(dir, { recursive: true, force: true });
      log.info("NATIVE", `pruned old cache: ${v}`);
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      log.warn("NATIVE", `failed to prune ${dir}: ${e.code ?? e.message}`);
    }
  }
};

export const writeCachedAtomic = (
  version: string,
  content: string,
  binaryPath: string,
  preambleVersion: string,
) => {
  const binStat = fs.statSync(binaryPath);
  const meta: CacheMeta = {
    binarySize: binStat.size,
    binaryMtimeMs: binStat.mtimeMs,
    preambleVersion,
  };

  const primaryDir = getVersionCacheDir(version);
  let cliPath: string;
  try {
    cliPath = writeTo(primaryDir, content, meta);
  } catch (error) {
    const fallbackDir = path.join(os.tmpdir(), "ccc-claude-cli", version);
    const e = error as NodeJS.ErrnoException;
    log.warn(
      "NATIVE",
      `cache dir ${primaryDir} not writable (${e.code ?? "unknown"}); falling back to ${fallbackDir}`,
    );
    cliPath = writeTo(fallbackDir, content, meta);
  }

  pruneOldVersions(version);
  return cliPath;
};
