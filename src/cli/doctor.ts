import { existsSync, readdirSync } from "fs";
import { join } from "path";
import p from "picoprint";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { HookCommand } from "@/types/hooks";
import type { ClaudeMCPConfig } from "@/types/mcps";
import { loadConfigFromLayers, loadConfigLayer, loadPromptFile } from "@/config/layers";
import { isHttpMCP, isSseMCP } from "@/types/mcps";

type LayerKind = "global" | "preset" | "project";

interface TraceEntry {
  layer: LayerKind;
  name?: string; // preset/project name
  mode: "append" | "override";
}

interface PromptTraces {
  system: TraceEntry[];
  user: TraceEntry[];
}

type ItemTraces = Record<string, TraceEntry[]>;

export interface DoctorReport {
  meta: {
    workingDirectory: string;
    configDirectory: string;
  };
  presets: string[];
  project: string | null;
  prompts: PromptTraces;
  commands: ItemTraces;
  agents: ItemTraces;
  mcps: Record<string, { type: "http" | "sse" | "stdio"; trace: TraceEntry[] }>;
  hooks: ItemTraces;
}

const listItemNames = (dirPath: string | undefined): string[] => {
  if (!dirPath || !existsSync(dirPath)) return [];
  const files = readdirSync(dirPath);
  const names = new Set<string>();
  for (const f of files) {
    if (f.endsWith(".md") || f.endsWith(".ts") || f.endsWith(".append.md")) {
      names.add(f.replace(/\.(append\.md|md|ts)$/u, ""));
    }
  }
  return Array.from(names).sort();
};

const collectPromptTrace = async (
  context: Context,
  which: "prompts/system" | "prompts/user",
): Promise<TraceEntry[]> => {
  const trace: TraceEntry[] = [];
  const global = await loadConfigLayer<PromptLayerData>(context, "global", undefined, which);
  if (global) trace.push({ layer: "global", mode: global.mode });
  for (const preset of context.project.presets) {
    const cfg = await loadConfigLayer<PromptLayerData>(context, "preset", preset.name, which);
    if (cfg) trace.push({ layer: "preset", name: preset.name, mode: cfg.mode });
  }
  if (context.project.projectConfig) {
    const project = await loadConfigLayer<PromptLayerData>(
      context,
      "project",
      context.project.projectConfig.name,
      which,
    );
    if (project) {
      trace.push({ layer: "project", name: context.project.projectConfig.name, mode: project.mode });
    }
  }
  return trace;
};

const collectLayeredItems = async (context: Context, kind: "agents" | "commands"): Promise<ItemTraces> => {
  const launcherRoot = context.launcherDirectory;
  const items: ItemTraces = {};

  const globalDir = join(launcherRoot, context.configDirectory, "global", kind);
  const globalNames = listItemNames(globalDir);

  const presetEntries = context.project.presets.map((preset) => ({
    name: preset.name,
    dir: join(launcherRoot, context.configDirectory, "presets", preset.name, kind),
  }));
  const presetNameMap = new Map<string, string[]>();
  for (const entry of presetEntries) presetNameMap.set(entry.name, listItemNames(entry.dir));

  const projectDir =
    context.project.projectConfig ?
      join(launcherRoot, context.configDirectory, "projects", context.project.projectConfig.name, kind)
    : undefined;
  const projectNames = listItemNames(projectDir);

  const allNames = new Set<string>([...globalNames, ...projectNames]);
  for (const pn of presetEntries) {
    for (const n of presetNameMap.get(pn.name) || []) allNames.add(n);
  }

  for (const name of Array.from(allNames).sort()) {
    const seq: TraceEntry[] = [];
    const tryPush = async (layer: LayerKind, dir: string | undefined, tag?: string) => {
      if (!dir) return;
      const data = await loadPromptFile(context, join(dir, name));
      if (data) seq.push({ layer, name: tag, mode: data.mode });
    };
    await tryPush("global", globalDir);
    for (const entry of presetEntries) await tryPush("preset", entry.dir, entry.name);
    await tryPush("project", projectDir, context.project.projectConfig?.name);
    items[name] = seq;
  }
  return items;
};

const getMCPType = (mcp: ClaudeMCPConfig): "http" | "sse" | "stdio" => {
  if (isHttpMCP(mcp)) return "http";
  if (isSseMCP(mcp)) return "sse";
  return "stdio";
};

const collectLayeredMCPs = async (
  context: Context,
  finalMCPs: Record<string, ClaudeMCPConfig>,
): Promise<Record<string, { type: "http" | "sse" | "stdio"; trace: TraceEntry[] }>> => {
  const items: Record<string, { type: "http" | "sse" | "stdio"; trace: TraceEntry[] }> = {};

  // load MCPs from all layers
  const layers = await loadConfigFromLayers<Record<string, ClaudeMCPConfig>>(context, "mcps.ts");

  // process global MCPs
  if (layers.global) {
    for (const mcpName of Object.keys(layers.global)) {
      const mcp = finalMCPs[mcpName];
      if (mcp) {
        items[mcpName] = { type: getMCPType(mcp), trace: [{ layer: "global", mode: "override" }] };
      }
    }
  }

  // process preset MCPs
  for (let i = 0; i < layers.presets.length; i++) {
    const preset = context.project.presets[i];
    const presetMCPs = layers.presets[i];
    if (presetMCPs && preset) {
      for (const mcpName of Object.keys(presetMCPs)) {
        const mcp = finalMCPs[mcpName];
        if (mcp) {
          items[mcpName] = { type: getMCPType(mcp), trace: [{ layer: "preset", name: preset.name, mode: "override" }] };
        }
      }
    }
  }

  // process project MCPs
  if (layers.project && context.project.projectConfig) {
    for (const mcpName of Object.keys(layers.project)) {
      const mcp = finalMCPs[mcpName];
      if (mcp) {
        items[mcpName] = {
          type: getMCPType(mcp),
          trace: [{ layer: "project", name: context.project.projectConfig.name, mode: "override" }],
        };
      }
    }
  }

  return items;
};

const collectLayeredHooks = async (context: Context): Promise<ItemTraces> => {
  const items: ItemTraces = {};

  // load hooks from all layers
  const hookLayers = await loadConfigFromLayers<Record<string, HookCommand[]>>(context, "hooks.ts");

  // process global hooks
  if (hookLayers.global) {
    for (const [eventType, hooks] of Object.entries(hookLayers.global)) {
      if (Array.isArray(hooks) && hooks.length > 0) {
        items[eventType] = [{ layer: "global", mode: "override" }];
      }
    }
  }

  // process preset hooks
  for (let i = 0; i < hookLayers.presets.length; i++) {
    const preset = context.project.presets[i];
    const presetHooks = hookLayers.presets[i];
    if (presetHooks && preset) {
      for (const [eventType, hooks] of Object.entries(presetHooks)) {
        if (Array.isArray(hooks) && hooks.length > 0) {
          if (!items[eventType]) {
            items[eventType] = [];
          }
          // hooks are merged (appended) from presets
          items[eventType].push({ layer: "preset", name: preset.name, mode: "append" });
        }
      }
    }
  }

  // process project hooks
  if (hookLayers.project && context.project.projectConfig) {
    for (const [eventType, hooks] of Object.entries(hookLayers.project)) {
      if (Array.isArray(hooks) && hooks.length > 0) {
        if (!items[eventType]) {
          items[eventType] = [];
        }
        // hooks are merged (appended) from project
        items[eventType].push({ layer: "project", name: context.project.projectConfig.name, mode: "append" });
      }
    }
  }

  return items;
};

const printPretty = (report: DoctorReport) => {
  const fmtTrace = (t: TraceEntry[]) => {
    if (t.length === 0) return "(none)";
    return t
      .map((e) => {
        const nameStr = e.name ? `:${e.name}` : "";
        const modeStr = e.mode === "append" ? " [append]" : "";
        return `${e.layer}${nameStr}${modeStr}`;
      })
      .join(" -> ");
  };

  // header
  p.bold.blue.log("\nGeneral:");
  p({
    "working dir": report.meta.workingDirectory,
    "config dir": report.meta.configDirectory,
  });

  // project
  p.bold.blue.log("\nProject:");
  p({
    presets: report.presets.length > 0 ? report.presets : "(none)",
    project: report.project ?? "(none)",
  });

  // prompts
  p.bold.blue.log("\nPrompts:");
  p({
    system: fmtTrace(report.prompts.system),
    user: fmtTrace(report.prompts.user),
  });

  // commands
  p.bold.blue.log("\nCommands:");
  const commandNames = Object.keys(report.commands).sort();
  if (commandNames.length === 0) {
    p.dim.log("(none)");
  } else {
    p(commandNames.map((name) => ({ name, trace: fmtTrace(report.commands[name] || []) })));
  }

  // agents
  p.bold.blue.log("\nAgents:");
  const agentNames = Object.keys(report.agents).sort();
  if (agentNames.length === 0) {
    p.dim.log("(none)");
  } else {
    p(agentNames.map((name) => ({ name, trace: fmtTrace(report.agents[name] || []) })));
  }

  // MCPs
  p.bold.blue.log("\nMCPs:");
  const mcpNames = Object.keys(report.mcps).sort();
  if (mcpNames.length === 0) {
    p.dim.log("(none)");
  } else {
    p(
      mcpNames.map((name) => {
        const mcp = report.mcps[name];
        return {
          name,
          type: mcp?.type || "stdio",
          trace: fmtTrace(mcp?.trace || []),
        };
      }),
    );
  }

  // hooks
  p.bold.blue.log("\nHooks:");
  const hookNames = Object.keys(report.hooks).sort();
  if (hookNames.length === 0) {
    p.dim.log("(none)");
  } else {
    p(hookNames.map((name) => ({ name, trace: fmtTrace(report.hooks[name] || []) })));
  }
};

export const runDoctor = async (
  context: Context,
  artifacts: {
    settings: Record<string, unknown>;
    systemPrompt: string;
    userPrompt: string;
    commands: Map<string, string>;
    agents: Map<string, string>;
    mcps: Record<string, ClaudeMCPConfig>;
  },
  opts: { json?: boolean } = {},
) => {
  const systemTrace = await collectPromptTrace(context, "prompts/system");
  const userTrace = await collectPromptTrace(context, "prompts/user");
  const commands = await collectLayeredItems(context, "commands");
  const agents = await collectLayeredItems(context, "agents");
  const hooks = await collectLayeredHooks(context);
  const mcps = await collectLayeredMCPs(context, artifacts.mcps);

  const report: DoctorReport = {
    meta: {
      workingDirectory: context.workingDirectory,
      configDirectory: context.configDirectory,
    },
    presets: context.project.presets.map((preset) => preset.name),
    project: context.project.projectConfig?.name ?? null,
    prompts: { system: systemTrace, user: userTrace },
    commands,
    agents,
    mcps,
    hooks,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPretty(report);
  }
};
