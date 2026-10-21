import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "fs";
import { createHash } from "node:crypto";
import * as path from "path";

type CachedCSourceBuild = {
  sourcePath: string;
  flags: string[];
  cacheDirectory: string;
  outputPrefix: string;
  outputExtension?: string;
};

export const compileCachedCSource = ({
  sourcePath,
  flags,
  cacheDirectory,
  outputPrefix,
  outputExtension = "",
}: CachedCSourceBuild) => {
  const compiler = process.env.CC ?? "cc";
  const source = readFileSync(sourcePath);
  const hash = createHash("sha256")
    .update(flags.join("\0"))
    .update("\0")
    .update(compiler)
    .update("\0")
    .update(source)
    .digest("hex");
  const cachePath = path.join(cacheDirectory, `${outputPrefix}-${hash.slice(0, 32)}${outputExtension}`);
  if (existsSync(cachePath)) return cachePath;

  mkdirSync(cacheDirectory, { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;

  try {
    execFileSync(compiler, [...flags, "-o", tempPath, sourcePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    renameSync(tempPath, cachePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }

  return cachePath;
};
