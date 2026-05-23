import { existsSync, readdirSync } from "fs";
import { join } from "path";
import p from "picoprint";
import type { PromptLayerData } from "@/config/helpers";
import type { PluginsConfig } from "@/config/plugins";
import type { Context } from "@/context/Context";
import type { HooksConfiguration } from "@/types/hooks";
import type { ClaudeMCPConfig } from "@/types/mcps";
import type { SkillBundle, SkillLayerMode } from "@/types/skills";
import type { WorkflowBuildResult } from "@/types/workflows";
import { buildPlugins } from "@/config/builders/build-plugins";
import {
  loadConfigFromLayers,
  loadConfigLayer,
  loadPromptFile,
  normalizeHooksConfiguration,
} from "@/config/layers";
import { isHttpMCP, isSseMCP } from "@/types/mcps";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";

type LayerKind = "global" | "plugin" | "preset" | "project";

interface TraceEntry {
  layer: LayerKind;
  name?: string;
  mode: SkillLayerMode;
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
  rules: ItemTraces;
  outputStyles: ItemTraces;
  workflows: ItemTraces;
  mcps: Record<string, { type: "http" | "sse" | "stdio"; trace: TraceEntry[] }>;
  hooks: ItemTraces;
  plugins: {
    ccc: ItemTraces;
    claude: {
      enabled: ItemTraces;
      pluginDirs: { trace: TraceEntry[]; dirs: string[] };
      marketplaces: ItemTraces;
    };
  };
  skills: ItemTraces;
  profiles: ItemTraces;
}

const listItemNames = (dirPath: string | undefined) => {
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

  const presetEntries = context.project.presets.map((preset) => {
    return {
      name: preset.name,
      dir: join(launcherRoot, context.configDirectory, "presets", preset.name, kind),
    };
  });
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

const getMCPType = (mcp: ClaudeMCPConfig) => {
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
          items[mcpName] = {
            type: getMCPType(mcp),
            trace: [{ layer: "preset", name: preset.name, mode: "override" }],
          };
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

  // load hooks from all layers. We use HooksConfiguration here so the
  // normalizer can strip disabled definitions/entries before we decide
  // whether a layer actually contributed anything for an event.
  const hookLayers = await loadConfigFromLayers<HooksConfiguration>(context, "hooks.ts");

  const eventTypesFor = (layer: HooksConfiguration | undefined): string[] => {
    if (!layer) return [];
    return Object.keys(normalizeHooksConfiguration(layer));
  };

  // process global hooks
  for (const eventType of eventTypesFor(hookLayers.global)) {
    items[eventType] = [{ layer: "global", mode: "override" }];
  }

  // process preset hooks
  for (let i = 0; i < hookLayers.presets.length; i++) {
    const preset = context.project.presets[i];
    const presetHooks = hookLayers.presets[i];
    if (!preset || !presetHooks) continue;
    for (const eventType of eventTypesFor(presetHooks)) {
      if (!items[eventType]) items[eventType] = [];
      items[eventType].push({ layer: "preset", name: preset.name, mode: "append" });
    }
  }

  // process project hooks
  if (hookLayers.project && context.project.projectConfig) {
    for (const eventType of eventTypesFor(hookLayers.project)) {
      if (!items[eventType]) items[eventType] = [];
      items[eventType].push({
        layer: "project",
        name: context.project.projectConfig.name,
        mode: "append",
      });
    }
  }

  return items;
};

const collectLayeredProfiles = async (context: Context): Promise<ItemTraces> => {
  const items: ItemTraces = {};
  const settingsLayers = await loadConfigFromLayers<Record<string, unknown>>(context, "settings.ts");

  const extractNames = (layer: Record<string, unknown> | undefined) => {
    if (!layer || typeof layer.profiles !== "object" || !layer.profiles) return [];
    return Object.keys(layer.profiles as Record<string, unknown>);
  };

  for (const name of extractNames(settingsLayers.global)) {
    items[name] = [{ layer: "global", mode: "override" }];
  }

  for (let i = 0; i < settingsLayers.presets.length; i++) {
    const preset = context.project.presets[i];
    if (!preset) continue;
    for (const name of extractNames(settingsLayers.presets[i])) {
      if (!items[name]) items[name] = [];
      items[name].push({ layer: "preset", name: preset.name, mode: "override" });
    }
  }

  if (settingsLayers.project && context.project.projectConfig) {
    for (const name of extractNames(settingsLayers.project)) {
      if (!items[name]) items[name] = [];
      items[name].push({ layer: "project", name: context.project.projectConfig.name, mode: "override" });
    }
  }

  return items;
};

const collectBuiltSkills = (skills: SkillBundle[] | undefined): ItemTraces => {
  const items: ItemTraces = {};
  for (const skill of skills ?? []) {
    items[skill.name] = skill.trace ?? [];
  }
  return items;
};

const collectBuiltWorkflows = (workflows: WorkflowBuildResult | undefined): ItemTraces => {
  const items: ItemTraces = {};
  if (!workflows) return items;

  for (const filename of workflows.files.keys()) {
    const name = filename.endsWith(".js") ? filename.slice(0, -3) : filename;
    items[name] = workflows.traces[filename] ?? [];
  }

  return items;
};

// per-category single-file-listings (last-write-wins or override semantics)
const listFlatNames = (dirPath: string | undefined, extensions: string[]) => {
  if (!dirPath || !existsSync(dirPath)) return [];
  const files = readdirSync(dirPath);
  const names = new Set<string>();
  for (const f of files) {
    if (f.startsWith(".")) continue;
    for (const ext of extensions) {
      if (f.endsWith(ext)) {
        names.add(f.slice(0, -ext.length));
        break;
      }
    }
  }
  return Array.from(names).sort();
};

const collectFlatLayered = (context: Context, category: string, extensions: string[]): ItemTraces => {
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);
  const items: ItemTraces = {};

  const globalDir = join(configBase, "global", category);
  const globalNames = listFlatNames(globalDir, extensions);

  const presetEntries = context.project.presets.map((preset) => {
    return {
      name: preset.name,
      dir: join(configBase, "presets", preset.name, category),
    };
  });
  const presetNameMap = new Map<string, string[]>();
  for (const entry of presetEntries) presetNameMap.set(entry.name, listFlatNames(entry.dir, extensions));

  const projectDir =
    context.project.projectConfig ?
      join(configBase, "projects", context.project.projectConfig.name, category)
    : undefined;
  const projectNames = listFlatNames(projectDir, extensions);

  const allNames = new Set<string>([...globalNames, ...projectNames]);
  for (const pn of presetEntries) {
    for (const n of presetNameMap.get(pn.name) || []) allNames.add(n);
  }

  for (const name of Array.from(allNames).sort()) {
    const seq: TraceEntry[] = [];
    if (globalNames.includes(name)) seq.push({ layer: "global", mode: "override" });
    for (const entry of presetEntries) {
      if ((presetNameMap.get(entry.name) || []).includes(name)) {
        seq.push({ layer: "preset", name: entry.name, mode: "override" });
      }
    }
    if (projectNames.includes(name) && context.project.projectConfig) {
      seq.push({ layer: "project", name: context.project.projectConfig.name, mode: "override" });
    }
    items[name] = seq;
  }
  return items;
};

const listRuleNames = (dirPath: string | undefined) => {
  if (!dirPath || !existsSync(dirPath)) return [];
  const names: string[] = [];

  const walkDir = (currentPath: string, relativePath = ""): void => {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relativePath ? join(relativePath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walkDir(join(currentPath, entry.name), relPath);
      } else if (entry.name.endsWith(".md")) {
        names.push(relPath);
      }
    }
  };

  walkDir(dirPath);
  return names.sort();
};

const collectLayeredRules = async (context: Context): Promise<ItemTraces> => {
  const items: ItemTraces = {};

  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);

  const globalDir = join(configBase, "global", "rules");
  const globalNames = listRuleNames(globalDir);

  const presetEntries = context.project.presets.map((preset) => {
    return {
      name: preset.name,
      dir: join(configBase, "presets", preset.name, "rules"),
    };
  });
  const presetNameMap = new Map<string, string[]>();
  for (const entry of presetEntries) presetNameMap.set(entry.name, listRuleNames(entry.dir));

  const projectDir =
    context.project.projectConfig ?
      join(configBase, "projects", context.project.projectConfig.name, "rules")
    : undefined;
  const projectNames = listRuleNames(projectDir);

  const allNames = new Set<string>([...globalNames, ...projectNames]);
  for (const pn of presetEntries) {
    for (const n of presetNameMap.get(pn.name) || []) allNames.add(n);
  }

  for (const name of Array.from(allNames).sort()) {
    const seq: TraceEntry[] = [];
    // rules accumulate (no override), so we just track where they come from
    if (globalNames.includes(name)) seq.push({ layer: "global", mode: "append" });
    for (const entry of presetEntries) {
      if ((presetNameMap.get(entry.name) || []).includes(name)) {
        seq.push({ layer: "preset", name: entry.name, mode: "append" });
      }
    }
    if (projectNames.includes(name) && context.project.projectConfig) {
      seq.push({ layer: "project", name: context.project.projectConfig.name, mode: "append" });
    }
    items[name] = seq;
  }

  return items;
};

const collectLayeredPlugins = async (context: Context) => {
  const layers = await loadConfigFromLayers<PluginsConfig>(context, "plugins.ts");
  const ccc: ItemTraces = {};
  const enabled: ItemTraces = {};
  const marketplaces: ItemTraces = {};
  const pluginDirsTrace: TraceEntry[] = [];

  const pushTrace = (traces: ItemTraces, key: string, entry: TraceEntry) => {
    const existing = traces[key] ?? [];
    traces[key] = [...existing, entry];
  };

  const applyLayer = (layer: PluginsConfig | undefined, entry: TraceEntry) => {
    if (!layer) return;
    if (layer.ccc) {
      for (const name of Object.keys(layer.ccc)) {
        pushTrace(ccc, name, entry);
      }
    }
    if (layer.claude?.enabledPlugins) {
      for (const name of Object.keys(layer.claude.enabledPlugins)) {
        pushTrace(enabled, name, entry);
      }
    }
    if (layer.claude?.extraKnownMarketplaces) {
      for (const name of Object.keys(layer.claude.extraKnownMarketplaces)) {
        pushTrace(marketplaces, name, entry);
      }
    }
    if (layer.claude?.pluginDirs) {
      pluginDirsTrace.push(entry);
    }
  };

  applyLayer(layers.global, { layer: "global", mode: "override" });
  for (let i = 0; i < layers.presets.length; i++) {
    const preset = context.project.presets[i];
    if (preset) {
      applyLayer(layers.presets[i], { layer: "preset", name: preset.name, mode: "override" });
    }
  }
  if (context.project.projectConfig) {
    applyLayer(layers.project, {
      layer: "project",
      name: context.project.projectConfig.name,
      mode: "override",
    });
  }

  // use buildPlugins to get actual resolved dirs (includes auto-discovery)
  const builtPlugins = await buildPlugins(context);
  const pluginDirs = builtPlugins.claude?.pluginDirs ?? [];

  return { ccc, enabled, marketplaces, pluginDirs, pluginDirsTrace };
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
  p.color.bold.blue.log("\nGeneral:");
  p({
    "working dir": report.meta.workingDirectory,
    "config dir": report.meta.configDirectory,
  });

  // project
  p.color.bold.blue.log("\nProject:");
  p({
    presets: report.presets.length > 0 ? report.presets : "(none)",
    project: report.project ?? "(none)",
  });

  // prompts
  p.color.bold.blue.log("\nPrompts:");
  p({
    system: fmtTrace(report.prompts.system),
    user: fmtTrace(report.prompts.user),
  });

  // commands
  p.color.bold.blue.log("\nCommands:");
  const commandNames = Object.keys(report.commands).sort();
  if (commandNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(commandNames.map((name) => ({ name, trace: fmtTrace(report.commands[name] || []) })));
  }

  // agents
  p.color.bold.blue.log("\nAgents:");
  const agentNames = Object.keys(report.agents).sort();
  if (agentNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(agentNames.map((name) => ({ name, trace: fmtTrace(report.agents[name] || []) })));
  }

  // rules
  p.color.bold.blue.log("\nRules:");
  const ruleNames = Object.keys(report.rules).sort();
  if (ruleNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(ruleNames.map((name) => ({ name, trace: fmtTrace(report.rules[name] || []) })));
  }

  // output styles
  p.color.bold.blue.log("\nOutput Styles:");
  const outputStyleNames = Object.keys(report.outputStyles).sort();
  if (outputStyleNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(outputStyleNames.map((name) => ({ name, trace: fmtTrace(report.outputStyles[name] || []) })));
  }

  // workflows
  p.color.bold.blue.log("\nWorkflows:");
  const workflowNames = Object.keys(report.workflows).sort();
  if (workflowNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(workflowNames.map((name) => ({ name, trace: fmtTrace(report.workflows[name] || []) })));
  }

  // MCPs
  p.color.bold.blue.log("\nMCPs:");
  const mcpNames = Object.keys(report.mcps).sort();
  if (mcpNames.length === 0) {
    p.color.dim.log("(none)");
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
  p.color.bold.blue.log("\nHooks:");
  const hookNames = Object.keys(report.hooks).sort();
  if (hookNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(hookNames.map((name) => ({ name, trace: fmtTrace(report.hooks[name] || []) })));
  }

  // plugins
  p.color.bold.blue.log("\nPlugins:");
  p.color.bold.blue.log("CCC Plugins:");
  const cccNames = Object.keys(report.plugins.ccc).sort();
  if (cccNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(cccNames.map((name) => ({ name, trace: fmtTrace(report.plugins.ccc[name] || []) })));
  }

  p.color.bold.blue.log("Claude Plugins (enabledPlugins):");
  const enabledNames = Object.keys(report.plugins.claude.enabled).sort();
  if (enabledNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(enabledNames.map((name) => ({ name, trace: fmtTrace(report.plugins.claude.enabled[name] || []) })));
  }

  p.color.bold.blue.log("Claude Plugins (pluginDirs):");
  if (report.plugins.claude.pluginDirs.dirs.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p({
      dirs: report.plugins.claude.pluginDirs.dirs,
      trace: fmtTrace(report.plugins.claude.pluginDirs.trace),
    });
  }

  p.color.bold.blue.log("Claude Plugins (marketplaces):");
  const marketplaceNames = Object.keys(report.plugins.claude.marketplaces).sort();
  if (marketplaceNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(
      marketplaceNames.map((name) => {
        return {
          name,
          trace: fmtTrace(report.plugins.claude.marketplaces[name] || []),
        };
      }),
    );
  }

  // skills
  p.color.bold.blue.log("\nSkills:");
  const skillNames = Object.keys(report.skills).sort();
  if (skillNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(skillNames.map((name) => ({ name, trace: fmtTrace(report.skills[name] || []) })));
  }

  // profiles
  p.color.bold.blue.log("\nProfiles:");
  const profileNames = Object.keys(report.profiles).sort();
  if (profileNames.length === 0) {
    p.color.dim.log("(none)");
  } else {
    p(profileNames.map((name) => ({ name, trace: fmtTrace(report.profiles[name] || []) })));
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
    skills?: SkillBundle[];
    rules?: Map<string, string>;
    outputStyles?: Map<string, string>;
    workflows?: WorkflowBuildResult;
  },
  opts: { json?: boolean } = {},
) => {
  const systemTrace = await collectPromptTrace(context, "prompts/system");
  const userTrace = await collectPromptTrace(context, "prompts/user");
  const commands = await collectLayeredItems(context, "commands");
  const agents = await collectLayeredItems(context, "agents");
  const rules = await collectLayeredRules(context);
  const outputStyles = collectFlatLayered(context, "output-styles", [".md"]);
  const workflows = collectBuiltWorkflows(artifacts.workflows);
  const hooks = await collectLayeredHooks(context);
  const mcps = await collectLayeredMCPs(context, artifacts.mcps);
  const skills = collectBuiltSkills(artifacts.skills);
  const profiles = await collectLayeredProfiles(context);
  const pluginReport = await collectLayeredPlugins(context);

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
    rules,
    outputStyles,
    workflows,
    mcps,
    hooks,
    plugins: {
      ccc: pluginReport.ccc,
      claude: {
        enabled: pluginReport.enabled,
        pluginDirs: { trace: pluginReport.pluginDirsTrace, dirs: pluginReport.pluginDirs },
        marketplaces: pluginReport.marketplaces,
      },
    },
    skills,
    profiles,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPretty(report);
  }
};
