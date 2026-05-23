import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { Context } from "@/context/Context";
import type { SkillBundle } from "@/types/skills";
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
    skills?: SkillBundle[];
    rules?: Map<string, string>;
    outputStyles?: Map<string, string>;
    workflows?: Map<string, string>;
  },
) => {
  const timestamp = new Date().toISOString();
  const dumpDir = path.join(process.cwd(), ".config-dump", timestamp);

  setupVirtualFileSystem({
    settings: config.settings,
    userPrompt: config.userPrompt,
    commands: config.commands,
    agents: config.agents,
    skills: config.skills,
    rules: config.rules,
    outputStyles: config.outputStyles,
    workflows: config.workflows,
    workingDirectory: context.workingDirectory,
    disableParentClaudeMds: context.project.projectConfig?.disableParentClaudeMds,
  });

  // vfs paths
  const settingsJsonPath = path.join(os.homedir(), ".claude", "settings.json");
  const claudeMdPath = path.join(os.homedir(), ".claude", "CLAUDE.md");
  const commandsPath = path.normalize(path.resolve(os.homedir(), ".claude", "commands"));
  const agentsPath = path.normalize(path.resolve(os.homedir(), ".claude", "agents"));
  const skillsPath = path.normalize(path.resolve(os.homedir(), ".claude", "skills"));
  const rulesPath = path.normalize(path.resolve(os.homedir(), ".claude", "rules"));
  const outputStylesPath = path.normalize(path.resolve(os.homedir(), ".claude", "output-styles"));
  const workflowsPath = path.normalize(path.resolve(os.homedir(), ".claude", "workflows"));

  // create dump directory
  await fs.mkdir(dumpDir, { recursive: true });
  await fs.mkdir(path.join(dumpDir, "commands"), { recursive: true });
  await fs.mkdir(path.join(dumpDir, "agents"), { recursive: true });
  await fs.mkdir(path.join(dumpDir, "skills"), { recursive: true });
  await fs.mkdir(path.join(dumpDir, "rules"), { recursive: true });
  await fs.mkdir(path.join(dumpDir, "output-styles"), { recursive: true });
  await fs.mkdir(path.join(dumpDir, "workflows"), { recursive: true });

  await fs.writeFile(path.join(dumpDir, "system.md"), config.systemPrompt, "utf8");

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

  const copyDirRecursive = (srcDir: string, destDir: string) => {
    if (!fsSync.existsSync(srcDir)) return;
    fsSync.mkdirSync(destDir, { recursive: true });
    const entries = fsSync.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        const content = fsSync.readFileSync(srcPath);
        fsSync.writeFileSync(destPath, content);
      }
    }
  };

  // dump skills
  if (fsSync.existsSync(skillsPath)) {
    copyDirRecursive(skillsPath, path.join(dumpDir, "skills"));
  }

  // dump rules (may include subdirectories)
  if (fsSync.existsSync(rulesPath)) {
    copyDirRecursive(rulesPath, path.join(dumpDir, "rules"));
  }

  // dump output styles (flat .md)
  if (fsSync.existsSync(outputStylesPath)) {
    const outputStyleFiles = fsSync.readdirSync(outputStylesPath);
    for (const filename of outputStyleFiles) {
      const filePath = path.join(outputStylesPath, filename);
      const content = fsSync.readFileSync(filePath, "utf8");
      await fs.writeFile(path.join(dumpDir, "output-styles", filename), content, "utf8");
    }
  }

  // dump workflows (flat .js)
  if (fsSync.existsSync(workflowsPath)) {
    const workflowFiles = fsSync.readdirSync(workflowsPath);
    for (const filename of workflowFiles) {
      const filePath = path.join(workflowsPath, filename);
      const content = fsSync.readFileSync(filePath, "utf8");
      await fs.writeFile(path.join(dumpDir, "workflows", filename), content, "utf8");
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
          claudeMdPath,
          commandsPath,
          agentsPath,
          skillsPath,
          rulesPath,
          outputStylesPath,
          workflowsPath,
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
          configSkills: config.skills?.length || 0,
          configRules: config.rules?.size || 0,
          configOutputStyles: config.outputStyles?.size || 0,
          configWorkflows: config.workflows?.size || 0,
          vfsCommands: fsSync.existsSync(commandsPath) ? fsSync.readdirSync(commandsPath).length : 0,
          vfsAgents: fsSync.existsSync(agentsPath) ? fsSync.readdirSync(agentsPath).length : 0,
          vfsSkills: fsSync.existsSync(skillsPath) ? fsSync.readdirSync(skillsPath).length : 0,
          vfsRules: fsSync.existsSync(rulesPath) ? fsSync.readdirSync(rulesPath).length : 0,
          vfsOutputStyles:
            fsSync.existsSync(outputStylesPath) ? fsSync.readdirSync(outputStylesPath).length : 0,
          vfsWorkflows: fsSync.existsSync(workflowsPath) ? fsSync.readdirSync(workflowsPath).length : 0,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(dumpDir);
};
