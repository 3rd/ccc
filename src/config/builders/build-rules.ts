import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { Context } from "@/context/Context";
import { log } from "@/utils/log";

const loadRulesFromPath = (dirPath: string): Map<string, string> => {
  const rules = new Map<string, string>();
  if (!existsSync(dirPath)) return rules;

  const walkDir = (currentPath: string, relativePath = ""): void => {
    const entries = readdirSync(currentPath);
    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const relPath = relativePath ? join(relativePath, entry) : entry;

      if (statSync(fullPath).isDirectory()) {
        walkDir(fullPath, relPath);
      } else if (entry.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        rules.set(relPath, content);
      }
    }
  };

  walkDir(dirPath);
  return rules;
};

export const buildRules = async (context: Context): Promise<Map<string, string>> => {
  const rules = new Map<string, string>();
  const launcherRoot = context.launcherDirectory;
  const configBase =
    context.configDirectory.startsWith("/") ?
      context.configDirectory
    : join(launcherRoot, context.configDirectory);

  // load global rules
  const globalPath = join(configBase, "global/rules");
  for (const [name, content] of loadRulesFromPath(globalPath)) {
    rules.set(name, content);
    log.info("RULES", `Loaded global rule: ${name}`);
  }

  // load preset rules
  for (const preset of context.project.presets) {
    const presetPath = join(configBase, "presets", preset.name, "rules");
    for (const [name, content] of loadRulesFromPath(presetPath)) {
      // prefix with preset name
      const key = `${preset.name}/${name}`;
      rules.set(key, content);
      log.info("RULES", `Loaded preset rule: ${key}`);
    }
  }

  // load project rules (from CCC config, not .claude/rules)
  if (context.project.projectConfig) {
    const projectPath = join(configBase, "projects", context.project.projectConfig.name, "rules");
    for (const [name, content] of loadRulesFromPath(projectPath)) {
      const key = `project/${name}`;
      rules.set(key, content);
      log.info("RULES", `Loaded project rule: ${key}`);
    }
  }

  log.info("RULES", `Total CCC rules loaded: ${rules.size}`);
  return rules;
};
