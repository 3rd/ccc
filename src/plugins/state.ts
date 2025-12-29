import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type StateType = "none" | "project" | "temp" | "user";

export interface PluginState {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => void;
  clear: () => void;
  getAll: () => Record<string, unknown>;
}

const getCwdHash = (cwd: string): string => {
  return createHash("md5").update(cwd).digest("hex").slice(0, 8);
};

const getStatePath = (pluginName: string, cwd: string, stateType: StateType): string | null => {
  if (stateType === "none") return null;
  const cwdHash = getCwdHash(cwd);

  switch (stateType) {
    case "temp": {
      return `/tmp/ccc-plugin-${pluginName}-${cwdHash}.json`;
    }
    case "project": {
      return join(cwd, ".ccc", "state", "plugins", `${pluginName}.json`);
    }
    case "user": {
      return join(homedir(), ".ccc", "state", "plugins", `${pluginName}.json`);
    }
    default: {
      throw new Error(`Invalid state type`);
    }
  }
};

const ensureDir = (filePath: string): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

const loadState = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};

  try {
    const content = readFileSync(path, "utf8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const saveState = (path: string, state: Record<string, unknown>): void => {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

const clearStateFile = (path: string): void => {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
};

export const createPluginState = (
  pluginName: string,
  cwd: string,
  stateType: StateType = "none",
): PluginState => {
  const statePath = getStatePath(pluginName, cwd, stateType);
  let cache: Record<string, unknown> | null = null;

  const getState = (): Record<string, unknown> => {
    if (cache === null) {
      cache = statePath ? loadState(statePath) : {};
    }
    return cache;
  };

  return {
    get: <T>(key: string): T | undefined => {
      const state = getState();
      return state[key] as T | undefined;
    },

    set: <T>(key: string, value: T): void => {
      const state = getState();
      state[key] = value;
      cache = state;
      if (statePath) saveState(statePath, state);
    },

    clear: (): void => {
      cache = {};
      if (statePath) clearStateFile(statePath);
    },

    getAll: (): Record<string, unknown> => {
      return { ...getState() };
    },
  };
};
