import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ClaudeHookInput } from "@/types/hooks";

export interface RecordedEvent {
  timestamp: string;
  hook_event_name: ClaudeHookInput["hook_event_name"];
  session_id: string;
  cwd: string;
  transcript_path: string;
  input: ClaudeHookInput;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EventRecorder {
  private _events: RecordedEvent[] = [];

  get events(): readonly RecordedEvent[] {
    return this._events;
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

    if (process.env.DEBUG) {
      try {
        const instanceId = process.env.CCC_INSTANCE_ID;
        if (!instanceId) {
          console.error("Event recording failed: CCC_INSTANCE_ID is not set");
          return;
        }

        const rootDir = path.dirname(path.dirname(__dirname));
        const cacheDir = path.join(rootDir, ".cache", instanceId);
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        const filePath = path.join(cacheDir, "events.jsonl");

        fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
      } catch {}
    }
  };
}

export const eventRecorder = new EventRecorder();
