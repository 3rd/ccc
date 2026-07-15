import { createHash } from "crypto";
import * as fs from "fs";
import { createRequire } from "node:module";
import * as path from "path";
import { log } from "@/utils/log";
import { readCached, writeCachedAtomic } from "./cache";
import { resolveNativeBinary, type NativeInfo } from "./detect";
import { extractEmbeddedJs } from "./extract";
import { PREAMBLE_VERSION, wrapForNode } from "./preamble";

export interface ResolvedCli {
  extractedCliPath: string;
  modulePackageJsonPath: string;
}

const WRAPPER_PACKAGE_NAME = "@anthropic-ai/claude-code";

const findOwningPackage = (binaryPath: string) => {
  let dir = path.dirname(binaryPath);
  while (true) {
    const packageJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (typeof parsed !== "object" || parsed === null || !("name" in parsed)) return null;
      return typeof parsed.name === "string" ? { dir, name: parsed.name } : null;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const findWrapperDir = (binaryPath: string) => {
  const req = createRequire(binaryPath);
  try {
    return path.dirname(req.resolve(`${WRAPPER_PACKAGE_NAME}/package.json`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
};

const readWrapperVersion = (wrapperDir: string) => {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(wrapperDir, "package.json"), "utf8"));
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    if (typeof parsed.version === "string") return parsed.version;
  }
  return "unknown";
};

const extractCli = (info: NativeInfo): ResolvedCli => {
  const modulePackageJsonPath = path.join(info.wrapperDir, "package.json");
  const cached = readCached(info.version, info.binaryPath, PREAMBLE_VERSION);
  if (cached) {
    log.info("NATIVE", `using cached cli.js for ${info.version}: ${cached}`);
    return { extractedCliPath: cached, modulePackageJsonPath };
  }

  log.info("NATIVE", `extracting cli.js from ${info.binaryPath} (${info.platformPkg})`);

  const segment = extractEmbeddedJs(info.binaryPath);
  log.debug(
    "NATIVE",
    `extracted segment offset=${segment.offset} length=${segment.length} sha256=${segment.sha256}`,
  );

  const wrapped = wrapForNode(segment.content);
  const cachedPath = writeCachedAtomic(info.version, wrapped, info.binaryPath, PREAMBLE_VERSION);
  log.info("NATIVE", `cached extracted cli.js at ${cachedPath}`);

  return { extractedCliPath: cachedPath, modulePackageJsonPath };
};

export const resolveCliForLaunch = (wrapperDir: string): ResolvedCli => {
  const info = resolveNativeBinary(wrapperDir);
  return extractCli(info);
};

export const resolveCliFromExecutable = (
  executablePath: string,
  fallbackModuleRoot?: string,
): ResolvedCli => {
  const binaryPath = fs.realpathSync(executablePath);
  const owningPackage = findOwningPackage(binaryPath);
  if (owningPackage?.name === WRAPPER_PACKAGE_NAME) {
    return resolveCliForLaunch(owningPackage.dir);
  }

  const wrapperDir = findWrapperDir(binaryPath);
  if (wrapperDir) {
    return extractCli({
      version: readWrapperVersion(wrapperDir),
      platformPkg: "executable",
      binaryPath,
      wrapperDir,
    });
  }

  if (!fallbackModuleRoot) {
    throw new Error(
      `native-resolve: could not locate ${WRAPPER_PACKAGE_NAME} for executable ${executablePath}`,
    );
  }

  const pathHash = createHash("sha256").update(binaryPath).digest("hex").slice(0, 16);
  return extractCli({
    version: `0.0.0-standalone-${pathHash}`,
    platformPkg: "standalone",
    binaryPath,
    wrapperDir: fallbackModuleRoot,
  });
};
