import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { FastMCPFactory, MCPLayerData } from "@/types/mcps";
import { log } from "@/utils/log";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mcpsMap = new Map<string, FastMCPFactory>();

let currentInstanceId: string | null = null;
let currentConfigDirectory = "config";

export const getMCP = (id: string) => mcpsMap.get(id);

const mcpIdFor = (factory: FastMCPFactory) =>
  `mcp_${createHash("sha256").update(factory.toString()).digest("hex").slice(0, 8)}`;

const getRunnerPath = () => {
  return join(dirname(__dirname), "cli", "runner.ts");
};

export const createMCP = (factory: FastMCPFactory): MCPLayerData => {
  const id = mcpIdFor(factory);
  mcpsMap.set(id, factory);
  return { type: "inline", config: factory };
};

export const generateMCPServer = (factory: FastMCPFactory): string => {
  const runnerPath = getRunnerPath();
  const id = mcpIdFor(factory);
  return `tsx ${runnerPath} mcp ${id}`;
};

export const setInstanceId = (instanceId: string, configDirectory = "config") => {
  currentInstanceId = instanceId;
  currentConfigDirectory = configDirectory;
  log.debug("MCPS", `Set instance ID: ${instanceId}, configDir=${configDirectory}`);
};

