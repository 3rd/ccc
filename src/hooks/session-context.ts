import * as fs from "fs";
import { eventRecorder, type RecordedEvent } from "@/hooks/event-recorder";

export interface SessionContext {
  id: string;
  events: readonly RecordedEvent[];
}

const extractSessionId = (events: readonly RecordedEvent[]): string | null => {
  const sessionStart = events.find((e) => e.hook_event_name === "SessionStart");
  return sessionStart?.session_id || null;
};

const loadEventsFromDisk = (): RecordedEvent[] => {
  const eventsFile = process.env.CCC_EVENTS_FILE;
  if (!eventsFile) return [];

  try {
    if (!fs.existsSync(eventsFile)) return [];

    const content = fs.readFileSync(eventsFile, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

export const getSessionContext = (): SessionContext => {
  let events = eventRecorder.events;
  if (events.length === 0 && process.env.CCC_EVENTS_FILE) {
    events = loadEventsFromDisk();
  }

  const sessionId = extractSessionId(events) || "unknown";

  return {
    id: sessionId,
    events,
  };
};
