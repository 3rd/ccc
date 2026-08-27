import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GRAPH_PRUNE_GRACE_MS } from "@/native/cache";
import { BUILTIN_PATCHES_VERSION, patchSetDigest, type RuntimePatch } from "@/patches/cli-patches";
import {
  computePatchKey,
  dropPatchedEntry,
  patchCacheMode,
  readPatched,
  writePatchedGraphAtomic,
} from "@/patches/patched-cache";

const CLI_BYTES = "x".repeat(2 * 1024 * 1024);

const originalCacheHome = process.env.XDG_CACHE_HOME;
const tempDirs: string[] = [];

const useTempCacheHome = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-patch-cache-test-"));
  tempDirs.push(dir);
  process.env.XDG_CACHE_HOME = dir;
  return dir;
};

const writeCli = (contents = CLI_BYTES) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-patch-cli-"));
  tempDirs.push(dir);
  const cliPath = path.join(dir, "cli.mjs");
  fs.writeFileSync(cliPath, contents);
  return cliPath;
};

const keyInput = (extractedCliPath: string, patches: RuntimePatch[] = []) => ({
  extractedCliPath,
  preambleVersion: "preamble-1",
  patches,
});

// a materialized graph is a `graph/` dir of module files plus the manifest the
// patch cache copies from
const writeSourceGraph = (moduleContents = CLI_BYTES) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-patch-graph-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, "root"), { recursive: true });
  fs.writeFileSync(path.join(dir, "root", "cli.mjs"), moduleContents);
  fs.writeFileSync(
    path.join(dir, "__ccc_manifest.json"),
    JSON.stringify({ version: 1, entry: "root/cli.mjs", modules: ["root/cli.mjs"], substituted: ["root/cli.mjs"] }),
  );
  return dir;
};

const patchOf = (contents: string) => new Map([["root/cli.mjs", contents]]);

afterEach(() => {
  if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalCacheHome;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("patchCacheMode", () => {
  test("defaults to use and honours the off and verify overrides", () => {
    expect(patchCacheMode({})).toBe("use");
    expect(patchCacheMode({ CCC_PATCH_CACHE: "1" })).toBe("use");
    expect(patchCacheMode({ CCC_PATCH_CACHE: "0" })).toBe("off");
    expect(patchCacheMode({ CCC_PATCH_CACHE: "off" })).toBe("off");
    expect(patchCacheMode({ CCC_PATCH_CACHE: "verify" })).toBe("verify");
  });
});

describe("computePatchKey", () => {
  test("is stable for identical inputs", () => {
    const cliPath = writeCli();
    expect(computePatchKey(keyInput(cliPath))).toBe(computePatchKey(keyInput(cliPath)));
  });

  test("moves when the extracted bundle changes", () => {
    const cliPath = writeCli();
    const before = computePatchKey(keyInput(cliPath));
    fs.writeFileSync(cliPath, `${CLI_BYTES}extra`);
    expect(computePatchKey(keyInput(cliPath))).not.toBe(before);
  });

  test("moves for the preamble and salt", () => {
    const cliPath = writeCli();
    const base = computePatchKey(keyInput(cliPath));
    expect(computePatchKey({ ...keyInput(cliPath), preambleVersion: "preamble-2" })).not.toBe(base);
    expect(computePatchKey({ ...keyInput(cliPath), salt: "abc" })).not.toBe(base);
  });

  test("moves for string patches, function bodies, order, and declared key material", () => {
    const cliPath = writeCli();
    const base = computePatchKey(keyInput(cliPath, [{ find: "a", replace: "b" }]));

    expect(computePatchKey(keyInput(cliPath, [{ find: "a", replace: "c" }]))).not.toBe(base);
    expect(
      computePatchKey(
        keyInput(cliPath, [
          { find: "a", replace: "b" },
          { find: "c", replace: "d" },
        ]),
      ),
    ).not.toBe(base);

    const withFn = computePatchKey(
      keyInput(cliPath, [{ name: "p", fn: (cli: string) => cli.replace("x", "y") }]),
    );
    const otherFn = computePatchKey(
      keyInput(cliPath, [{ name: "p", fn: (cli: string) => cli.replace("x", "z") }]),
    );
    expect(otherFn).not.toBe(withFn);

    // a factory that closes over config declares it, since fn.toString() cannot show it
    const fn = (cli: string) => cli;
    expect(computePatchKey(keyInput(cliPath, [{ name: "p", fn, keyMaterial: "one" }]))).not.toBe(
      computePatchKey(keyInput(cliPath, [{ name: "p", fn, keyMaterial: "two" }])),
    );
  });

  test("patch order matters", () => {
    const cliPath = writeCli();
    const first: RuntimePatch[] = [
      { find: "a", replace: "b" },
      { find: "c", replace: "d" },
    ];
    const second: RuntimePatch[] = [first[1]!, first[0]!];
    expect(computePatchKey(keyInput(cliPath, first))).not.toBe(computePatchKey(keyInput(cliPath, second)));
  });
});

describe("BUILTIN_PATCHES_VERSION", () => {
  test("is a digest that moves with the built-in patch list", () => {
    expect(BUILTIN_PATCHES_VERSION).toMatch(/^[0-9a-f]{16}$/);
    expect(patchSetDigest([])).not.toBe(BUILTIN_PATCHES_VERSION);
  });
});

describe("patched cache entries", () => {
  test("round-trips the patched graph and both label lists", () => {
    useTempCacheHome();
    const source = writeSourceGraph();
    const entry = writePatchedGraphAtomic("abc123", source, patchOf("patched-module"), ["applied-one"], ["missed-one"]);
    expect(entry.patchedPath).toBeTruthy();

    const read = readPatched("abc123");
    expect(read?.applied).toEqual(["applied-one"]);
    expect(read?.missed).toEqual(["missed-one"]);
    expect(fs.readFileSync(read!.patchedPath!, "utf8")).toBe("patched-module");
  });

  test("records a no-patch result without copying the graph", () => {
    useTempCacheHome();
    writePatchedGraphAtomic("nopatch", writeSourceGraph(), null, [], ["missed-everything"]);

    const read = readPatched("nopatch");
    expect(read).toEqual({ patchedPath: null, applied: [], missed: ["missed-everything"] });
  });

  test("misses on an absent, incomplete, or foreign entry", () => {
    const cacheHome = useTempCacheHome();
    expect(readPatched("absent")).toBeNull();

    writePatchedGraphAtomic("broken", writeSourceGraph(), patchOf("patched-module"), ["a"], []);
    const entryDir = path.join(cacheHome, "ccc", "claude-cli-patched", "broken");
    fs.rmSync(path.join(entryDir, "graph", "root", "cli.mjs"));
    expect(readPatched("broken")).toBeNull();

    fs.writeFileSync(path.join(entryDir, "meta.json"), JSON.stringify({ key: "someone-else" }));
    expect(readPatched("broken")).toBeNull();

    fs.writeFileSync(path.join(entryDir, "meta.json"), "{not json");
    expect(readPatched("broken")).toBeNull();
  });

  test("leaves no staging files behind and can drop an entry", () => {
    const cacheHome = useTempCacheHome();
    writePatchedGraphAtomic("dropme", writeSourceGraph(), patchOf("patched-module"), [], []);
    const entryDir = path.join(cacheHome, "ccc", "claude-cli-patched", "dropme");
    expect(fs.readdirSync(entryDir).sort()).toEqual(["graph", "meta.json"]);

    dropPatchedEntry("dropme");
    expect(readPatched("dropme")).toBeNull();
  });

  test("prunes entries beyond the count cap once their grace period has passed", () => {
    const cacheHome = useTempCacheHome();
    const source = writeSourceGraph();
    const root = path.join(cacheHome, "ccc", "claude-cli-patched");
    for (const key of ["k1", "k2", "k3", "k4", "k5", "k6"]) {
      writePatchedGraphAtomic(key, source, patchOf(`patched-${key}`), [], []);
    }
    for (const [index, key] of ["k1", "k2", "k3", "k4", "k5"].entries()) {
      const aged = new Date(Date.now() - GRAPH_PRUNE_GRACE_MS - (5 - index) * 60_000);
      fs.utimesSync(path.join(root, key), aged, aged);
    }

    writePatchedGraphAtomic("k7", source, patchOf("patched-k7"), [], []);

    expect(fs.readdirSync(root).length).toBeLessThanOrEqual(4);
    // the most recent write always survives, and the oldest aged entry goes first
    expect(readPatched("k7")).not.toBeNull();
    expect(fs.existsSync(path.join(root, "k1"))).toBe(false);
  });

  test("keeps entries beyond the count cap while their grace period lasts", () => {
    const cacheHome = useTempCacheHome();
    const source = writeSourceGraph();
    for (const key of ["k1", "k2", "k3", "k4", "k5", "k6"]) {
      writePatchedGraphAtomic(key, source, patchOf(`patched-${key}`), [], []);
    }

    // a session launched from any of these may still lazily import its graph
    const root = path.join(cacheHome, "ccc", "claude-cli-patched");
    expect(fs.readdirSync(root).sort()).toEqual(["k1", "k2", "k3", "k4", "k5", "k6"]);
  });

  test("a cache hit restarts the entry's grace period", () => {
    const cacheHome = useTempCacheHome();
    writePatchedGraphAtomic("hit", writeSourceGraph(), patchOf("patched-hit"), [], []);
    const entryDir = path.join(cacheHome, "ccc", "claude-cli-patched", "hit");
    const aged = new Date(Date.now() - GRAPH_PRUNE_GRACE_MS - 60_000);
    fs.utimesSync(entryDir, aged, aged);

    expect(readPatched("hit")).not.toBeNull();

    expect(fs.statSync(entryDir).mtimeMs).toBeGreaterThan(aged.getTime() + 1000);
  });
});
