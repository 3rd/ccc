import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Context } from "@/context/Context";
import type { PresetConfig } from "@/types/presets";
import { loadModuleDefault } from "@/utils/module-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const loadPreset = async (presetName: string, context: Context): Promise<PresetConfig | null> => {
  const launcherRoot = dirname(dirname(__dirname));
  // resolve config base directory - handle absolute paths (e.g., from CCC_CONFIG_DIR)
  const configBase =
    context.configDirectory.startsWith("/") ?
      context.configDirectory
    : join(launcherRoot, context.configDirectory);
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

  const launcherRoot = dirname(dirname(__dirname));
  // resolve config base directory - handle absolute paths (e.g., from CCC_CONFIG_DIR)
  const configBase =
    context.configDirectory.startsWith("/") ?
      context.configDirectory
    : join(launcherRoot, context.configDirectory);
  const presetsDir = join(configBase, "presets");
  if (!existsSync(presetsDir)) return { presets, tags };

  try {
    const presetDirs = readdirSync(presetsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const presetName of presetDirs) {
      try {
        const preset = await loadPreset(presetName, context);
        if (preset) {
          tags.push(presetName);
          presets.push(preset);
        }
      } catch (error) {
        console.warn(`Failed to load preset ${presetName}:`, error);
      }
    }
  } catch (error) {
    console.error("Failed to load presets:", error);
  }

  return { presets, tags };
};
