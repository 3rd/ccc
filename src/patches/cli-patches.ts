// runtime patches for claude cli

export type PatchFn = (content: string) => string;

export type RuntimePatch = { find: string; replace: string } | { fn: PatchFn; name: string };

// short-circuit the sync growthbook flag reader (v_/k$) so featureFlags set via
// globalThis.__cccFeatureFlags always win. injection must happen at the
// function entry: the reader has settings-layer pre-checks (kSH/NSH) that
// short-circuit before reaching the in-memory cache, so any layer carrying the
// flag would otherwise win against __cccFF.
//
// minified identifiers rotate every build. we anchor on two stable structural
// signatures unique to the sync reader:
//   1. body starts with `let X=Y();if(X&&FLAG in X)return X[FLAG];` — the
//      layered settings override pattern.
//   2. body contains `cachedGrowthBookFeatures` within ~800 chars — only the
//      sync reader carries this literal directly (async wrappers only delegate).
const growthbookSyncFlagOverride: RuntimePatch = {
  name: "growthbook-sync-flag-override",
  fn: (content) => {
    if (content.includes("__cccFeatureFlags")) return content;
    const re =
      /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{(?=let [\w$]+=[\w$]+\(\);if\([\w$]+&&\2 in [\w$]+\)return [\w$]+\[\2\];)(?=[^]{0,800}?cachedGrowthBookFeatures)/;
    return content.replace(
      re,
      (match, _fn, flag, _dflt) =>
        `${match}let __cccFF=globalThis.__cccFeatureFlags;` +
        `if(__cccFF&&Object.prototype.hasOwnProperty.call(__cccFF,${flag})){` +
        `if(process.env.CCC_DEBUG_FEATURE_FLAGS)console.error("[ccc] featureFlag "+${flag}+" -> "+JSON.stringify(__cccFF[${flag}]));` +
        `return __cccFF[${flag}];}`,
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
      /function ([\w$]+)\(\)\{if\(![\w$]+\(\)\)return null;return\["unalias find 2>\/dev\/null \|\| true","unalias grep 2>\/dev\/null \|\| true"/;
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
