import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { Context } from "@/context/Context";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { log } from "@/utils/log";

const loadOutputStylesFromPath = (dirPath: string): Map<string, string> => {
  const styles = new Map<string, string>();
  if (!existsSync(dirPath)) return styles;

  for (const entry of readdirSync(dirPath)) {
    if (!entry.endsWith(".md")) continue;
    const content = readFileSync(join(dirPath, entry), "utf8");
    styles.set(entry, content);
  }

  return styles;
};

export const buildOutputStyles = async (context: Context): Promise<Map<string, string>> => {
  const styles = new Map<string, string>();
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);

  const globalPath = join(configBase, "global/output-styles");
  for (const [name, content] of loadOutputStylesFromPath(globalPath)) {
    styles.set(name, content);
    log.info("OUTPUT_STYLES", `Loaded global output style: ${name}`);
  }

  for (const preset of context.project.presets) {
    const presetPath = join(configBase, "presets", preset.name, "output-styles");
    for (const [name, content] of loadOutputStylesFromPath(presetPath)) {
      styles.set(name, content);
      log.info("OUTPUT_STYLES", `Loaded preset output style (${preset.name}): ${name}`);
    }
  }

  if (context.project.projectConfig) {
    const projectPath = join(configBase, "projects", context.project.projectConfig.name, "output-styles");
    for (const [name, content] of loadOutputStylesFromPath(projectPath)) {
      styles.set(name, content);
      log.info("OUTPUT_STYLES", `Loaded project output style: ${name}`);
    }
  }

  log.info("OUTPUT_STYLES", `Total output styles loaded: ${styles.size}`);
  return styles;
};
