import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  installVirtualFileSystem,
  type PreparedVirtualFileSystem,
  setVirtualFileSystemRuntimeLogSink,
  validatePreparedVirtualFileSystem,
} from "../utils/virtual-fs";
import {
  PREPARATION_LAUNCHER_PATH_ENV,
  RUNTIME_HOST_PAYLOAD_FD,
  RUNTIME_HOST_PAYLOAD_FD_ENV,
} from "./runtime-host-process";

export interface RuntimeHostPayload {
  version: 1;
  claudeArgv: string[];
  importPath: string;
  featureFlags?: Record<string, unknown>;
  environment: Record<string, string>;
  runtimeLogPath?: string;
  virtualFileSystem: PreparedVirtualFileSystem;
}

const invalidRuntimeHostPayload = (field: string): never => {
  throw new Error(`Invalid runtime host payload field: ${field}`);
};

const runtimeRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return invalidRuntimeHostPayload(field);
};

const runtimeString = (value: unknown, field: string): string => {
  if (typeof value === "string") return value;
  return invalidRuntimeHostPayload(field);
};

const runtimeJsonValue = (value: unknown, field: string): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => runtimeJsonValue(entry, `${field}[${index}]`));
  }
  if (typeof value === "object") {
    const record = runtimeRecord(value, field);
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, runtimeJsonValue(entry, `${field}.${key}`)]),
    );
  }
  return invalidRuntimeHostPayload(field);
};

export const validateRuntimeHostPayload = (value: unknown): RuntimeHostPayload => {
  const fields = runtimeRecord(value, "payload");
  if (fields.version !== 1) invalidRuntimeHostPayload("version");
  const rawClaudeArgv =
    Array.isArray(fields.claudeArgv) ? fields.claudeArgv : invalidRuntimeHostPayload("claudeArgv");

  let featureFlags: Record<string, unknown> | undefined;
  if (fields.featureFlags !== undefined) {
    const validated = runtimeJsonValue(fields.featureFlags, "featureFlags");
    featureFlags = runtimeRecord(validated, "featureFlags");
  }

  const rawEnvironment = runtimeRecord(fields.environment, "environment");
  const environment = Object.fromEntries(
    Object.entries(rawEnvironment).map(([key, entry]) => [key, runtimeString(entry, `environment.${key}`)]),
  );

  return {
    version: 1,
    claudeArgv: rawClaudeArgv.map((arg, index) => runtimeString(arg, `claudeArgv[${index}]`)),
    importPath: runtimeString(fields.importPath, "importPath"),
    featureFlags,
    environment,
    runtimeLogPath:
      fields.runtimeLogPath === undefined ? undefined : runtimeString(fields.runtimeLogPath, "runtimeLogPath"),
    virtualFileSystem: validatePreparedVirtualFileSystem(fields.virtualFileSystem),
  };
};

export const withoutTsxNodeOptions = (nodeOptions: string | undefined) => {
  if (!nodeOptions) return undefined;
  const cleaned = nodeOptions.replace(
    /\s*--(?:import|require|loader)(?:\s+|=)\S*tsx\S*/g,
    "",
  ).trim();
  return cleaned || undefined;
};

const removeTsxFromNodeOptions = () => {
  const cleaned = withoutTsxNodeOptions(process.env.NODE_OPTIONS);
  if (cleaned) process.env.NODE_OPTIONS = cleaned;
  else delete process.env.NODE_OPTIONS;
};

const connectVirtualFileSystemLogs = (logPath: string | undefined) => {
  if (!process.env.DEBUG || !logPath) return;
  setVirtualFileSystemRuntimeLogSink((entry) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    const category = (entry.type === "vfs" ? "[VFS]" : "[SHELL]").padEnd(15);
    const message = entry.type === "vfs" ? entry.message : entry.command;
    const data =
      entry.type === "vfs" ? entry.data
      : entry.args ? entry.args
      : undefined;
    let suffix = "";
    try {
      if (data !== undefined) suffix = ` ${typeof data === "object" ? JSON.stringify(data) : String(data)}`;
    } catch {
      suffix = ` ${String(data)}`;
    }
    const line = `${timestamp} DEBUG ${category} ${message}${suffix}\n`;
    appendFileSync(logPath, line);
    if (process.env.DEBUG === "stdout") process.stdout.write(`\u001b[90m${line}\u001b[0m`);
  });
};

const createEventsFileOwner = () => {
  const existingEventsFile = process.env.CCC_EVENTS_FILE;
  const eventsFile = existingEventsFile ?? join(tmpdir(), `ccc-events-${randomBytes(6).toString("hex")}.jsonl`);
  if (!existingEventsFile) {
    writeFileSync(eventsFile, "");
    process.env.CCC_EVENTS_FILE = eventsFile;
  }

  const cleanup = () => {
    try {
      if (!existingEventsFile && existsSync(eventsFile)) unlinkSync(eventsFile);
    } catch {}
  };
  process.on("exit", cleanup);
  return cleanup;
};

const readPreparationPayload = async (onSpawn: (child: ChildProcess) => void) => {
  const launcherPath = process.env[PREPARATION_LAUNCHER_PATH_ENV];
  if (!launcherPath) throw new Error(`Missing ${PREPARATION_LAUNCHER_PATH_ENV}`);
  const bunPath = process.env.CCC_BUN_EXEC_PATH?.trim() || "bun";
  const child = spawn(bunPath, [launcherPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, [RUNTIME_HOST_PAYLOAD_FD_ENV]: String(RUNTIME_HOST_PAYLOAD_FD) },
    stdio: ["inherit", "inherit", "inherit", "pipe"],
  });
  onSpawn(child);
  const payloadChannel = child.stdio[3];
  if (!payloadChannel || !("on" in payloadChannel) || !("setEncoding" in payloadChannel)) {
    child.kill();
    throw new Error("CCC preparation payload channel was not created");
  }

  const payloadChunks: string[] = [];
  payloadChannel.setEncoding("utf8");
  payloadChannel.on("data", (chunk: string) => {
    payloadChunks.push(chunk);
  });

  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  return { ...result, serializedPayload: payloadChunks.join("") };
};

const applyPreparedEnvironment = (environment: Record<string, string>) => {
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key];
  }
  Object.assign(process.env, environment);
};

export const runRuntimeHost = async () => {
  const cleanupEventsFile = createEventsFileOwner();
  let preparationChild: ChildProcess | undefined;
  const stop = (signal: NodeJS.Signals) => {
    preparationChild?.kill(signal);
    cleanupEventsFile();
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  const preparation = await readPreparationPayload((child) => {
    preparationChild = child;
  });
  if (preparation.signal) {
    throw new Error(`CCC preparation terminated by ${preparation.signal}`);
  }
  if (!preparation.serializedPayload) {
    process.exitCode = preparation.exitCode ?? 1;
    return;
  }
  if (preparation.exitCode !== 0) {
    throw new Error(`CCC preparation failed with exit code ${preparation.exitCode}`);
  }
  const parsed: unknown = JSON.parse(preparation.serializedPayload);
  const payload = validateRuntimeHostPayload(parsed);
  preparationChild = undefined;

  applyPreparedEnvironment(payload.environment);

  connectVirtualFileSystemLogs(payload.runtimeLogPath);
  installVirtualFileSystem(payload.virtualFileSystem);
  if (payload.featureFlags && Object.keys(payload.featureFlags).length > 0) {
    (globalThis as { __cccFeatureFlags?: Record<string, unknown> }).__cccFeatureFlags = payload.featureFlags;
  }

  process.argv = [process.execPath, ...payload.claudeArgv];
  process.setSourceMapsEnabled(false);
  removeTsxFromNodeOptions();

  await import(payload.importPath);
};

const entryPath = process.argv[1];
if (entryPath && pathToFileURL(entryPath).href === import.meta.url) {
  runRuntimeHost().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
