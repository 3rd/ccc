import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import * as path from "path";
import { join, relative } from "path";
import type { ConfigLayer } from "@/utils/errors";
import type { Context } from "@/context/Context";
import type { ConfigModule } from "@/config/layers";
import type { SkillBundle, SkillDefinition, SkillFile } from "@/types/skills";
import { log } from "@/utils/log";
import { formatConfigError } from "@/utils/errors";

const SKILL_MD = "SKILL.md";
const SKILL_TS = "SKILL.ts";

const toPosixPath = (value: string): string => value.split("\\").join("/");

const normalizeRelativePath = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutLeading = trimmed.replace(/^[.][/\\]/, "");
  const normalized = path.posix.normalize(toPosixPath(withoutLeading));
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
};

const readSkillFiles = (skillDir: string, exclude: Set<string> = new Set()): SkillFile[] => {
  const files: SkillFile[] = [];

  const visit = (dirPath: string) => {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = readFileSync(entryPath, "utf8");
      const relativePath = toPosixPath(relative(skillDir, entryPath));
      if (exclude.has(relativePath)) continue;
      files.push({ relativePath, content });
    }
  };

  visit(skillDir);
  return files;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

const renderYamlScalar = (value: string | number | boolean | null): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
};

const renderYamlValue = (value: unknown, indent: number): string[] => {
  const pad = "  ".repeat(indent);

  if (isScalar(value)) {
    return [`${pad}${renderYamlScalar(value)}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if (isScalar(item)) {
        lines.push(`${pad}- ${renderYamlScalar(item)}`);
        continue;
      }
      lines.push(`${pad}-`);
      lines.push(...renderYamlValue(item, indent + 1));
    }
    return lines;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${pad}{}`];
    const lines: string[] = [];
    for (const [key, entryValue] of entries) {
      if (isScalar(entryValue)) {
        lines.push(`${pad}${key}: ${renderYamlScalar(entryValue)}`);
        continue;
      }
      if (Array.isArray(entryValue) && entryValue.length === 0) {
        lines.push(`${pad}${key}: []`);
        continue;
      }
      if (isRecord(entryValue) && Object.keys(entryValue).length === 0) {
        lines.push(`${pad}${key}: {}`);
        continue;
      }
      lines.push(`${pad}${key}:`);
      lines.push(...renderYamlValue(entryValue, indent + 1));
    }
    return lines;
  }

  return [`${pad}${JSON.stringify(String(value))}`];
};

const renderFrontmatter = (data: Record<string, unknown>): string => {
  const lines = renderYamlValue(data, 0);
  return lines.join("\n");
};

const normalizeSkillDefinition = (definition: SkillDefinition, skillName: string, skillPath: string) => {
  const resolvedName = definition.name && definition.name !== skillName ? skillName : definition.name ?? skillName;
  if (definition.name && definition.name !== skillName) {
    log.warn(
      "SKILLS",
      `Skill name mismatch in ${skillPath} (dir: ${skillName}, name: ${definition.name}). Using ${skillName}.`,
    );
  }

  const content = definition.content;
  if (typeof content !== "string") {
    log.warn("SKILLS", `Skill ${skillName} has invalid content in ${skillPath}`);
    return null;
  }

  if (typeof definition.description !== "string") {
    log.warn("SKILLS", `Skill ${skillName} has invalid description in ${skillPath}`);
    return null;
  }

  const reserved = new Set([
    "name",
    "description",
    "model",
    "context",
    "agent",
    "allowed-tools",
    "user-invocable",
    "disable-model-invocation",
    "hooks",
  ]);

  const frontmatter: Record<string, unknown> = {
    name: resolvedName,
    description: definition.description,
  };

  if (definition.model) frontmatter.model = definition.model;
  if (definition.context) frontmatter.context = definition.context;
  if (definition.agent) frontmatter.agent = definition.agent;
  if (definition.allowedTools !== undefined) {
    if (typeof definition.allowedTools === "string" || Array.isArray(definition.allowedTools)) {
      frontmatter["allowed-tools"] = definition.allowedTools;
    } else {
      log.warn("SKILLS", `Skill ${skillName} has invalid allowedTools in ${skillPath}`);
    }
  }
  if (definition.userInvocable !== undefined) {
    frontmatter["user-invocable"] = definition.userInvocable;
  }
  if (definition.disableModelInvocation !== undefined) {
    frontmatter["disable-model-invocation"] = definition.disableModelInvocation;
  }
  if (definition.hooks !== undefined) {
    frontmatter.hooks = definition.hooks;
  }

  if (definition.frontmatter) {
    for (const [key, value] of Object.entries(definition.frontmatter)) {
      if (reserved.has(key)) {
        log.warn("SKILLS", `Skill ${skillName} frontmatter key "${key}" is reserved; ignoring.`);
        continue;
      }
      frontmatter[key] = value;
    }
  }

  const frontmatterText = renderFrontmatter(frontmatter);
  const skillMarkdown = `---\n${frontmatterText}\n---\n\n${content}\n`;

  return { name: resolvedName, content: skillMarkdown, files: definition.files ?? [] };
};

const loadSkillFromTs = async (
  context: Context,
  skillDir: string,
  skillName: string,
  layer: ConfigLayer,
  layerName?: string,
): Promise<SkillBundle | null> => {
  const skillTsPath = join(skillDir, SKILL_TS);

  try {
    const module = (await import(skillTsPath)) as ConfigModule<SkillDefinition>;
    const exported = module.default;
    const definition =
      typeof exported === "function" ? await exported(context) : (exported as SkillDefinition);

    const normalized = normalizeSkillDefinition(definition, skillName, skillTsPath);
    if (!normalized) return null;

    const exclude = new Set<string>([SKILL_TS, SKILL_MD]);
    const diskFiles = readSkillFiles(skillDir, exclude);
    const fileMap = new Map<string, string>();
    fileMap.set(SKILL_MD, normalized.content);

    for (const file of diskFiles) {
      if (fileMap.has(file.relativePath)) {
        log.warn("SKILLS", `Duplicate skill file ${file.relativePath} in ${skillDir}`);
        continue;
      }
      fileMap.set(file.relativePath, file.content);
    }

    for (const file of normalized.files) {
      const normalizedPath = normalizeRelativePath(file.relativePath);
      if (!normalizedPath) {
        log.warn("SKILLS", `Ignoring invalid skill file path "${file.relativePath}" in ${skillDir}`);
        continue;
      }
      if (normalizedPath === SKILL_MD) {
        log.warn("SKILLS", `Ignoring inline ${SKILL_MD} override in ${skillDir}`);
        continue;
      }
      if (fileMap.has(normalizedPath)) {
        log.warn("SKILLS", `Overriding skill file ${normalizedPath} from ${skillDir}`);
      }
      fileMap.set(normalizedPath, file.content);
    }

    const files = Array.from(fileMap.entries()).map(([relativePath, content]) => ({
      relativePath,
      content,
    }));

    return { name: skillName, files };
  } catch (error) {
    const msg = formatConfigError(error, layer, layerName, skillTsPath);
    log.error("SKILLS", msg);
    return null;
  }
};

const loadSkillFromDir = async (
  context: Context,
  skillDir: string,
  skillName: string,
  layer: ConfigLayer,
  layerName?: string,
): Promise<SkillBundle | null> => {
  const skillTsPath = join(skillDir, SKILL_TS);
  const skillMdPath = join(skillDir, SKILL_MD);

  if (existsSync(skillTsPath)) {
    if (existsSync(skillMdPath)) {
      log.warn("SKILLS", `Using ${SKILL_TS} over ${SKILL_MD} in ${skillDir}`);
    }
    return await loadSkillFromTs(context, skillDir, skillName, layer, layerName);
  }

  if (!existsSync(skillMdPath)) {
    log.warn("SKILLS", `Skipping skill without ${SKILL_MD}: ${skillDir}`);
    return null;
  }

  const files = readSkillFiles(skillDir);
  return { name: skillName, files };
};

const loadSkillsFromPath = async (
  context: Context,
  dirPath: string | undefined,
  layer: ConfigLayer,
  layerName?: string,
): Promise<Map<string, SkillBundle>> => {
  const skills = new Map<string, SkillBundle>();
  if (!dirPath || !existsSync(dirPath)) return skills;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const skillDir = join(dirPath, skillName);
    let stats: ReturnType<typeof statSync> | null = null;
    try {
      stats = statSync(skillDir);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    const bundle = await loadSkillFromDir(context, skillDir, skillName, layer, layerName);
    if (!bundle) continue;
    skills.set(skillName, bundle);
  }

  return skills;
};

export const buildSkills = async (context: Context): Promise<SkillBundle[]> => {
  const launcherRoot = context.launcherDirectory;
  const configBase =
    context.configDirectory.startsWith("/") ?
      context.configDirectory
    : join(launcherRoot, context.configDirectory);

  const skills = new Map<string, SkillBundle>();

  const applyLayer = (layerName: string, layerSkills: Map<string, SkillBundle>) => {
    for (const [name, bundle] of layerSkills) {
      if (skills.has(name)) {
        log.warn("SKILLS", `Skill override detected (${layerName}): ${name}`);
      }
      skills.set(name, bundle);
    }
  };

  const globalSkills = await loadSkillsFromPath(context, join(configBase, "global", "skills"), "global");
  applyLayer("global", globalSkills);

  for (const preset of context.project.presets) {
    const presetSkills = await loadSkillsFromPath(
      context,
      join(configBase, "presets", preset.name, "skills"),
      "preset",
      preset.name,
    );
    applyLayer(`preset:${preset.name}`, presetSkills);
  }

  if (context.project.projectConfig) {
    const projectSkills = await loadSkillsFromPath(
      context,
      join(configBase, "projects", context.project.projectConfig.name, "skills"),
      "project",
      context.project.projectConfig.name,
    );
    applyLayer(`project:${context.project.projectConfig.name}`, projectSkills);
  }

  return Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name));
};
