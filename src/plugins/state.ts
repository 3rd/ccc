import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { homedir } from "os";
import { dirname, join } from "path";
import { z } from "zod/v4";

export type StateType = "none" | "project" | "temp" | "user";

export interface PluginStateData {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => void;
  clear: () => void;
  getAll: () => Record<string, unknown>;
}

export interface PluginStateSnapshot {
  values: Record<string, unknown>;
  revision: string;
}

export interface PluginState extends PluginStateData {
  initialize: () => void;
  snapshot: () => PluginStateSnapshot;
  update: <R>(operation: (state: PluginStateData) => R, expectedRevision?: string) => R;
}

export class PluginStateError extends Error {
  constructor(readonly code: "unavailable" | "busy" | "conflict", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PluginStateError";
  }
}

export const pluginHistoryParameters = z.object({
  offset: z.number().int().min(0).default(0),
  revision: z.string().optional().describe("Revision returned by the first page; required when offset is nonzero"),
});

interface PluginHistoryOptions<T> {
  value: T;
  revision: string;
  offset: number;
  expectedRevision?: string;
}

export const formatPluginHistory = <T>({ value, revision, offset, expectedRevision }: PluginHistoryOptions<T>) => {
  if ((offset > 0 && !expectedRevision) || (expectedRevision !== undefined && expectedRevision !== revision)) {
    throw new PluginStateError("conflict", "History revision changed or is missing; restart retrieval at offset 0.");
  }
  const content = JSON.stringify(value, null, 2);
  if (offset > content.length) throw new RangeError("History offset exceeds the serialized state.");
  const end = Math.min(offset + 4000, content.length);
  return JSON.stringify({ revision, offset, totalCharacters: content.length, nextOffset: end < content.length ? end : null, complete: end === content.length, content: content.slice(offset, end) });
};

const getSessionId = () => {
  const instanceId = process.env.CCC_INSTANCE_ID;
  if (!instanceId || !/^[a-zA-Z0-9_-]+$/.test(instanceId)) {
    throw new PluginStateError("unavailable", "Temporary plugin state requires a valid CCC_INSTANCE_ID.");
  }
  return instanceId;
};

const getStatePath = (pluginName: string, cwd: string, stateType: StateType) => {
  if (stateType === "none") return null;

  switch (stateType) {
    case "temp": {
      const sessionId = getSessionId();
      return `/tmp/ccc-plugin-${pluginName}-${sessionId}.json`;
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

const ensureDir = (filePath: string) => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

const hasErrorCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

const loadState = (path: string, stateType: StateType): PluginStateSnapshot => {
  let descriptor: number;
  try {
    descriptor = openSync(path, "r");
  } catch (error) {
    if (stateType !== "temp" && hasErrorCode(error, "ENOENT")) return { values: {}, revision: "absent" };
    throw error;
  }
  try {
    const content = readFileSync(descriptor, "utf8");
    const state: unknown = JSON.parse(content);
    if (typeof state !== "object" || state === null || Array.isArray(state)) {
      throw new Error(`Plugin state must be an object: ${path}`);
    }
    const stat = fstatSync(descriptor, { bigint: true });
    const revision = createHash("sha256").update(`${stat.dev}:${stat.ino}:${stat.ctimeNs}:${content}`).digest("hex");
    return { values: Object.fromEntries(Object.entries(state)), revision };
  } finally {
    closeSync(descriptor);
  }
};

const withStateLock = <R>(path: string, operation: (candidate: string) => R) => {
  const directory = `${path}.lock`;
  mkdirSync(directory, { recursive: true });
  const claim = `${process.pid}-${randomUUID()}`;
  const claimPath = join(directory, claim);
  const candidate = `${path}.${claim}.tmp`;
  writeFileSync(claimPath, "", { flag: "wx", mode: 0o600 });
  try {
    for (const entry of readdirSync(directory)) {
      if (entry === claim) continue;
      const match = /^(\d+)-[0-9a-f-]{36}$/.exec(entry);
      const pid = match?.[1] ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new PluginStateError("unavailable", `Unrecognized plugin state lock: ${path}`);
      }
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (!hasErrorCode(error, "ESRCH")) throw error;
        rmSync(`${path}.${entry}.tmp`, { force: true });
        rmSync(join(directory, entry), { force: true });
        continue;
      }
      throw new PluginStateError("busy", `Plugin state is being updated: ${path}`);
    }
    return operation(candidate);
  } finally {
    rmSync(candidate, { force: true });
    unlinkSync(claimPath);
  }
};

const saveState = (path: string, candidate: string, state: Record<string, unknown>) => {
  writeFileSync(candidate, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
  renameSync(candidate, path);
};

const clearStateFile = (path: string) => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
};

export const createPluginState = (
  pluginName: string,
  cwd: string,
  stateType: StateType = "none",
): PluginState => {
  const statePath = getStatePath(pluginName, cwd, stateType);
  let cache: Record<string, unknown> | null = null;
  let memoryRevision = 0;

  const accessState = <R>(operation: () => R) => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof PluginStateError) throw error;
      throw new PluginStateError("unavailable", `Plugin state unavailable for ${pluginName}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };

  const snapshot = (): PluginStateSnapshot => accessState(() => {
    if (statePath) return loadState(statePath, stateType);
    if (cache === null) {
      cache = {};
    }
    return { values: structuredClone(cache), revision: String(memoryRevision) };
  });

  const createStateData = (read: () => Record<string, unknown>, write: (state: Record<string, unknown>) => void): PluginStateData => ({
    get: <T>(key: string): T | undefined => {
      const state = read();
      return state[key] as T | undefined;
    },
    set: (key, value) => {
      const state = read();
      state[key] = value;
      write(state);
    },
    clear: () => write({}),
    getAll: () => ({ ...read() }),
  });

  const update = <R>(operation: (state: PluginStateData) => R, expectedRevision?: string) => accessState(() => {
    const apply = (candidate?: string) => {
      const current = snapshot();
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new PluginStateError("conflict", `Plugin state changed for ${pluginName}; inspect current state before continuing.`);
      }
      let values = structuredClone(current.values);
      let changed = false;
      const data = createStateData(() => values, (next) => {
        values = next;
        changed = true;
      });
      const result = operation(data);
      if (result instanceof Promise) throw new TypeError("Plugin state updates must be synchronous.");
      if (!changed) return result;
      if (statePath && candidate) saveState(statePath, candidate, values);
      else {
        cache = values;
        memoryRevision++;
      }
      return result;
    };
    if (statePath) {
      ensureDir(statePath);
      return withStateLock(statePath, apply);
    }
    return apply();
  });

  const clear = () => accessState(() => {
    if (!statePath) {
      cache = {};
      memoryRevision++;
      return;
    }
    withStateLock(statePath, (candidate) => {
      if (stateType === "temp") saveState(statePath, candidate, {});
      else clearStateFile(statePath);
    });
  });

  const initialize = () => accessState(() => {
    if (stateType !== "temp" || !statePath) return;
    withStateLock(statePath, (candidate) => {
      if (existsSync(statePath)) {
        snapshot();
        return;
      }
      saveState(statePath, candidate, {});
    });
  });

  return {
    get: <T>(key: string) => snapshot().values[key] as T | undefined,
    getAll: () => snapshot().values,
    set: (key, value) => update((state) => state.set(key, value)),
    clear,
    initialize,
    snapshot,
    update,
  };
};
