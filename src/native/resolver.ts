import { createHash } from "crypto";
import * as fs from "fs";
import { createRequire } from "node:module";
import * as path from "path";
import { log } from "@/utils/log";
import { readCachedGraph, writeCachedGraphAtomic } from "./cache";
import { resolveNativeBinary, type NativeInfo } from "./detect";
import { materializeGraph } from "./graph-materialize";
import { parseModuleGraph } from "./module-graph";
import { PREAMBLE_VERSION } from "./preamble";

export interface ResolvedCli {
  /** the materialized entry module inside graphDir */
  extractedCliPath: string;
  modulePackageJsonPath: string;
  graphDir: string;
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

  const cachedGraph = readCachedGraph(info.version, info.binaryPath, PREAMBLE_VERSION);
  if (cachedGraph) {
    log.info("NATIVE", `using cached module graph for ${info.version}: ${cachedGraph.graphDir}`);
    return {
      extractedCliPath: cachedGraph.entryPath,
      modulePackageJsonPath,
      graphDir: cachedGraph.graphDir,
    };
  }

  log.info("NATIVE", `extracting cli from ${info.binaryPath} (${info.platformPkg})`);
  const graph = parseModuleGraph(fs.readFileSync(info.binaryPath));
  if (!graph) {
    throw new Error(
      `native-resolve: no bun module graph in ${info.binaryPath}. ` +
        "The binary predates claude-code 2.1.242 or its embedding format changed; " +
        "see NATIVE_GRAPH_* in src/native/constants.ts.",
    );
  }

  const { files, manifest } = materializeGraph(graph);
  log.debug(
    "NATIVE",
    `extracted module graph: ${manifest.modules.length} modules, ${files.length} files, entry ${manifest.entry}`,
  );
  const written = writeCachedGraphAtomic(info.version, files, manifest, info.binaryPath, PREAMBLE_VERSION);
  log.info("NATIVE", `cached module graph at ${written.graphDir}`);
  return {
    extractedCliPath: written.entryPath,
    modulePackageJsonPath,
    graphDir: written.graphDir,
  };
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
