import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const runnerDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(runnerDir, "..", "..");
const launcherPath = join(runnerDir, "launcher.ts");

const tsconfig = process.env.TSX_TSCONFIG_PATH || join(projectRoot, "tsconfig.json");

// both hooks, matching what the tsx CLI installs: the ESM loader alone leaves require() of a
// TypeScript ES module to node, which rejects it outright inside an import cycle
const { register } = require("tsx/esm/api");
const unregisterCjs = require("tsx/cjs/api").register();
const unregisterEsm = register({ tsconfig });

const unregister = async () => {
  await unregisterEsm();
  unregisterCjs();
};

// launcher.ts calls this right before importing the claude bundle
globalThis.__cccTsxUnregister = unregister;

process.argv = [process.argv[0], launcherPath, ...process.argv.slice(2)];

await import(pathToFileURL(launcherPath).href);
