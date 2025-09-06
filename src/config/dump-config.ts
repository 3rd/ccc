import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { Context } from "@/context/Context";
import { setupVirtualFileSystem } from "@/utils/virtual-fs";

export const dumpConfig = async (
  context: Context,
  config: {
    settings: Record<string, unknown>;
    systemPrompt: string;
    userPrompt: string;
    commands: Map<string, string>;
    agents: Map<string, string>;
    mcps: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const dumpDir = path.join(process.cwd(), ".config-dump", timestamp);

  setupVirtualFileSystem({
    settings: config.settings,
    systemPrompt: config.systemPrompt,
    userPrompt: config.userPrompt,
    commands: config.commands,
    agents: config.agents,
    workingDirectory: context.workingDirectory,
    disableParentClaudeMds: context.project.projectConfig?.disableParentClaudeMds,
  });

  // vfs paths
  const settingsJsonPath = path.join(os.homedir(), ".claude", "settings.json");
  const outputStylePath = path.join(os.homedir(), ".claude", "output-styles", "custom.md");
  const claudeMdPath = path.join(os.homedir(), ".claude", "CLAUDE.md");
  const commandsPath = path.normalize(path.resolve(os.homedir(), ".claude", "commands"));
  const agentsPath = path.normalize(path.resolve(os.homedir(), ".claude", "agents"));

  // create dump directory
  await fs.mkdir(dumpDir, { recursive: true });
  await fs.mkdir(path.join(dumpDir, "commands"), { recursive: true });
  await fs.mkdir(path.join(dumpDir, "agents"), { recursive: true });

  // dump output style
  const systemContent = fsSync.readFileSync(outputStylePath, "utf8");
  await fs.writeFile(path.join(dumpDir, "system.md"), systemContent, "utf8");

  // dump CLAUDE.md
  const userContent = fsSync.readFileSync(claudeMdPath, "utf8");
  await fs.writeFile(path.join(dumpDir, "user.md"), userContent, "utf8");

  // dump settings.json
  const settingsContent = fsSync.readFileSync(settingsJsonPath, "utf8");
  await fs.writeFile(path.join(dumpDir, "settings.json"), settingsContent, "utf8");

  // dump commands
  if (fsSync.existsSync(commandsPath)) {
    const commandFiles = fsSync.readdirSync(commandsPath);
    for (const filename of commandFiles) {
      const filePath = path.join(commandsPath, filename);
      const content = fsSync.readFileSync(filePath, "utf8");
      await fs.writeFile(path.join(dumpDir, "commands", filename), content, "utf8");
    }
  }

  // dump agents
  if (fsSync.existsSync(agentsPath)) {
    const agentFiles = fsSync.readdirSync(agentsPath);
    for (const filename of agentFiles) {
      const filePath = path.join(agentsPath, filename);
      const content = fsSync.readFileSync(filePath, "utf8");
      await fs.writeFile(path.join(dumpDir, "agents", filename), content, "utf8");
    }
  }

  // dump mcps
  await fs.writeFile(path.join(dumpDir, "mcps.json"), JSON.stringify(config.mcps, null, 2), "utf8");

  // write metadata
  await fs.writeFile(
    path.join(dumpDir, "metadata.json"),
    JSON.stringify(
      {
        timestamp,
        workingDirectory: context.workingDirectory,
        launcherDirectory: context.launcherDirectory,
        instanceId: context.instanceId,
        configDirectory: context.configDirectory,
        paths: {
          settingsJsonPath,
          outputStylePath,
          claudeMdPath,
          commandsPath,
          agentsPath,
        },
        project: {
          rootDirectory: context.project.rootDirectory,
          tags: context.project.tags,
          presets: context.project.presets.map((preset) => preset.name),
          projectConfig: context.project.projectConfig,
        },
        fileCounts: {
          configCommands: config.commands?.size || 0,
          configAgents: config.agents?.size || 0,
          vfsCommands: fsSync.existsSync(commandsPath) ? fsSync.readdirSync(commandsPath).length : 0,
          vfsAgents: fsSync.existsSync(agentsPath) ? fsSync.readdirSync(agentsPath).length : 0,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(dumpDir);
};
