import { homedir } from "node:os";
import { join } from "node:path";

/** The root of every launcher cache: `$XDG_CACHE_HOME/ccc`, or `~/.cache/ccc` when that is unset or blank. */
export const resolveCccCacheRoot = (env: NodeJS.ProcessEnv = process.env) => {
  return join(env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache"), "ccc");
};
