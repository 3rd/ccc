import * as fs from "fs";
import { createRequire } from "module";
import * as path from "path";
import { NATIVE_PKG_PREFIX } from "./constants";

export interface NativeInfo {
  version: string;
  platformPkg: string;
  binaryPath: string;
  wrapperDir: string;
}

interface WrapperPkg {
  version?: string;
  optionalDependencies?: Record<string, string>;
}

const BINARY_CANDIDATES = ["claude", "claude.exe"];

const findInstalledBinary = (wrapperDir: string, pkg: WrapperPkg) => {
  const req = createRequire(path.join(wrapperDir, "package.json"));
  const platformPkgs = Object.keys(pkg.optionalDependencies ?? {}).filter((n) =>
    n.startsWith(NATIVE_PKG_PREFIX),
  );

  for (const platformPkg of platformPkgs) {
    let pkgDir: string;
    try {
      pkgDir = path.dirname(req.resolve(`${platformPkg}/package.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error;
      continue;
    }
    for (const binName of BINARY_CANDIDATES) {
      const binaryPath = path.join(pkgDir, binName);
      if (fs.existsSync(binaryPath)) return { platformPkg, binaryPath };
    }
  }
  return null;
};

export const resolveNativeBinary = (wrapperDir: string): NativeInfo => {
  const pkgJsonPath = path.join(wrapperDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`native-detect: package.json not found under ${wrapperDir}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as WrapperPkg;
  const version = pkg.version ?? "unknown";
  const found = findInstalledBinary(wrapperDir, pkg);
  if (!found) {
    throw new Error(
      `native-detect: no installed native binary found under ${wrapperDir}'s optional deps. ` +
        "This usually means postinstall was skipped (--ignore-scripts / --omit=optional). " +
        `Try: node ${path.join(wrapperDir, "install.cjs")}`,
    );
  }

  return {
    version,
    platformPkg: found.platformPkg,
    binaryPath: found.binaryPath,
    wrapperDir,
  };
};
