// runtime patches for claude cli

import { createHash } from "crypto";

export type PatchFn = (content: string) => string;

// keyMaterial declares anything a patch bakes into its output that fn.toString() cannot show —
// typically a preamble a factory precomputed from config before creating fn. Patch caching keys
// on the function source, so a closed-over value not declared here would go unnoticed.
export type RuntimePatch =
  | { find: string; replace: string }
  | { fn: PatchFn; name: string; keyMaterial?: string };

const GROWTHBOOK_OVERRIDE_METHODS = [
  { head: "getEnvironmentOverrides(){", nativeName: "__cccNativeEnvironmentOverrides" },
  { head: "getAllFeatures(){", nativeName: "__cccNativeAllFeatures" },
];
const GROWTHBOOK_SOURCE_READER_RE = /getFeatureValueWithSource\(([\w$]+),[\w$]+\)\{/g;

const logFeatureFlagOverride = (key: string, value: string) =>
  `if(process.env.CCC_DEBUG_FEATURE_FLAGS)console.error("[ccc] featureFlag "+String(${key})+" -> "+JSON.stringify(${value}));`;

const growthbookSyncFlagOverride: RuntimePatch = {
  name: "growthbook-sync-flag-override",
  keyMaterial: [
    JSON.stringify(GROWTHBOOK_OVERRIDE_METHODS),
    GROWTHBOOK_SOURCE_READER_RE.toString(),
    logFeatureFlagOverride.toString(),
  ].join("\0"),
  fn: (content) => {
    if (content.includes("__cccFeatureFlags")) return content;

    const hasUniqueMethods =
      [...content.matchAll(GROWTHBOOK_SOURCE_READER_RE)].length === 1 &&
      GROWTHBOOK_OVERRIDE_METHODS.every(({ head }) => content.split(head).length === 2);
    if (!hasUniqueMethods) return content;

    let patched = content.replace(
      GROWTHBOOK_SOURCE_READER_RE,
      (match, key) =>
        `${match}let __cccFF=globalThis.__cccFeatureFlags;` +
        `if(__cccFF&&Object.prototype.hasOwnProperty.call(__cccFF,${key})){${logFeatureFlagOverride(key, `__cccFF[${key}]`)}` +
        `return{value:__cccFF[${key}],source:"payload"}}`,
    );

    for (const { head, nativeName } of GROWTHBOOK_OVERRIDE_METHODS) {
      patched = patched.replace(
        head,
        () =>
          `${head}let __cccFF=globalThis.__cccFeatureFlags,__cccNative=this.${nativeName}();if(!__cccFF)return __cccNative;` +
          `let __cccMerged={...__cccNative,...__cccFF};` +
          `return process.env.CCC_DEBUG_FEATURE_FLAGS?new Proxy(__cccMerged,{get:(target,key)=>{` +
          `if(Object.prototype.hasOwnProperty.call(__cccFF,key)){${logFeatureFlagOverride("key", "target[key]")}}` +
          `return target[key]}}):__cccMerged}${nativeName}(){`,
      );
    }

    return patched;
  },
};

// neuter the snippet builder that shadows the user's `find` and `grep` shell
// commands with functions that re-exec the claude binary as `bfs` / `ugrep`
// via ARGV0. that argv[0] dispatch only resolves to the embedded multi-tool
// when claude is the native binary; CCC extracts the JS and runs it via node,
// so the re-exec lands on the CCC wrapper (or the system `ugrep`) and the
// bundled flags `-G --ignore-files --hidden -I --exclude-dir=…` get rejected
// as unknown options in every Bash-tool subshell.
//
// the snapshot generator skips the entire shadow block when the snippet
// builder returns null (`if(A!==null) _+=...`), so we just rewrite the
// builder's body. anchors are the hardcoded literals `unalias find 2>/dev/null
// || true` / `unalias grep 2>/dev/null || true` — these strings are baked into
// the function body and don't rotate per build.
const disableFindGrepShadow: RuntimePatch = {
  name: "disable-find-grep-shadow",
  fn: (content) => {
    const re =
      /function ([\w$]+)\(\){if\(![\w$]+\(\)\)return null;return\["unalias find 2>\/dev\/null \|\| true","unalias grep 2>\/dev\/null \|\| true"/;
    return content.replace(
      re,
      (_match, fn) =>
        `function ${fn}(){return null;}function ${fn}_cccUnused(){return["unalias find 2>/dev/null || true","unalias grep 2>/dev/null || true"`,
    );
  },
};

const builtinPluginHooksInMemory: RuntimePatch = {
  name: "builtin-plugin-hooks-in-memory",
  fn: (content) => {
    const re =
      /=\(([\w$]+),([\w$]+),([\w$]+)\)=>[\w$]+\(\)\?([\w$]+)\(\2,\3\(\),\1\):\{module:\2,folder:\1\}/;
    return content.replace(
      re,
      (_match, folder, hooksModule, scan, inMemory) =>
        `=(${folder},${hooksModule},${scan})=>${inMemory}(${hooksModule},${scan}(),${folder})`,
    );
  },
};

const devModsAfterHostBind: RuntimePatch = {
  name: "dev-mods-after-host-bind",
  fn: (content) => {
    const re =
      /(requireHost\(\)\{if\(this\.host===null\)throw Error\("ReplSessionScope: used before its screen bound a host"\);return this\.host\}connect\(\)\{if\(this\.connected\|\|this\.disposed\)return;if\(this\.connected=!0,[\w$]+\(this\.sessionBinding\),[\w$]+\.set\(this\.sessionPlugins\),)([\w$]+)\(\),/;
    return content.replace(
      re,
      (_match, prefix, restore) =>
        `${prefix}queueMicrotask(()=>{if(this.connected&&!this.disposed)${restore}()}),`,
    );
  },
};

// built-in string replacements
const builtInStringPatches: RuntimePatch[] = [
  // disable unwanted features
  { find: "security-review", replace: "zsecurityreview" },

  growthbookSyncFlagOverride,
  disableFindGrepShadow,
  builtinPluginHooksInMemory,
  devModsAfterHostBind,
];

const labelFor = (patch: RuntimePatch) =>
  "fn" in patch ? patch.name : `"${patch.find}" => "${patch.replace}"`;

// identity of one patch's behaviour, for cache keys: the literal replacement, or the function's
// source plus whatever it declares as closed-over material
export const patchDescriptor = (patch: RuntimePatch) =>
  "fn" in patch
    ? `f\0${patch.name}\0${patch.fn.toString()}\0${patch.keyMaterial ?? ""}`
    : `s\0${patch.find}\0${patch.replace}`;

export const patchSetDigest = (patches: readonly RuntimePatch[]) => {
  const hash = createHash("sha256");
  for (const patch of patches) hash.update(patchDescriptor(patch)).update("\0\0");
  return hash.digest("hex").slice(0, 16);
};

// moves whenever the built-in patch list changes, so cached output cannot outlive it
export const BUILTIN_PATCHES_VERSION = patchSetDigest(builtInStringPatches);

const applyOne = (content: string, patch: RuntimePatch) => {
  const result = "fn" in patch ? patch.fn(content) : content.replaceAll(patch.find, patch.replace);
  return { content: result, matched: result !== content };
};

const applyAll = (content: string, patches: RuntimePatch[]) => {
  const applied: string[] = [];
  const missed: string[] = [];
  let result = content;
  for (const patch of patches) {
    const { content: next, matched } = applyOne(result, patch);
    result = next;
    (matched ? applied : missed).push(labelFor(patch));
  }
  return { content: result, applied, missed };
};

// apply all built-in patches to CLI content
export const applyBuiltInPatches = (content: string) => applyAll(content, builtInStringPatches);

// apply user-defined patches
export const applyUserPatches = (content: string, patches: RuntimePatch[]) => applyAll(content, patches);
