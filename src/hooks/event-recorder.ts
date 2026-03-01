import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ClaudeHookInput } from "@/types/hooks";
import { ensureDirectoryExists } from "@/utils/fs";

interface BaseRecordedEntry {
  timestamp: string;
  hook_event_name: ClaudeHookInput["hook_event_name"];
  session_id: string;
  cwd: string;
  transcript_path: string;
  input: ClaudeHookInput;
}

export interface RecordedEvent extends BaseRecordedEntry {}

export interface RecordedHookCall extends BaseRecordedEntry {
  hook_id: string;
  has_result: boolean;
  result?: unknown;
  error?: {
    message: string;
    stack?: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(path.dirname(__dirname));

const getInstanceCacheDir = (): string | null => {
  const instanceId = process.env.CCC_INSTANCE_ID;
  if (!instanceId) {
    console.error("Event recording failed: CCC_INSTANCE_ID is not set");
    return null;
  }

  return path.join(rootDir, ".cache", instanceId);
};

const appendJsonLineInInstanceCache = (filename: string, payload: unknown): void => {
  try {
    const cacheDir = getInstanceCacheDir();
    if (!cacheDir) return;
    ensureDirectoryExists(cacheDir);
    const filePath = path.join(cacheDir, filename);
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`);
  } catch {}
};

class EventRecorder {
  private _events: RecordedEvent[] = [];
  private _hookCalls: RecordedHookCall[] = [];

  get events(): readonly RecordedEvent[] {
    return this._events;
  }

  get hookCalls(): readonly RecordedHookCall[] {
    return this._hookCalls;
  }

  record = (input: ClaudeHookInput) => {
    const event: RecordedEvent = {
      timestamp: new Date().toISOString(),
      hook_event_name: input.hook_event_name,
      session_id: input.session_id,
      cwd: input.cwd,
      transcript_path: input.transcript_path,
      input,
    };

    this._events.push(event);

    // write ./cache/{instanceId}/events.jsonl
    if (process.env.DEBUG) {
      appendJsonLineInInstanceCache("events.jsonl", event);
    }

    // write to CCC_EVENTS_FILE
    try {
      const eventsFile = process.env.CCC_EVENTS_FILE;
      if (eventsFile) {
        fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`);
      }
    } catch {}
  };

  recordHookCall = (hookId: string, input: ClaudeHookInput, result?: unknown, error?: unknown) => {
    const hookCall: RecordedHookCall = {
      timestamp: new Date().toISOString(),
      hook_id: hookId,
      hook_event_name: input.hook_event_name,
      session_id: input.session_id,
      cwd: input.cwd,
      transcript_path: input.transcript_path,
      input,
      has_result: result !== undefined,
      ...(result !== undefined ? { result } : {}),
      ...(error
        ? {
            error: {
              message: error instanceof Error ? error.message : String(error),
              ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
            },
          }
        : {}),
    };

    this._hookCalls.push(hookCall);

    if (process.env.DEBUG) {
      appendJsonLineInInstanceCache("hooks.jsonl", hookCall);
    }
  };
}

export const eventRecorder = new EventRecorder();
