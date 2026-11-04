import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCccCacheRoot } from "@/utils/cache-directory";
import { validatePreparedVirtualFileSystem, type VirtualCategoryEntries } from "@/utils/virtual-fs";
import type { NsVfsFile } from "@/vfs/ns-vfs";
import type { RuntimeHostPayload } from "./runtime-host";

const PREPARATION_CACHE_VERSION = 1;
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETAINED_ENTRIES = 64;
const INSTANCE_ID_VARIABLE = "\0instance-id";
const MIN_SUBSTITUTED_LENGTH = 8;
const SAFE_VALUE = /^[A-Za-z0-9_./:@=,+-]+$/;
const DISTINCTIVE_TOKEN = /[A-Za-z0-9_-]{12,}/g;
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH/i;
const ALWAYS_EXCLUDED_ROOTS = ["/proc", "/sys", "/dev"];
const RESOLVER_ENTRY_NAMES = ["package.json", "node_modules", "tsconfig.json", "jsconfig.json", "bunfig.toml"];

// Variables the outer launcher, its systemd scope, and the runtime host set to a new value on every
// launch. The key covers every other variable's value, and a cached preparation fills these in from
// the launch that reuses it, so they may only be passed through or embedded verbatim: a preparation
// that derived anything else from one of them would serve the derivation from the launch that built
// the entry. A per-launch variable missing here costs a cache miss on every launch, nothing worse.
const PER_LAUNCH_ENV_KEYS = new Set([
  "AGENT_INSTANCE_ID",
  "AGENT_RELAY_SESSION_FILE",
  "AGENTS_RECORDING_NETWORK_CONTEXT",
  "AGENTS_RECORDING_SESSION_ID",
  "AGENTS_RECORDING_TRANSCRIPT_HOOK_FILE",
  "AGENTS_STARTUP_T0_MS",
  "AGENTS_USAGE_ACCESS_LOG",
  "AGENTS_USAGE_SESSION_ID",
  "AGENTS_VFS_CHANGES_OBSERVED",
  "AGENTS_VFS_CHANGES_SESSION",
  "AGENTS_VFS_CHANGES_SOCKET",
  "AGENTS_VFS_CHANGES_TOKEN",
  "AGENTS_VFS_FOREGROUND_JOB_CONTROL",
  "AGENTS_VFS_MOD_PID",
  "AGENTS_VFS_MOD_SOCKET",
  "AGENTS_VFS_MOD_TOKEN",
  "AGENTS_VFS_NOTIFY_PID",
  "AGENTS_VFS_NOTIFY_SHADOW",
  "AGENTS_VFS_NOTIFY_SOCKET",
  "AGENTS_VFS_NOTIFY_TOKEN",
  "AGENTS_VFS_POST_TOOL_WORKER",
  "ALL_PROXY",
  "all_proxy",
  "CCC_EVENTS_FILE",
  "CCC_PRESEEDED_INSTANCE_ID",
  "CCC_RUNTIME_HOST_PID",
  "CLAUDE_CODE_SHELL",
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "INVOCATION_ID",
  "IO_PRESSURE_WATCH",
  "MEMORY_PRESSURE_WATCH",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "SYSTEMD_EXEC_PID",
]);

// Variables no preparation reads or changes: the settings that steer this cache, and the shell's own
// bookkeeping, which differs between commands typed in one terminal. The key ignores them and a reuse
// passes this launch's values through. They are never filled into the payload's text, where `OLDPWD`
// often equals an unrelated path the payload names, such as the launcher checkout a launch started from.
const PASS_THROUGH_ENV_KEYS = new Set(["_", "AGENTS_STARTUP_TRACE", "CCC_PREPARATION_CACHE", "OLDPWD"]);

type EnvironmentTemplateValue = { from: string } | { group: number } | { value: string };

export type TrustInputs = {
  claudeStatePath: string;
  trustedPaths: string[];
  featureFlags: unknown;
  claudeState: unknown;
};

type LookupKind = "L" | "P";

export type RecordedLookup = { isListing: boolean; path: string };

export type CoveredTree = { root: string; skipPaths: string[]; skipDirNames: string[] };

type PreparationCacheEntry = {
  version: number;
  key: string;
  nonce: string;
  groups: string[][];
  environment: Record<string, EnvironmentTemplateValue>;
  template: string;
  dependencies: [LookupKind, string, string][];
  trust: TrustInputs;
  areCategoriesServed: boolean;
  patchKey: string | null;
  missedPatches: string[];
};

export type PreparationToCache = {
  key: string;
  startedAtNs: bigint;
  incomingEnv: Record<string, string>;
  instanceId: string;
  workingDirectory: string;
  lookups: RecordedLookup[];
  coveredTrees: CoveredTree[];
  excludedPaths: string[];
  payload: RuntimeHostPayload;
  categories: VirtualCategoryEntries;
  areCategoriesServed: boolean;
  trust: TrustInputs;
  patchKey: string | undefined;
  missedPatches: string[];
};

export type PreparationKeyInput = {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  launcherDirectory: string;
};

export const tracePreparationCache = (event: string, detail?: string) => {
  if (!process.env.AGENTS_STARTUP_TRACE) return;

  process.stderr.write(`[ccc] preparation-cache.${event}${detail === undefined ? "" : ` ${detail}`}\n`);
};

export const preparationCacheMode = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = env.CCC_PREPARATION_CACHE?.trim().toLowerCase();
  const isDisabled = raw === "0" || raw === "off" || raw === "false";
  if (isDisabled) return "off";
  if (raw === "refresh") return "refresh";
  if (raw === "verify") return "verify";

  return "use";
};

const cacheDirectory = () => path.join(resolveCccCacheRoot(), "preparation");

const entryPath = (key: string) => path.join(cacheDirectory(), `${key}.json`);

const errorCode = (error: unknown) => {
  const hasCode = error instanceof Error && "code" in error;
  if (hasCode) return String(error.code);

  return "unknown";
};

const compareNames = ([left]: [string, unknown], [right]: [string, unknown]) => {
  if (left < right) return -1;
  if (left > right) return 1;

  return 0;
};

const isUnder = (target: string, root: string) => target === root || target.startsWith(`${root}/`);

const describeLookup = (kind: LookupKind, target: string) => {
  try {
    const stats = statSync(target, { bigint: true, throwIfNoEntry: false });
    if (!stats) return "missing";

    // a lookup through a directory depends on what the directory is, not on its entries: those
    // are recorded as lookups of their own, and only a listing reads the entries themselves
    const isDirectoryLookup = kind === "P" && stats.isDirectory();
    if (isDirectoryLookup) return `directory:${stats.mode}:${stats.dev}:${stats.ino}`;

    return `${stats.mode}:${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  } catch (error) {
    return `error:${errorCode(error)}`;
  }
};

const fingerprintLauncherSources = (launcherDirectory: string) => {
  const hash = createHash("sha256");
  const sourceFiles = readdirSync(path.join(launcherDirectory, "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  const manifestFiles = [path.join(launcherDirectory, "package.json"), path.join(launcherDirectory, "bun.lock")];

  for (const file of [...sourceFiles, ...manifestFiles]) {
    hash.update(file).update("\0").update(describeLookup("P", file)).update("\0");
  }

  return hash.digest("hex");
};

export const computePreparationKey = (input: PreparationKeyInput) => {
  const hash = createHash("sha256");

  const add = (label: string, value: string) => {
    hash.update(label).update("\0").update(value).update("\0");
  };

  add("version", String(PREPARATION_CACHE_VERSION));
  add("runtime", `${process.execPath}\0${Bun.version}\0${process.platform}\0${process.arch}`);
  add("machine", `${os.hostname()}\0${process.getuid?.() ?? ""}`);
  add("cwd", input.cwd);
  add("argv", JSON.stringify(input.argv));
  add("launcher", fingerprintLauncherSources(input.launcherDirectory));

  for (const [name, value] of Object.entries(input.env).sort(compareNames)) {
    const isIgnored = value === undefined || PASS_THROUGH_ENV_KEYS.has(name);
    if (isIgnored) continue;

    if (PER_LAUNCH_ENV_KEYS.has(name)) {
      add("launch-env", name);
    } else {
      add("env", `${name}=${value}`);
    }
  }

  return hash.digest("hex").slice(0, 32);
};

const placeholder = (nonce: string, group: number) => `@@ccc-preparation-${nonce}-${group}@@`;

const isSubstitutable = (value: string) => value.length >= MIN_SUBSTITUTED_LENGTH && SAFE_VALUE.test(value);

const distinctiveTokens = (value: string) => {
  return (value.match(DISTINCTIVE_TOKEN) ?? []).filter((token) => /\d/.test(token) && /[A-Za-z]/.test(token));
};

/**
 * Tokens of a per-launch value that identify this launch. A token that also occurs in a variable the
 * key covers, such as a session id inside the checkout path, is constant for the key, so finding it
 * elsewhere in the preparation proves nothing about per-launch data.
 */
const launchSpecificTokens = (value: string, keyedText: string) => {
  return distinctiveTokens(value).filter((token) => !keyedText.includes(token));
};

/**
 * Groups the values a cached preparation fills in per launch, longest value first so a value that
 * contains another is replaced whole. Variables that share a value form one group, and a reuse
 * requires them to share a value again, because the template cannot tell which of them it embedded.
 */
const collectVariableGroups = (env: Record<string, string>, instanceId: string) => {
  const namesByValue = new Map<string, string[]>([[instanceId, [INSTANCE_ID_VARIABLE]]]);

  for (const [name, value] of Object.entries(env)) {
    const isSecret = SECRET_NAME.test(name) && value.length >= 16;
    const isVariable = PER_LAUNCH_ENV_KEYS.has(name) || isSecret;
    if (!isVariable) continue;

    namesByValue.set(value, [...(namesByValue.get(value) ?? []), name]);
  }

  return [...namesByValue].sort(([left], [right]) => right.length - left.length);
};

type Substitution = { groups: [string, string[]][]; substitutedGroups: Set<number>; nonce: string };

const substituteValues = (text: string, substitution: Substitution) => {
  let substituted = text;

  for (const [index, [value]] of substitution.groups.entries()) {
    if (!substitution.substitutedGroups.has(index)) continue;

    substituted = substituted.split(value).join(placeholder(substitution.nonce, index));
  }

  return substituted;
};

const readVariable = (name: string, env: Record<string, string | undefined>, instanceId: string) => {
  if (name === INSTANCE_ID_VARIABLE) return instanceId;

  return env[name];
};

const resolveGroups = (groups: string[][], env: Record<string, string | undefined>, instanceId: string) => {
  const values: string[] = [];

  for (const names of groups) {
    const groupValues = new Set(names.map((name) => readVariable(name, env, instanceId)));
    const [value] = groupValues;
    const hasOneValue = groupValues.size === 1 && value !== undefined;
    if (!hasOneValue) return undefined;

    values.push(value);
  }

  return values;
};

const fillPlaceholders = (text: string, nonce: string, values: string[]) => {
  let filled = text;

  for (const [index, value] of values.entries()) {
    const token = placeholder(nonce, index);
    const isUnsafeEmbedding = filled.includes(token) && !SAFE_VALUE.test(value);
    if (isUnsafeEmbedding) return undefined;

    filled = filled.split(token).join(value);
  }

  return filled;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
};

const parseCategoryFile = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  if (typeof value.nativePath !== "string") return undefined;
  if (typeof value.sourcePath === "string") return { nativePath: value.nativePath, sourcePath: value.sourcePath };
  if (typeof value.content === "string") return { nativePath: value.nativePath, content: value.content };

  return undefined;
};

const parseCategories = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  if (!isStringArray(value.roots)) return undefined;
  if (!Array.isArray(value.files)) return undefined;

  const files: NsVfsFile[] = [];
  for (const entry of value.files) {
    const file = parseCategoryFile(entry);
    if (!file) return undefined;

    files.push(file);
  }

  return { roots: value.roots, files };
};

const parseTemplate = (text: string) => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;

  const { claudeArgv, importPath, featureFlags } = parsed;
  if (!isStringArray(claudeArgv)) return undefined;
  if (typeof importPath !== "string") return undefined;

  const parsedFeatureFlags = isRecord(featureFlags) ? featureFlags : undefined;
  const hasMalformedFeatureFlags = featureFlags !== undefined && parsedFeatureFlags === undefined;
  if (hasMalformedFeatureFlags) return undefined;

  const categories = parseCategories(parsed.categories);
  if (!categories) return undefined;

  try {
    const virtualFileSystem = validatePreparedVirtualFileSystem(parsed.virtualFileSystem);

    return {
      claudeArgv,
      importPath,
      ...(parsedFeatureFlags ? { featureFlags: parsedFeatureFlags } : {}),
      virtualFileSystem,
      categories,
    };
  } catch {
    return undefined;
  }
};

const parseEnvironmentValue = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  if (typeof value.from === "string") return { from: value.from };
  if (typeof value.group === "number") return { group: value.group };
  if (typeof value.value === "string") return { value: value.value };

  return undefined;
};

const parseEnvironmentTemplate = (value: unknown) => {
  if (!isRecord(value)) return undefined;

  const environment: Record<string, EnvironmentTemplateValue> = {};
  for (const [name, entry] of Object.entries(value)) {
    const parsed = parseEnvironmentValue(entry);
    if (!parsed) return undefined;

    environment[name] = parsed;
  }

  return environment;
};

const parseDependencies = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;

  const dependencies: [LookupKind, string, string][] = [];
  for (const entry of value) {
    if (!isStringArray(entry)) return undefined;

    const [kind, target, signature, ...rest] = entry;
    const isDependency = (kind === "L" || kind === "P") && target !== undefined && signature !== undefined && rest.length === 0;
    if (!isDependency) return undefined;

    dependencies.push([kind, target, signature]);
  }

  return dependencies;
};

const parseTrust = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  if (typeof value.claudeStatePath !== "string") return undefined;
  if (!isStringArray(value.trustedPaths)) return undefined;

  return {
    claudeStatePath: value.claudeStatePath,
    trustedPaths: value.trustedPaths,
    featureFlags: value.featureFlags,
    claudeState: value.claudeState,
  };
};

const parseEntry = (text: string, key: string): PreparationCacheEntry | undefined => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  if (parsed.version !== PREPARATION_CACHE_VERSION) return undefined;
  if (parsed.key !== key) return undefined;

  const { nonce, template, groups, areCategoriesServed, patchKey, missedPatches } = parsed;
  if (typeof nonce !== "string") return undefined;
  if (typeof template !== "string") return undefined;
  if (!Array.isArray(groups)) return undefined;
  if (!groups.every(isStringArray)) return undefined;
  if (typeof areCategoriesServed !== "boolean") return undefined;
  if (!isStringArray(missedPatches)) return undefined;

  const isValidPatchKey = patchKey === null || typeof patchKey === "string";
  if (!isValidPatchKey) return undefined;

  const environment = parseEnvironmentTemplate(parsed.environment);
  if (!environment) return undefined;

  const dependencies = parseDependencies(parsed.dependencies);
  if (!dependencies) return undefined;

  const trust = parseTrust(parsed.trust);
  if (!trust) return undefined;

  return {
    version: PREPARATION_CACHE_VERSION,
    key,
    nonce,
    groups,
    environment,
    template,
    dependencies,
    trust,
    areCategoriesServed,
    patchKey,
    missedPatches,
  };
};

export const instantiatePreparation = (
  entry: PreparationCacheEntry,
  env: Record<string, string | undefined>,
  instanceId: string,
) => {
  const values = resolveGroups(entry.groups, env, instanceId);
  if (!values) return undefined;

  const templateText = fillPlaceholders(entry.template, entry.nonce, values);
  if (templateText === undefined) return undefined;

  const template = parseTemplate(templateText);
  if (!template) return undefined;

  const environment: Record<string, string> = {};

  for (const [name, source] of Object.entries(entry.environment)) {
    let value: string | undefined;
    if ("from" in source) {
      value = env[source.from];
    } else if ("group" in source) {
      value = values[source.group];
    } else {
      value = fillPlaceholders(source.value, entry.nonce, values);
    }

    if (value === undefined) {
      if (PASS_THROUGH_ENV_KEYS.has(name)) continue;

      return undefined;
    }

    environment[name] = value;
  }

  for (const name of PASS_THROUGH_ENV_KEYS) {
    const value = env[name];
    if (value === undefined) continue;

    environment[name] = value;
  }

  return { ...template, environment };
};

export const readPreparationCache = (key: string) => {
  let text: string;

  try {
    text = readFileSync(entryPath(key), "utf8");
  } catch {
    return undefined;
  }

  return parseEntry(text, key);
};

export const findChangedDependency = (entry: PreparationCacheEntry) => {
  return entry.dependencies.find(([kind, target, signature]) => describeLookup(kind, target) !== signature)?.[1];
};

export const markPreparationCacheUsed = (key: string) => {
  const now = new Date();

  // Only expiry reads this timestamp, and a concurrent prune may already have removed the entry.
  try {
    utimesSync(entryPath(key), now, now);
  } catch {}
};

const parseConfigSources = (text: string | undefined) => {
  if (text === undefined) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];

  const { roots, skipPaths, skipDirNames } = parsed;
  const isValidSources = isStringArray(roots) && isStringArray(skipPaths) && isStringArray(skipDirNames);
  if (!isValidSources) return [];

  return roots.map((root) => ({ root, skipPaths, skipDirNames }));
};

export const readCoveredTrees = (env: NodeJS.ProcessEnv, launcherDirectory: string) => {
  const trees: CoveredTree[] = [{ root: path.join(launcherDirectory, "src"), skipPaths: [], skipDirNames: [] }];
  const configDirectory = env.CCC_CONFIG_DIR;
  const hasConfigFingerprint = configDirectory !== undefined && env.CCC_CONFIG_FINGERPRINT !== undefined;
  if (hasConfigFingerprint) {
    // the config fingerprint hashes the files the export writes, not the links it adds under node_modules
    trees.push({ root: configDirectory, skipPaths: [], skipDirNames: ["node_modules"] });
  }

  return [...trees, ...parseConfigSources(env.CCC_CONFIG_SOURCES)];
};

const isSymbolicLink = (target: string, cache: Map<string, boolean>) => {
  const cached = cache.get(target);
  if (cached !== undefined) return cached;

  const isLink = lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
  cache.set(target, isLink);

  return isLink;
};

/** A fingerprint covers a lookup only when nothing between its root and the path escapes that fingerprint. */
const isCoveredByKey = (target: string, trees: CoveredTree[], linkCache: Map<string, boolean>) => {
  const tree = trees.find((candidate) => isUnder(target, candidate.root));
  if (!tree) return false;
  if (tree.skipPaths.some((skipped) => isUnder(target, skipped))) return false;

  const segments = path.relative(tree.root, target).split(path.sep).filter((segment) => segment !== "");
  if (segments.some((segment) => tree.skipDirNames.includes(segment))) return false;

  let current = tree.root;
  if (isSymbolicLink(current, linkCache)) return false;

  for (const segment of segments) {
    current = path.join(current, segment);
    if (isSymbolicLink(current, linkCache)) return false;
  }

  return true;
};

const collectStrictAncestors = (targets: string[]) => {
  const ancestors = new Set<string>();

  for (const target of targets) {
    let current = path.dirname(target);

    while (!ancestors.has(current)) {
      ancestors.add(current);

      const parent = path.dirname(current);
      if (parent === current) break;

      current = parent;
    }
  }

  return ancestors;
};

// Bun's module resolver lists every ancestor of the working directory and of each module it loads,
// and reads from those listings only whether these resolver entries exist. Depending on the whole
// listing of /tmp or the home directory would invalidate the entry on every unrelated file they
// gain, so such a listing becomes the directory's identity plus a lookup of each resolver entry.
const narrowResolverListings = (lookups: RecordedLookup[], resolverAncestors: Set<string>) => {
  return lookups.flatMap((lookup) => {
    const isResolverListing = lookup.isListing && resolverAncestors.has(lookup.path);
    if (!isResolverListing) return [lookup];

    return [
      { isListing: false, path: lookup.path },
      ...RESOLVER_ENTRY_NAMES.map((name) => ({ isListing: false, path: path.join(lookup.path, name) })),
    ];
  });
};

// keeps the most recently used entries, which reuse refreshes, so launch shapes that are never
// repeated cannot fill the disk
const pruneEntries = (directory: string, now: number) => {
  const entries = readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    const stats = statSync(target, { throwIfNoEntry: false });

    return stats ? [{ target, usedAtMs: stats.mtimeMs }] : [];
  });
  entries.sort((left, right) => right.usedAtMs - left.usedAtMs);

  for (const [index, { target, usedAtMs }] of entries.entries()) {
    const isRetained = index < MAX_RETAINED_ENTRIES && now - usedAtMs <= CACHE_RETENTION_MS;
    if (isRetained) continue;

    rmSync(target, { force: true });
  }
};

const templateOf = (preparation: PreparationToCache) => {
  const { payload, trust } = preparation;
  const files = payload.virtualFileSystem.files.map((file) => {
    if (file.path === trust.claudeStatePath) return { ...file, content: "" };

    return file;
  });
  const virtualFileSystem = validatePreparedVirtualFileSystem({ ...payload.virtualFileSystem, files });

  return {
    claudeArgv: payload.claudeArgv,
    importPath: payload.importPath,
    ...(payload.featureFlags ? { featureFlags: payload.featureFlags } : {}),
    virtualFileSystem,
    categories: preparation.categories,
  };
};

export const createPreparationCacheEntry = (preparation: PreparationToCache) => {
  const { incomingEnv, instanceId, payload } = preparation;
  const hasBinaryCategory = preparation.categories.files.some(
    (file) => "content" in file && typeof file.content !== "string",
  );
  if (hasBinaryCategory) return { reason: "binary category content" };

  const nonce = randomBytes(8).toString("hex");
  const groups = collectVariableGroups(incomingEnv, instanceId);
  const keyedText = Object.entries(incomingEnv)
    .filter(([name]) => !PER_LAUNCH_ENV_KEYS.has(name) && !PASS_THROUGH_ENV_KEYS.has(name))
    .map(([, value]) => value)
    .join("\0");

  // A secret the key covers is filled back with the identical value, so replacing it only keeps it
  // out of the entry. A per-launch value is filled in by position only when a token unique to this
  // launch tells it apart from unrelated text that merely matches it.
  const keyedGroups = new Set(
    groups.flatMap(([, names], index) => {
      const isKeyed = names.every((name) => name !== INSTANCE_ID_VARIABLE && !PER_LAUNCH_ENV_KEYS.has(name));

      return isKeyed ? [index] : [];
    }),
  );
  const substitutedGroups = new Set(
    groups.flatMap(([value], index) => {
      const isFilledIn =
        isSubstitutable(value) && (keyedGroups.has(index) || launchSpecificTokens(value, keyedText).length > 0);

      return isFilledIn ? [index] : [];
    }),
  );
  const substitution = { groups, substitutedGroups, nonce };

  const groupByValue = new Map(groups.map(([value], index) => [value, index]));
  const environment: Record<string, EnvironmentTemplateValue> = {};
  const literalValues: string[] = [];

  for (const [name, value] of Object.entries(payload.environment)) {
    const group = groupByValue.get(value);
    const isLaunchGroup = group !== undefined && substitutedGroups.has(group);
    if (incomingEnv[name] === value) {
      environment[name] = { from: name };
    } else if (isLaunchGroup) {
      environment[name] = { group };
    } else if (SECRET_NAME.test(name)) {
      return { reason: `secret ${name} produced by the preparation` };
    } else {
      const substituted = substituteValues(value, substitution);
      environment[name] = { value: substituted };
      literalValues.push(substituted);
    }
  }

  const template = substituteValues(JSON.stringify(templateOf(preparation)), substitution);
  const storedTexts = [template, ...literalValues];

  for (const [index, [value, names]] of groups.entries()) {
    const isCheckedVerbatim = !substitutedGroups.has(index) && (keyedGroups.has(index) || SAFE_VALUE.test(value));
    const leftovers = isCheckedVerbatim ? [value, JSON.stringify(value).slice(1, -1)] : launchSpecificTokens(value, keyedText);

    const embedded = leftovers.find((leftover) => storedTexts.some((text) => text.includes(leftover)));
    if (embedded !== undefined) return { reason: `value of ${names.join(", ")} embedded in a derived form` };
  }

  const draft = {
    version: PREPARATION_CACHE_VERSION,
    key: preparation.key,
    nonce,
    groups: groups.map(([, names]) => names),
    environment,
    template,
    dependencies: [],
    trust: preparation.trust,
    areCategoriesServed: preparation.areCategoriesServed,
    patchKey: preparation.patchKey ?? null,
    missedPatches: preparation.missedPatches,
  } satisfies PreparationCacheEntry;

  const replayed = instantiatePreparation(draft, incomingEnv, instanceId);
  const expected = { ...templateOf(preparation), environment: payload.environment };
  const isReproduced = replayed !== undefined && JSON.stringify(replayed) === JSON.stringify(expected);
  if (!isReproduced) return { reason: "template does not reproduce the preparation" };

  const perLaunchTokens = groups.flatMap(([value]) => launchSpecificTokens(value, keyedText));
  const excludedRoots = [...ALWAYS_EXCLUDED_ROOTS, resolveCccCacheRoot(), ...preparation.excludedPaths];
  const linkCache = new Map<string, boolean>();
  const dependencies: [LookupKind, string, string][] = [];
  const resolverAncestors = collectStrictAncestors([
    preparation.workingDirectory,
    ...preparation.coveredTrees.map((tree) => tree.root),
  ]);
  const seen = new Set<string>();

  for (const { isListing, path: target } of narrowResolverListings(preparation.lookups, resolverAncestors)) {
    const isExcluded =
      excludedRoots.some((root) => isUnder(target, root)) ||
      perLaunchTokens.some((token) => target.includes(token)) ||
      isCoveredByKey(target, preparation.coveredTrees, linkCache);
    if (isExcluded) continue;

    const kind = isListing ? "L" : "P";
    const seenKey = `${kind}${target}`;
    if (seen.has(seenKey)) continue;

    seen.add(seenKey);
    const signature = describeLookup(kind, target);
    const [, , , , mtimeNs, ctimeNs] = signature.split(":");
    const isChangedDuringPreparation =
      mtimeNs !== undefined &&
      ctimeNs !== undefined &&
      (BigInt(mtimeNs) >= preparation.startedAtNs || BigInt(ctimeNs) >= preparation.startedAtNs);
    if (isChangedDuringPreparation) return { reason: `${target} changed during preparation` };

    dependencies.push([kind, target, signature]);
  }

  // creating an entry changes its directory's modification time, which a recorded listing of that
  // directory checks, so a lookup that found nothing there adds nothing; a parent that is only
  // covered by the key does not qualify, because the key's fingerprint skips some directories
  const listedDirectories = new Set(dependencies.filter(([kind]) => kind === "L").map(([, target]) => target));
  const checkedDependencies = dependencies.filter(([kind, target, signature]) => {
    const isImpliedByListing = kind === "P" && signature === "missing" && listedDirectories.has(path.dirname(target));

    return !isImpliedByListing;
  });

  return { entry: { ...draft, dependencies: checkedDependencies } };
};

export const findPreparationDifference = (preparation: PreparationToCache) => {
  const entry = readPreparationCache(preparation.key);
  if (!entry) return undefined;

  const replayed = instantiatePreparation(entry, preparation.incomingEnv, preparation.instanceId);
  if (!replayed) return "the entry cannot be filled in for this launch";

  const replayedParts = new Map(Object.entries({ ...replayed, environment: Object.entries(replayed.environment).sort(compareNames) }));
  const expected = {
    ...templateOf(preparation),
    environment: Object.entries(preparation.payload.environment).sort(compareNames),
  };

  for (const [part, value] of Object.entries(expected)) {
    const isSame = JSON.stringify(replayedParts.get(part)) === JSON.stringify(value);
    if (!isSame) return part;
  }

  return undefined;
};

export const writePreparationCache = (entry: PreparationCacheEntry) => {
  const directory = cacheDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const target = entryPath(entry.key);
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 });
  renameSync(temporary, target);
  pruneEntries(directory, Date.now());
};
