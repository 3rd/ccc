import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createWorkflowBuildCache } from "@/config/builders/workflow-build-cache";
import type { CompiledWorkflow } from "@/config/builders/workflow-compiler";

const RESULT: CompiledWorkflow = { status: "compiled", name: "cached", content: "export const meta = {};\n" };
const EARLIER = new Date("2026-01-01T00:00:00Z");
const LATER = new Date("2026-01-02T00:00:00Z");

let tempDir: string;
let originalCacheHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ccc-workflow-cache-"));
  originalCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(tempDir, "cache");
});

afterEach(async () => {
  if (originalCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = originalCacheHome;
  }

  await rm(tempDir, { force: true, recursive: true });
});

const cacheBuildOf = async (content: string) => {
  const sourcePath = join(tempDir, "cached.ts");
  await writeFile(sourcePath, content);
  await utimes(sourcePath, EARLIER, EARLIER);

  const cache = createWorkflowBuildCache();
  const key = cache.keyFor({ source: content, sourcePath, canonicalName: undefined });
  cache.write({ key, result: RESULT, inputs: [sourcePath], sourcePath });

  return { cache, key, sourcePath };
};

test("reuses a cached build when an input is rewritten with the same content", async () => {
  const { cache, key, sourcePath } = await cacheBuildOf("export const value = 1;\n");

  await writeFile(sourcePath, "export const value = 1;\n");
  await utimes(sourcePath, LATER, LATER);

  expect(cache.read(key)).toEqual(RESULT);
});

test("rebuilds when an input changes without changing its size", async () => {
  const { cache, key, sourcePath } = await cacheBuildOf("export const value = 1;\n");

  await writeFile(sourcePath, "export const value = 2;\n");
  await utimes(sourcePath, LATER, LATER);

  expect(cache.read(key)).toBeUndefined();
});
