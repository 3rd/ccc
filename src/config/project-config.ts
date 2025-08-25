import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HooksConfiguration } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import type { PromptFunction } from "@/types/presets";
import type { ProjectConfig, ProjectMetadata } from "@/types/project";
import type { ClaudeSettings } from "@/types/settings";
import { loadModuleDefault } from "@/utils/module-loader";
import { expandPath } from "@/utils/path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const findProjectConfigDir = async (workingDir: string, configDirectory: string) => {
  const launcherRoot = dirname(dirname(__dirname));
  const projectsDir = join(launcherRoot, configDirectory, "projects");

  if (!existsSync(projectsDir)) return null;

  const entries = readdirSync(projectsDir, { withFileTypes: true });

  let bestMatch: { dir: string; rootLength: number } | null = null;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectDir = join(projectsDir, entry.name);
    const projectFile = join(projectDir, "index.ts");

    if (!existsSync(projectFile)) continue;

    try {
      const metadata = await loadModuleDefault<ProjectMetadata>(projectFile);
      if (!metadata?.root) continue;

      const projectRoot = expandPath(metadata.root);
      const resolvedWorkingDir = resolve(workingDir);

      if (
        resolvedWorkingDir.startsWith(projectRoot) &&
        (!bestMatch || projectRoot.length > bestMatch.rootLength)
      ) {
        bestMatch = { dir: projectDir, rootLength: projectRoot.length };
      }
    } catch (error) {
      console.warn(`Failed to check project ${entry.name}:`, error);
    }
  }

  return bestMatch?.dir || null;
};

export const loadProjectConfig = async (projectDir: string): Promise<ProjectConfig | null> => {
  try {
    const metadata = await loadModuleDefault<ProjectMetadata>(join(projectDir, "index.ts"));
    if (!metadata) {
      console.warn(`No index.ts found in ${projectDir}`);
      return null;
    }

    const projectSettingsPath = join(projectDir, "settings.ts");
    const projectHooksPath = join(projectDir, "hooks.ts");
    const projectMCPsPath = join(projectDir, "mcps.ts");
    const projectSystemPromptPath = join(projectDir, "prompts", "system.ts");
    const projectUserPromptPath = join(projectDir, "prompts", "user.ts");

    const settings = await loadModuleDefault<Partial<ClaudeSettings>>(projectSettingsPath);
    const hooks = await loadModuleDefault<HooksConfiguration>(projectHooksPath);
    const mcps = await loadModuleDefault<MCPServers>(projectMCPsPath);

    const systemPrompt = await loadModuleDefault<PromptFunction>(projectSystemPromptPath);
    const userPrompt = await loadModuleDefault<PromptFunction>(projectUserPromptPath);

    const config: ProjectConfig = {
      name: metadata.name,
      settings,
      hooks,
      mcps,
      systemPrompt,
      userPrompt,
      disableParentClaudeMds: metadata.disableParentClaudeMds,
    };

    return config;
  } catch (error) {
    console.error(`Failed to load project config from ${projectDir}:`, error);
    return null;
  }
};
