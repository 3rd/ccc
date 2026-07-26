// runtime patches for claude cli

import { createHash } from "crypto";

export type PatchFn = (content: string) => string;

// keyMaterial declares anything a patch bakes into its output that fn.toString() cannot show —
// typically a preamble a factory precomputed from config before creating fn. Patch caching keys
// on the function source, so a closed-over value not declared here would go unnoticed.
export type RuntimePatch =
  | { find: string; replace: string }
  | { fn: PatchFn; name: string; keyMaterial?: string };

// short-circuit the growthbook flag readers so featureFlags set via
// globalThis.__cccFeatureFlags always win. injection must happen at each
// reader's entry: the readers have settings-layer pre-checks that
// short-circuit before reaching the in-memory cache, so any layer carrying the
// flag would otherwise win against __cccFF.
//
// minified identifiers rotate every build; two bundle generations are handled:
//   - 2.1.203+: a source-aware sync reader whose body starts with
//     `let X=Y();if(X&&FLAG in X)return{value:X[FLAG],source:"override"};`,
//     plus two async boolean readers with the prologue
//     `let X=Y();if(X&&FLAG in X)return Boolean(X[FLAG]);` that read the cache
//     directly (they no longer delegate to the sync reader).
//   - <=2.1.202 (reachable via CLAUDE_PATH): a single raw-value sync reader
//     starting with `let X=Y();if(X&&FLAG in X)return X[FLAG];`; async
//     wrappers only delegate, so one injection suffices.
// every anchor also requires the `cachedGrowthBookFeatures` literal within
// ~800 chars — it only appears in reader bodies, never in delegating wrappers.
const growthbookSyncFlagOverride: RuntimePatch = {
  name: "growthbook-sync-flag-override",
  fn: (content) => {
    if (content.includes("__cccFeatureFlags")) return content;

    // opens an `if(...){` block; each caller closes it with its return statement
    const guard = (flag: string) =>
      `let __cccFF=globalThis.__cccFeatureFlags;` +
      `if(__cccFF&&Object.prototype.hasOwnProperty.call(__cccFF,${flag})){` +
      `if(process.env.CCC_DEBUG_FEATURE_FLAGS)console.error("[ccc] featureFlag "+${flag}+" -> "+JSON.stringify(__cccFF[${flag}]));`;

    const sourceAwareSyncRe =
      /function ([\w$]+)\(([\w$]+),([\w$]+)\){(?=let [\w$]+=[\w$]+\(\);if\([\w$]+&&\2 in [\w$]+\)return\{value:[\w$]+\[\2\],source:"override"\};)(?=[^]{0,800}?cachedGrowthBookFeatures)/;
    const asyncBoolRe =
      /async function ([\w$]+)\(([\w$]+)\){(?=let [\w$]+=[\w$]+\(\);if\([\w$]+&&\2 in [\w$]+\)return Boolean\([\w$]+\[\2\]\);)(?=[^]{0,800}?cachedGrowthBookFeatures)/g;
    const legacySyncRe =
      /function ([\w$]+)\(([\w$]+),([\w$]+)\){(?=let [\w$]+=[\w$]+\(\);if\([\w$]+&&\2 in [\w$]+\)return [\w$]+\[\2];)(?=[^]{0,800}?cachedGrowthBookFeatures)/;

    const withSync = content.replace(
      sourceAwareSyncRe,
      (match, _fn, flag) => `${match}${guard(flag)}return{value:__cccFF[${flag}],source:"override"};}`,
    );
    if (withSync !== content)
      return withSync.replace(
        asyncBoolRe,
        (match, _fn, flag) => `${match}${guard(flag)}return Boolean(__cccFF[${flag}]);}`,
      );

    return content.replace(
      legacySyncRe,
      (match, _fn, flag) => `${match}${guard(flag)}return __cccFF[${flag}];}`,
    );
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

// built-in string replacements
const builtInStringPatches: RuntimePatch[] = [
  // disable unwanted features
  { find: "security-review", replace: "zsecurityreview" },

  growthbookSyncFlagOverride,
  disableFindGrepShadow,
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
