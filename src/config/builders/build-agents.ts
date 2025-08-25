import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import { loadPromptFile, mergePrompts } from "@/config/layers";
import { log } from "@/utils/log";

const loadAgentsFromPath = async (
  context: Context,
  dirPath: string,
): Promise<Map<string, PromptLayerData>> => {
  const agents = new Map<string, PromptLayerData>();
  if (!existsSync(dirPath)) return agents;
  const files = readdirSync(dirPath);

  // get agent names
  const agentNames = new Set<string>();
  for (const file of files) {
    if (file.endsWith(".md") || file.endsWith(".ts")) {
      const name = file.replace(/\.(append\.md|md|ts)$/, "");
      agentNames.add(name);
    }
  }

  // load each agent using the unified loader
  for (const name of agentNames) {
    const data = await loadPromptFile(context, join(dirPath, name));
    if (data) {
      agents.set(`${name}.md`, data);
    }
  }

  return agents;
};

export const buildAgents = async (context: Context): Promise<Map<string, string>> => {
  const agentLayers = new Map<string, PromptLayerData[]>();
  const overrides = new Set<string>();
  const launcherRoot = context.launcherDirectory;

  // load global agents
  const globalPath = join(launcherRoot, context.configDirectory, "global/agents");
  const globalAgents = await loadAgentsFromPath(context, globalPath);
  for (const [name, data] of globalAgents) {
    agentLayers.set(name, [data]);
  }

  // load preset agents
  for (const preset of context.project.presets) {
    const presetPath = join(launcherRoot, context.configDirectory, "presets", preset.name, "agents");
    const presetAgents = await loadAgentsFromPath(context, presetPath);

    for (const [name, data] of presetAgents) {
      if (agentLayers.has(name)) {
        const existing = agentLayers.get(name)!;

        if (data.mode === "override") {
          // override
          agentLayers.set(name, [data]);
          overrides.add(`${name} (preset: ${preset.name})`);
        } else {
          // append
          existing.push(data);
        }
      } else {
        agentLayers.set(name, [data]);
      }
    }
  }

  // load project agents
  if (context.project.projectConfig) {
    const projectPath = join(
      launcherRoot,
      context.configDirectory,
      "projects",
      context.project.projectConfig.name,
      "agents",
    );
    const projectAgents = await loadAgentsFromPath(context, projectPath);

    for (const [name, data] of projectAgents) {
      if (agentLayers.has(name)) {
        const existing = agentLayers.get(name)!;

        if (data.mode === "override") {
          // override
          agentLayers.set(name, [data]);
          overrides.add(`${name} (project: ${context.project.projectConfig.name})`);
        } else {
          // append
          existing.push(data);
        }
      } else {
        agentLayers.set(name, [data]);
      }
    }
  }

  // merge layers
  const agents = new Map<string, string>();
  for (const [name, layers] of agentLayers) {
    const merged = mergePrompts(...layers);
    agents.set(name, merged);
  }

  // warn about overrides
  if (overrides.size > 0) {
    log.warn("AGENTS", `Agent overrides detected: ${Array.from(overrides).join(", ")}`);
  }

  return agents;
};
