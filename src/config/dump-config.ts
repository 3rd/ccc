import * as fs from "fs/promises";
import * as path from "path";
import type { Context } from "@/context/Context";
import {
  prepareVirtualFileSystem,
  resolveVirtualFileSystemPaths,
  type VirtualFileSystemOptions,
} from "@/utils/virtual-fs";

const isInsideDirectory = (directory: string, filePath: string) => {
  const relativePath = path.relative(directory, filePath);
  const isOutside = relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
  return relativePath !== "" && !isOutside;
};

const REDACTED_VALUE = "[redacted]";
const SECRET_NAME_PATTERN = /token|key|secret|password|auth|credential|cookie/i;
const CCC_MANAGED_CLAUDE_STATE_KEYS = ["cachedGrowthBookFeatures"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactSecretValues = (values: unknown) => {
  if (!isRecord(values)) return values;

  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, SECRET_NAME_PATTERN.test(name) ? REDACTED_VALUE : value]),
  );
};

const parseJsonObject = (json: string, label: string) => {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) {
    throw new Error(`--dump-config expected ${label} to be a JSON object`);
  }

  return value;
};

const redactSettingsJson = (settingsJson: string) => {
  const settings = parseJsonObject(settingsJson, "settings.json");
  if (settings.env === undefined) return settingsJson;

  return JSON.stringify({ ...settings, env: redactSecretValues(settings.env) }, null, 2);
};

const selectManagedClaudeState = (claudeStateJson: string, claudeStateKeys: string[]) => {
  const managedKeys = new Set([...CCC_MANAGED_CLAUDE_STATE_KEYS, ...claudeStateKeys]);
  const managedState = Object.fromEntries(
    Object.entries(parseJsonObject(claudeStateJson, "~/.claude.json")).filter(([key]) => managedKeys.has(key)),
  );
  return `${JSON.stringify(redactSecretValues(managedState), null, 2)}\n`;
};

const redactServerSecrets = (server: unknown) => {
  if (!isRecord(server)) return server;

  return {
    ...server,
    ...(server.env !== undefined && { env: redactSecretValues(server.env) }),
    ...(server.headers !== undefined && { headers: redactSecretValues(server.headers) }),
  };
};

const countTopLevelEntries = (directory: string, filePaths: string[]) => {
  const entries = new Set<string>();
  for (const filePath of filePaths) {
    if (!isInsideDirectory(directory, filePath)) continue;

    const relativePath = path.relative(directory, filePath);
    const separatorIndex = relativePath.indexOf(path.sep);
    entries.add(separatorIndex === -1 ? relativePath : relativePath.slice(0, separatorIndex));
  }

  return entries.size;
};

export const dumpConfig = async (
  context: Context,
  config: {
    virtualFileSystem: VirtualFileSystemOptions;
    systemPrompt: string;
    mcps: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const dumpRoot = path.join(process.cwd(), ".config-dump");
  const dumpDir = path.join(dumpRoot, timestamp);

  // vfs paths
  const paths = resolveVirtualFileSystemPaths();
  const prepared = prepareVirtualFileSystem(config.virtualFileSystem);

  const dumpPathsByVirtualFile = new Map([
    [paths.claudeMdPath, path.join(dumpDir, "user.md")],
    [paths.settingsJsonPath, path.join(dumpDir, "settings.json")],
    [paths.claudeStatePath, path.join(dumpDir, "claude.json")],
  ]);
  const dumpDirectoriesByVirtualRoot = new Map([
    [paths.commandsPath, path.join(dumpDir, "commands")],
    [paths.agentsPath, path.join(dumpDir, "agents")],
    [paths.skillsPath, path.join(dumpDir, "skills")],
    [paths.rulesPath, path.join(dumpDir, "rules")],
    [paths.outputStylesPath, path.join(dumpDir, "output-styles")],
    [paths.workflowsPath, path.join(dumpDir, "workflows")],
  ]);

  const resolveDumpPath = (virtualPath: string) => {
    const dumpPath = dumpPathsByVirtualFile.get(virtualPath);
    if (dumpPath) return dumpPath;

    for (const [virtualRoot, dumpDirectory] of dumpDirectoriesByVirtualRoot) {
      if (isInsideDirectory(virtualRoot, virtualPath)) {
        return path.join(dumpDirectory, path.relative(virtualRoot, virtualPath));
      }
    }

    throw new Error(`--dump-config has no dump location for virtual file ${virtualPath}`);
  };

  const claudeStateOverrides = config.virtualFileSystem.settings.claudeState;
  const claudeStateKeys = isRecord(claudeStateOverrides) ? Object.keys(claudeStateOverrides) : [];

  const redactDumpContent = (virtualPath: string, content: string) => {
    if (virtualPath === paths.settingsJsonPath) return redactSettingsJson(content);
    if (virtualPath === paths.claudeStatePath) return selectManagedClaudeState(content, claudeStateKeys);

    return content;
  };

  const dumpFiles = prepared.files.map((file) => ({
    dumpPath: resolveDumpPath(file.path),
    content: redactDumpContent(file.path, file.content),
  }));

  // create dump directory
  for (const dumpDirectory of dumpDirectoriesByVirtualRoot.values()) {
    await fs.mkdir(dumpDirectory, { recursive: true });
  }

  await fs.writeFile(path.join(dumpRoot, ".gitignore"), "*\n", "utf8");

  await fs.writeFile(path.join(dumpDir, "system.md"), config.systemPrompt, "utf8");

  for (const file of dumpFiles) {
    await fs.mkdir(path.dirname(file.dumpPath), { recursive: true });
    await fs.writeFile(file.dumpPath, file.content, "utf8");
  }

  // dump mcps
  const redactedMcps = Object.fromEntries(
    Object.entries(config.mcps).map(([name, server]) => [name, redactServerSecrets(server)]),
  );
  await fs.writeFile(path.join(dumpDir, "mcps.json"), JSON.stringify(redactedMcps, null, 2), "utf8");

  // write metadata
  const virtualFilePaths = prepared.files.map((file) => file.path);
  const options = config.virtualFileSystem;
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
          claudeStatePath: paths.claudeStatePath,
          settingsJsonPath: paths.settingsJsonPath,
          claudeMdPath: paths.claudeMdPath,
          commandsPath: paths.commandsPath,
          agentsPath: paths.agentsPath,
          skillsPath: paths.skillsPath,
          rulesPath: paths.rulesPath,
          outputStylesPath: paths.outputStylesPath,
          workflowsPath: paths.workflowsPath,
        },
        project: {
          rootDirectory: context.project.rootDirectory,
          tags: context.project.tags,
          presets: context.project.presets.map((preset) => preset.name),
          projectConfig: context.project.projectConfig,
        },
        fileCounts: {
          configCommands: options.commands?.size ?? 0,
          configAgents: options.agents?.size ?? 0,
          configSkills: options.skills?.length ?? 0,
          configRules: options.rules?.size ?? 0,
          configOutputStyles: options.outputStyles?.size ?? 0,
          configWorkflows: options.workflows?.size ?? 0,
          vfsCommands: countTopLevelEntries(paths.commandsPath, virtualFilePaths),
          vfsAgents: countTopLevelEntries(paths.agentsPath, virtualFilePaths),
          vfsSkills: countTopLevelEntries(paths.skillsPath, virtualFilePaths),
          vfsRules: countTopLevelEntries(paths.rulesPath, virtualFilePaths),
          vfsOutputStyles: countTopLevelEntries(paths.outputStylesPath, virtualFilePaths),
          vfsWorkflows: countTopLevelEntries(paths.workflowsPath, virtualFilePaths),
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(dumpDir);
};
