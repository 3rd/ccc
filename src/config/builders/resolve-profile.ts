import { mergeSettings } from "@/config/layers";

type ProfileMap = Record<string, Record<string, unknown>>;

/** reads --profile <name> from process.argv (supports --profile=name and --profile name) */
export const getActiveProfileName = () => {
  const args = process.argv.slice(2);
  const flag = "--profile";
  const eqPrefix = `${flag}=`;

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (!current) continue;

    if (current.startsWith(eqPrefix)) {
      const value = current.slice(eqPrefix.length);
      return value.length > 0 ? value : undefined;
    }

    if (current === flag) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) return next;
      return undefined;
    }
  }

  return undefined;
};

/** merges profiles by name across config layers (env deep-merges within each profile) */
export const mergeProfiles = (
  ...layers: (Record<string, Record<string, unknown>> | undefined)[]
): ProfileMap => {
  const result: ProfileMap = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [name, profileSettings] of Object.entries(layer)) {
      result[name] =
        result[name] ?
          (mergeSettings(result[name], profileSettings) as Record<string, unknown>)
        : { ...profileSettings };
    }
  }
  return result;
};

/** applies a named profile on top of base settings, throws if profile not found */
export const applyProfile = (
  baseSettings: Record<string, unknown>,
  profileName: string,
  profiles: ProfileMap,
): Record<string, unknown> => {
  const profile = profiles[profileName];
  if (!profile) {
    const available = Object.keys(profiles).sort();
    const list = available.length > 0 ? available.join(", ") : "(none)";
    throw new Error(`Profile "${profileName}" not found. Available profiles: ${list}`);
  }
  return mergeSettings(baseSettings, profile) as Record<string, unknown>;
};

/**
 * exports a profile's env block as real process env vars. claude resolves oauth
 * credentials (CLAUDE_CODE_OAUTH_TOKEN) before applying settings.json env, so a
 * token override that only lives in settings is silently ignored for auth.
 */
export const exportProfileEnv = (profile: Record<string, unknown> | undefined): void => {
  if (!profile) return;
  const env = profile.env;
  if (env === null || typeof env !== "object" || Array.isArray(env)) return;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
};

/** returns a new argv with --profile and its value removed */
export const stripProfileFromArgv = (argv: string[]) => {
  const result: string[] = [];
  const flag = "--profile";
  const eqPrefix = `${flag}=`;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]!;

    if (current.startsWith(eqPrefix)) continue;

    if (current === flag) {
      // skip the next arg too (the profile name)
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) i += 1;
      continue;
    }

    result.push(current);
  }

  return result;
};
