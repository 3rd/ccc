import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { PromptLayerData } from "@/config/helpers";
import type { Context } from "@/context/Context";
import { loadPromptFile, mergePrompts } from "@/config/layers";
import { log } from "@/utils/log";

const loadCommandsFromPath = async (
  context: Context,
  dirPath: string,
): Promise<Map<string, PromptLayerData>> => {
  const commands = new Map<string, PromptLayerData>();
  if (!existsSync(dirPath)) return commands;
  const files = readdirSync(dirPath);

  // get command names
  const commandNames = new Set<string>();
  for (const file of files) {
    if (file.endsWith(".md") || file.endsWith(".ts")) {
      const name = file.replace(/\.(append\.md|md|ts)$/, "");
      commandNames.add(name);
    }
  }

  // load each command using the unified loader
  for (const name of commandNames) {
    const data = await loadPromptFile(context, join(dirPath, name));
    if (data) {
      commands.set(`${name}.md`, data);
    }
  }

  return commands;
};

export const buildCommands = async (context: Context): Promise<Map<string, string>> => {
  const commandLayers = new Map<string, PromptLayerData[]>();
  const overrides = new Set<string>();
  const launcherRoot = context.launcherDirectory;

  // load global commands
  const globalPath = join(launcherRoot, context.configDirectory, "global/commands");
  const globalCommands = await loadCommandsFromPath(context, globalPath);
  for (const [name, data] of globalCommands) {
    commandLayers.set(name, [data]);
  }

  // load preset commands
  for (const preset of context.project.presets) {
    const presetPath = join(launcherRoot, context.configDirectory, "presets", preset.name, "commands");
    const presetCommands = await loadCommandsFromPath(context, presetPath);

    for (const [name, data] of presetCommands) {
      if (commandLayers.has(name)) {
        const existing = commandLayers.get(name)!;

        if (data.mode === "override") {
          // override
          commandLayers.set(name, [data]);
          overrides.add(`${name} (preset: ${preset.name})`);
        } else {
          // append
          existing.push(data);
        }
      } else {
        commandLayers.set(name, [data]);
      }
    }
  }

  // load project commands
  if (context.project.projectConfig) {
    const projectPath = join(
      launcherRoot,
      context.configDirectory,
      "projects",
      context.project.projectConfig.name,
      "commands",
    );
    const projectCommands = await loadCommandsFromPath(context, projectPath);

    for (const [name, data] of projectCommands) {
      if (commandLayers.has(name)) {
        const existing = commandLayers.get(name)!;

        if (data.mode === "override") {
          // override
          commandLayers.set(name, [data]);
          overrides.add(`${name} (project: ${context.project.projectConfig.name})`);
        } else {
          // append
          existing.push(data);
        }
      } else {
        commandLayers.set(name, [data]);
      }
    }
  }

  // merge layers
  const commands = new Map<string, string>();
  for (const [name, layers] of commandLayers) {
    const merged = mergePrompts(...layers);
    commands.set(name, merged);
  }

  // load local project commands
  const localCommandsPath = join(context.workingDirectory, ".claude/commands");
  if (existsSync(localCommandsPath)) {
    const files = readdirSync(localCommandsPath);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = readFileSync(join(localCommandsPath, file), "utf8");
        commands.set(file, content);
      }
    }
  }

  // warn about overrides
  if (overrides.size > 0) {
    log.warn("COMMANDS", `Command overrides detected: ${Array.from(overrides).join(", ")}`);
  }

  return commands;
};
