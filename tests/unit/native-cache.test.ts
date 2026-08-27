import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  GRAPH_PRUNE_GRACE_MS,
  getVersionCacheDir,
  publishGraphDir,
  pruneOldVersions,
  readCachedGraph,
} from "@/native/cache";

const originalCacheHome = process.env.XDG_CACHE_HOME;
const tempDirs: string[] = [];

const useTempCacheHome = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-native-cache-test-"));
  tempDirs.push(dir);
  process.env.XDG_CACHE_HOME = dir;
  return dir;
};

afterEach(() => {
  if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalCacheHome;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const age = (dir: string, beyondGraceMs = 60_000) => {
  const aged = new Date(Date.now() - GRAPH_PRUNE_GRACE_MS - beyondGraceMs);
  fs.utimesSync(dir, aged, aged);
  return aged;
};

describe("pruneOldVersions", () => {
  test("prunes versions beyond the count cap only after their grace period", () => {
    const cacheHome = useTempCacheHome();
    const root = path.join(cacheHome, "ccc", "claude-cli");
    for (const version of ["1.0.1", "1.0.2", "1.0.3", "1.0.4", "1.0.5"]) {
      fs.mkdirSync(path.join(root, version), { recursive: true });
    }
    age(path.join(root, "1.0.1"));

    pruneOldVersions("1.0.5");

    // 1.0.5 (kept) + 1.0.4/1.0.3 (newest others); 1.0.2 is beyond the cap but young
    expect(fs.readdirSync(root).sort()).toEqual(["1.0.2", "1.0.3", "1.0.4", "1.0.5"]);
  });
});

describe("readCachedGraph", () => {
  test("a cache hit restarts the version dir's grace period", () => {
    useTempCacheHome();
    const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-native-cache-bin-"));
    tempDirs.push(binaryDir);
    const binaryPath = path.join(binaryDir, "claude");
    fs.writeFileSync(binaryPath, "binary-bytes");
    const binStat = fs.statSync(binaryPath);

    const versionDir = getVersionCacheDir("9.9.9");
    const graphDir = path.join(versionDir, "graph");
    fs.mkdirSync(path.join(graphDir, "root"), { recursive: true });
    fs.writeFileSync(path.join(graphDir, "root", "cli.mjs"), "export {};");
    fs.writeFileSync(
      path.join(graphDir, "__ccc_manifest.json"),
      JSON.stringify({ version: 1, entry: "root/cli.mjs", modules: ["root/cli.mjs"], substituted: ["root/cli.mjs"] }),
    );
    fs.writeFileSync(
      path.join(versionDir, "graph.meta.json"),
      JSON.stringify({ binarySize: binStat.size, binaryMtimeMs: binStat.mtimeMs, preambleVersion: "p1" }),
    );
    const aged = age(versionDir);

    expect(readCachedGraph("9.9.9", binaryPath, "p1")).not.toBeNull();

    expect(fs.statSync(versionDir).mtimeMs).toBeGreaterThan(aged.getTime() + 1000);
  });
});

describe("publishGraphDir", () => {
  test("publishes a staging dir over an existing graph and leaves no residue", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-native-cache-pub-"));
    tempDirs.push(base);
    const finalDir = path.join(base, "graph");
    const stagingDir = path.join(base, "graph.tmp-1");
    fs.mkdirSync(finalDir, { recursive: true });
    fs.writeFileSync(path.join(finalDir, "old.js"), "old");
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "new.js"), "new");

    publishGraphDir(stagingDir, finalDir);

    expect(fs.readdirSync(finalDir)).toEqual(["new.js"]);
    expect(fs.readdirSync(base)).toEqual(["graph"]);
  });

  test("publishes when no previous graph exists", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-native-cache-pub-"));
    tempDirs.push(base);
    const finalDir = path.join(base, "graph");
    const stagingDir = path.join(base, "graph.tmp-1");
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "new.js"), "new");

    publishGraphDir(stagingDir, finalDir);

    expect(fs.readdirSync(finalDir)).toEqual(["new.js"]);
    expect(fs.readdirSync(base)).toEqual(["graph"]);
  });
});
