import * as path from "path";
import { fileURLToPath } from "url";
import { compileCachedCSource } from "../utils/compile-c-source";
import { log } from "../utils/log";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUN_ANT_SOURCE = path.join(__dirname, "bun-ant.c");
const CACHE_DIRECTORY = path.resolve(__dirname, "..", "..", ".cache", "native");
const COMPILE_FLAGS = ["-shared", "-fPIC", "-O2", "-Wall", "-Werror"];

export const BUN_ANT_ADDON_ENV = "CCC_BUN_ANT_ADDON";

export const applyBunAntAddonEnv = (env: NodeJS.ProcessEnv = process.env) => {
  if (process.platform !== "linux") return;

  let addonPath: string;

  try {
    addonPath = compileCachedCSource({
      sourcePath: BUN_ANT_SOURCE,
      flags: COMPILE_FLAGS,
      cacheDirectory: CACHE_DIRECTORY,
      outputPrefix: "bun-ant",
      outputExtension: ".node",
    });
  } catch (error) {
    log.warn("NATIVE", `Bun.ant add-on build failed: ${error instanceof Error ? error.message : error}`);
    return;
  }

  env[BUN_ANT_ADDON_ENV] = addonPath;
  return addonPath;
};
