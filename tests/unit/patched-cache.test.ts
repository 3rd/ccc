import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BUILTIN_PATCHES_VERSION, patchSetDigest, type RuntimePatch } from "@/patches/cli-patches";
import {
  computePatchKey,
  dropPatchedEntry,
  patchCacheMode,
  readPatched,
  writePatchedAtomic,
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
  test("round-trips the patched bundle and both label lists", () => {
    useTempCacheHome();
    const key = "abc123";
    const entry = writePatchedAtomic(key, CLI_BYTES, ["applied-one"], ["missed-one"]);
    expect(entry.patchedPath).toBeTruthy();

    const read = readPatched(key);
    expect(read?.applied).toEqual(["applied-one"]);
    expect(read?.missed).toEqual(["missed-one"]);
    expect(fs.readFileSync(read!.patchedPath!, "utf8")).toBe(CLI_BYTES);
  });

  test("records a no-patch result without writing a bundle", () => {
    useTempCacheHome();
    writePatchedAtomic("nopatch", null, [], ["missed-everything"]);

    const read = readPatched("nopatch");
    expect(read).toEqual({ patchedPath: null, applied: [], missed: ["missed-everything"] });
  });

  test("misses on an absent, truncated, or foreign entry", () => {
    const cacheHome = useTempCacheHome();
    expect(readPatched("absent")).toBeNull();

    writePatchedAtomic("truncated", CLI_BYTES, ["a"], []);
    const entryDir = path.join(cacheHome, "ccc", "claude-cli-patched", "truncated");
    fs.writeFileSync(path.join(entryDir, "cli.mjs"), "too small");
    expect(readPatched("truncated")).toBeNull();

    fs.writeFileSync(path.join(entryDir, "meta.json"), JSON.stringify({ key: "someone-else" }));
    expect(readPatched("truncated")).toBeNull();

    fs.writeFileSync(path.join(entryDir, "meta.json"), "{not json");
    expect(readPatched("truncated")).toBeNull();
  });

  test("leaves no staging files behind and can drop an entry", () => {
    const cacheHome = useTempCacheHome();
    writePatchedAtomic("dropme", CLI_BYTES, [], []);
    const entryDir = path.join(cacheHome, "ccc", "claude-cli-patched", "dropme");
    expect(fs.readdirSync(entryDir).sort()).toEqual(["cli.mjs", "meta.json"]);

    dropPatchedEntry("dropme");
    expect(readPatched("dropme")).toBeNull();
  });

  test("prunes to the newest entries", () => {
    const cacheHome = useTempCacheHome();
    for (const key of ["k1", "k2", "k3", "k4", "k5", "k6"]) writePatchedAtomic(key, CLI_BYTES, [], []);

    const root = path.join(cacheHome, "ccc", "claude-cli-patched");
    expect(fs.readdirSync(root).length).toBeLessThanOrEqual(4);
    // the most recent write always survives
    expect(readPatched("k6")).not.toBeNull();
  });
});
