import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { Context } from "@/context/Context";
import type { PresetConfig } from "@/types/presets";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { loadModuleDefault } from "@/utils/module-loader";

const loadPreset = async (presetName: string, context: Context): Promise<PresetConfig | null> => {
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);
  const presetPath = join(configBase, "presets", presetName);
  const indexPath = join(presetPath, "index.ts");

  if (!existsSync(indexPath)) {
    console.warn(`No index.ts found for preset ${presetName}`);
    return null;
  }

  try {
    // get matcher from preset/index.ts
    const presetModule = await import(indexPath);
    const loadedPresetConfig = presetModule.default as PresetConfig;
    if (!loadedPresetConfig.matcher) {
      console.warn(`Preset ${presetName} has no matcher function`);
      return null;
    }
    const matches = loadedPresetConfig.matcher(context);
    if (!matches) return null;

    // load all components
    const presetConfig: PresetConfig = { ...loadedPresetConfig };

    const systemPromptPath = join(presetPath, "prompts/system.ts");
    presetConfig.systemPrompt = await loadModuleDefault(systemPromptPath);

    const userPromptPath = join(presetPath, "prompts/user.ts");
    presetConfig.userPrompt = await loadModuleDefault(userPromptPath);

    const settingsPath = join(presetPath, "settings.ts");
    presetConfig.settings = await loadModuleDefault(settingsPath);

    const mcpsPath = join(presetPath, "mcps.ts");
    presetConfig.mcps = await loadModuleDefault(mcpsPath);

    const hooksPath = join(presetPath, "hooks.ts");
    presetConfig.hooks = await loadModuleDefault(hooksPath);

    return presetConfig;
  } catch (error) {
    console.error(`Failed to load preset ${presetName}:`, error);
    return null;
  }
};

export const loadPresets = async (context: Context) => {
  const presets: PresetConfig[] = [];
  const tags: string[] = [];

  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);
  const presetsDir = join(configBase, "presets");
  if (!existsSync(presetsDir)) return { presets, tags };

  try {
    const presetDirs = readdirSync(presetsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort();

    // load all presets
    const results = await Promise.allSettled(presetDirs.map((presetName) => loadPreset(presetName, context)));

    // collect successful presets
    for (const [i, result] of results.entries()) {
      const presetName = presetDirs[i];
      if (!result || !presetName) continue;

      if (result.status === "fulfilled" && result.value) {
        tags.push(presetName);
        presets.push(result.value);
      } else if (result.status === "rejected") {
        console.warn(`Failed to load preset ${presetName}:`, result.reason);
      }
    }
  } catch (error) {
    console.error("Failed to load presets:", error);
  }

  return { presets, tags };
};
