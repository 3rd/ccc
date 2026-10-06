import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createConfigMCPs, createMCP } from "@/config/helpers";
import { getSessionContext } from "@/hooks/session-context";

// Example: Session-aware MCP that provides context-aware tools
const sessionInfoMCP = createMCP((_context) => {
  const server = new FastMCP({
    name: "session-info",
    version: "1.0.0",
    instructions: "Provides session context information and event history",
  });

  server.addTool({
    name: "getSessionInfo",
    description: "Get current session ID and event statistics",
    parameters: z.object({
      includeEvents: z.boolean().optional().describe("Include full event list"),
    }),
    execute: async (args) => {
      const sessionContext = getSessionContext();
      const eventCounts: Record<string, number> = {};
      
      sessionContext.events.forEach((event) => {
        eventCounts[event.hook_event_name] = (eventCounts[event.hook_event_name] || 0) + 1;
      });

      const response = {
        sessionId: sessionContext.id,
        totalEvents: sessionContext.events.length,
        eventCounts,
        ...(args.includeEvents && { events: sessionContext.events }),
      };

      return JSON.stringify(response, null, 2);
    },
  });

  server.addTool({
    name: "getToolHistory",
    description: "Get history of tools used in this session",
    parameters: z.object({}),
    execute: async () => {
      const sessionContext = getSessionContext();
      const toolUsage = sessionContext.events
        .filter((e) => e.hook_event_name === "PreToolUse")
        .map((e) => ({
          timestamp: e.timestamp,
          tool: (e.input as any).tool_name,
        }));

      return JSON.stringify(toolUsage, null, 2);
    },
  });

  return server;
});

export default createConfigMCPs({
  "session-info": sessionInfoMCP,
});
