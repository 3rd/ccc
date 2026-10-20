import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { version as esbuildVersion } from "esbuild";
import { log } from "@/utils/log";
import type { CompiledWorkflow } from "./workflow-compiler";

const CACHE_SUBPATH = join("ccc", "workflow-builds");
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RESOLUTION_CONFIG_FILES = ["package.json", "tsconfig.json", "jsconfig.json"];
const OUTPUT_DECIDING_SOURCES = [
  fileURLToPath(new URL("./workflow-compiler.ts", import.meta.url)),
  fileURLToPath(new URL("../workflow-schema.ts", import.meta.url)),
  fileURLToPath(new URL("../../types/workflows.ts", import.meta.url)),
];

type InputStamp = { path: string; size: number; mtimeMs: number };
type CacheEntry = { inputs: InputStamp[]; result: CompiledWorkflow };

export type WorkflowCacheKeyParts = {
  source: string;
  sourcePath: string;
  canonicalName: string | undefined;
};

export type WorkflowCacheWrite = {
  key: string;
  result: CompiledWorkflow;
  inputs: Iterable<string>;
  sourcePath: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInputStamp = (value: unknown): value is InputStamp =>
  isRecord(value) && typeof value.path === "string" && typeof value.size === "number" && typeof value.mtimeMs === "number";

const isCompiledWorkflow = (value: unknown): value is CompiledWorkflow => {
  if (!isRecord(value)) return false;
  if (value.status === "invalid") return typeof value.message === "string";
  if (value.status === "disabled") return true;
  if (value.status === "unsafe-name") return typeof value.name === "string";

  return value.status === "compiled" && typeof value.name === "string" && typeof value.content === "string";
};

const isCacheEntry = (value: unknown): value is CacheEntry =>
  isRecord(value) && Array.isArray(value.inputs) && value.inputs.every(isInputStamp) && isCompiledWorkflow(value.result);

const stampInput = (path: string) => {
  try {
    const stats = statSync(path);

    return { path, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
};

const isStampCurrent = (stamp: InputStamp) => {
  const current = stampInput(stamp.path);

  return current?.size === stamp.size && current.mtimeMs === stamp.mtimeMs;
};

const listResolutionConfigFilesAbove = (sourcePath: string) => {
  const files: string[] = [];
  let directory = dirname(sourcePath);

  while (true) {
    for (const name of RESOLUTION_CONFIG_FILES) {
      const candidate = join(directory, name);
      if (!existsSync(candidate)) continue;

      files.push(candidate);
    }

    const parent = dirname(directory);
    if (parent === directory) return files;

    directory = parent;
  }
};

const readCompilerIdentity = () => {
  const hash = createHash("sha256").update(esbuildVersion).update("\0");
  const typescriptManifest = createRequire(import.meta.url).resolve("typescript/package.json");

  for (const path of [typescriptManifest, ...OUTPUT_DECIDING_SOURCES]) {
    hash.update(readFileSync(path)).update("\0");
  }

  return hash.digest("hex");
};

const resolveCacheDirectory = () =>
  join(process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache"), CACHE_SUBPATH);

const readEntry = (cacheDirectory: string, key: string) => {
  try {
    const entry: unknown = JSON.parse(readFileSync(join(cacheDirectory, `${key}.json`), "utf8"));

    return entry;
  } catch {
    return undefined;
  }
};

const pruneExpiredEntries = (cacheDirectory: string, now: number) => {
  for (const name of readdirSync(cacheDirectory)) {
    const entryPath = join(cacheDirectory, name);
    const stamp = stampInput(entryPath);
    const isExpired = stamp !== undefined && now - stamp.mtimeMs > CACHE_RETENTION_MS;
    if (!isExpired) continue;

    rmSync(entryPath, { force: true });
  }
};

export const createWorkflowBuildCache = () => {
  const compilerIdentity = readCompilerIdentity();
  const cacheDirectory = resolveCacheDirectory();
  let hasPrunedExpiredEntries = false;

  const keyFor = ({ source, sourcePath, canonicalName }: WorkflowCacheKeyParts) =>
    createHash("sha256")
      .update(compilerIdentity)
      .update("\0")
      .update(process.cwd())
      .update("\0")
      .update(sourcePath)
      .update("\0")
      .update(canonicalName ?? "")
      .update("\0")
      .update(source)
      .digest("hex");

  const read = (key: string) => {
    const entry = readEntry(cacheDirectory, key);
    const isReusable = isCacheEntry(entry) && entry.inputs.every(isStampCurrent);

    return isReusable ? entry.result : undefined;
  };

  const write = ({ key, result, inputs, sourcePath }: WorkflowCacheWrite) => {
    const stamps: InputStamp[] = [];

    for (const inputPath of [...inputs, ...listResolutionConfigFilesAbove(sourcePath)]) {
      const stamp = stampInput(inputPath);
      if (!stamp) return;

      stamps.push(stamp);
    }

    const entryPath = join(cacheDirectory, `${key}.json`);
    const temporaryPath = `${entryPath}.${process.pid}.tmp`;

    try {
      mkdirSync(cacheDirectory, { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify({ inputs: stamps, result } satisfies CacheEntry));
      renameSync(temporaryPath, entryPath);

      if (!hasPrunedExpiredEntries) {
        hasPrunedExpiredEntries = true;
        pruneExpiredEntries(cacheDirectory, Date.now());
      }
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      log.debug("WORKFLOWS", `Could not cache the workflow build for ${sourcePath}: ${error instanceof Error ? error.message : error}`);
    }
  };

  return { keyFor, read, write };
};

export type WorkflowBuildCache = ReturnType<typeof createWorkflowBuildCache>;
