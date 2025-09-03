import { existsSync, readdirSync } from "fs";
import { join } from "path";
import p from "picoprint";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import type { ClaudeMCPConfig } from "@/types/mcps";
import { loadConfigLayer, loadPromptFile } from "@/config/layers";
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
  mcps: { name: string; type: "http" | "sse" | "stdio" }[];
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

  const section = (title: string, render: () => void) =>
    p.box(
      () => {
        render();
      },
      { title, style: "rounded", color: p.cyan },
    );

  // header
  p.bold.blue.log("\nGeneral:");
  p({
    "working dir": report.meta.workingDirectory,
    "config dir": report.meta.configDirectory,
  });

  // project
  p.bold.blue.log("\nProject:");
  p({
    presets: report.presets.length > 0 ? report.presets.join(", ") : "(none)",
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
  const mcps = report.mcps;
  if (mcps.length === 0) {
    p.dim.log("(none)");
  } else {
    p(mcps.map((m) => ({ name: m.name, type: m.type })));
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
  const mcps = Object.entries(artifacts.mcps || {})
    .map(([name, cfg]) => {
      if (isHttpMCP(cfg)) {
        return { name, type: "http" as const };
      }
      if (isSseMCP(cfg)) {
        return { name, type: "sse" as const };
      }
      return { name, type: "stdio" as const };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

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
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPretty(report);
  }
};
