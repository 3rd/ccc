import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import * as path from "path";
import { join, relative } from "path";
import type { ConfigModule } from "@/config/layers";
import type { Context } from "@/context/Context";
import type {
  SkillBundle,
  SkillDefinition,
  SkillFile,
  SkillLayerMode,
  SkillLayerTrace,
} from "@/types/skills";
import type { ConfigLayer } from "@/utils/errors";
import { normalizeHooksConfiguration } from "@/config/layers";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { formatConfigError } from "@/utils/errors";
import { log } from "@/utils/log";

const SKILL_MD = "SKILL.md";
const SKILL_TS = "SKILL.ts";

const toPosixPath = (value: string) => value.split("\\").join("/");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): value is boolean | number | string | null =>
  value === null || ["boolean", "number", "string"].includes(typeof value);

const renderYamlScalar = (value: boolean | number | string | null) => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
};

const renderYamlValue = (value: unknown, indent: number): string[] => {
  const pad = "  ".repeat(indent);

  if (isScalar(value)) return [`${pad}${renderYamlScalar(value)}`];

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

const renderFrontmatter = (data: Record<string, unknown>) => {
  const lines = renderYamlValue(data, 0);
  return lines.join("\n");
};

const splitFrontmatter = (content: string) => {
  const lines = content.split(/\r?\n/u);
  if (lines[0] !== "---") return null;

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) return null;

  return {
    frontmatter: lines.slice(1, endIndex),
    body: lines.slice(endIndex + 1).join("\n"),
  };
};

const stripFrontmatter = (content: string) => {
  const split = splitFrontmatter(content);
  if (!split) return content.trim();

  return split.body.trim();
};

const parseYamlStringScalar = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }

  return trimmed;
};

const isYamlBlockScalar = (value: string): boolean =>
  value === ">" || value === ">-" || value === ">+" || value === "|" || value === "|-" || value === "|+";

const collectDescriptionBlock = (frontmatter: string[], startIndex: number): string[] => {
  const lines: string[] = [];
  for (let index = startIndex + 1; index < frontmatter.length; index += 1) {
    const line = frontmatter[index] ?? "";
    if (line.trim() === "") {
      lines.push("");
      continue;
    }

    const match = /^(\s+)(.*)$/u.exec(line);
    if (!match) break;
    lines.push(match[2] ?? "");
  }
  return lines;
};

const readDescriptionFromFrontmatter = (content: string): string | null => {
  const split = splitFrontmatter(content);
  if (!split) return null;

  for (let index = 0; index < split.frontmatter.length; index += 1) {
    const line = split.frontmatter[index] ?? "";
    const match = /^description:\s*(.*)$/u.exec(line);
    if (!match) continue;

    const value = match[1]?.trim() ?? "";
    if (!isYamlBlockScalar(value)) return parseYamlStringScalar(value);

    const block = collectDescriptionBlock(split.frontmatter, index);
    if (value.startsWith("|")) return block.join("\n").trim();
    return block.join(" ").replace(/\s+/gu, " ").trim();
  }

  return null;
};

const getDescriptionEndIndex = (frontmatter: string[], startIndex: number): number => {
  const line = frontmatter[startIndex] ?? "";
  const value = /^description:\s*(.*)$/u.exec(line)?.[1]?.trim() ?? "";
  if (!isYamlBlockScalar(value)) return startIndex + 1;

  let endIndex = startIndex + 1;
  while (endIndex < frontmatter.length) {
    const next = frontmatter[endIndex] ?? "";
    if (next.trim() !== "" && !/^\s+/u.test(next)) break;
    endIndex += 1;
  }
  return endIndex;
};

const setFrontmatterDescription = (content: string, description: string): string => {
  const split = splitFrontmatter(content);
  if (!split) return content;

  const rendered = `description: ${renderYamlScalar(description)}`;
  for (let index = 0; index < split.frontmatter.length; index += 1) {
    if (!/^description:/u.test(split.frontmatter[index] ?? "")) continue;

    const endIndex = getDescriptionEndIndex(split.frontmatter, index);
    const frontmatter = [
      ...split.frontmatter.slice(0, index),
      rendered,
      ...split.frontmatter.slice(endIndex),
    ];
    return `---\n${frontmatter.join("\n")}\n---\n${split.body}`;
  }

  return `---\n${[rendered, ...split.frontmatter].join("\n")}\n---\n${split.body}`;
};

const appendFrontmatterDescription = (baseSkill: string, appendSkill: string): string => {
  const appendDescription = readDescriptionFromFrontmatter(appendSkill);
  if (!appendDescription) return baseSkill;

  const baseDescription = readDescriptionFromFrontmatter(baseSkill);
  const description = baseDescription
    ? `${baseDescription.trimEnd()}\n\n${appendDescription.trim()}`
    : appendDescription.trim();

  return setFrontmatterDescription(baseSkill, description);
};

const normalizeRelativePath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutLeading = trimmed.replace(/^\.[/\\]/, "");
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

const normalizeSkillMode = (
  mode: SkillDefinition["mode"],
  skillName: string,
  skillPath: string,
): SkillLayerMode | null => {
  if (mode === undefined) return "override";
  if (mode === "append" || mode === "override") return mode;

  log.warn("SKILLS", `Skill ${skillName} has invalid mode in ${skillPath}`);
  return null;
};

const toFileMap = (files: SkillFile[]) => new Map(files.map((file) => [file.relativePath, file.content]));

const createSkillTrace = (
  layer: ConfigLayer,
  layerName: string | undefined,
  mode: SkillLayerMode,
): SkillLayerTrace => {
  return layerName ? { layer, name: layerName, mode } : { layer, mode };
};

const appendSkillBundle = (base: SkillBundle, append: SkillBundle): SkillBundle => {
  const fileMap = toFileMap(base.files);
  const baseSkill = fileMap.get(SKILL_MD);
  const appendSkill = append.files.find((file) => file.relativePath === SKILL_MD)?.content;

  if (baseSkill && appendSkill) {
    const appendBody = stripFrontmatter(appendSkill);
    const skill = appendFrontmatterDescription(baseSkill, appendSkill);
    fileMap.set(SKILL_MD, appendBody ? `${skill.trimEnd()}\n\n${appendBody}\n` : skill);
  }

  for (const file of append.files) {
    if (file.relativePath === SKILL_MD) continue;
    fileMap.set(file.relativePath, file.content);
  }

  const files = Array.from(fileMap.entries()).map(([relativePath, content]) => {
    return { relativePath, content };
  });

  return {
    name: base.name,
    files,
    mode: base.mode,
    trace: [...(base.trace ?? []), ...(append.trace ?? [])],
  };
};

const normalizeSkillDefinition = (definition: SkillDefinition, skillName: string, skillPath: string) => {
  const resolvedName =
    definition.name && definition.name !== skillName ? skillName : (definition.name ?? skillName);
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

  const mode = normalizeSkillMode(definition.mode, skillName, skillPath);
  if (!mode) return null;

  const reserved = new Set([
    "agent",
    "allowed-tools",
    "context",
    "description",
    "disable-model-invocation",
    "effort",
    "hooks",
    "mode",
    "model",
    "name",
    "user-invocable",
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
  if (definition.disallowedTools !== undefined) {
    if (typeof definition.disallowedTools === "string" || Array.isArray(definition.disallowedTools)) {
      frontmatter["disallowed-tools"] = definition.disallowedTools;
    } else {
      log.warn("SKILLS", `Skill ${skillName} has invalid disallowedTools in ${skillPath}`);
    }
  }
  if (definition.userInvocable !== undefined) {
    frontmatter["user-invocable"] = definition.userInvocable;
  }
  if (definition.disableModelInvocation !== undefined) {
    frontmatter["disable-model-invocation"] = definition.disableModelInvocation;
  }
  if (definition.hooks !== undefined) {
    // skill-level hooks serialize straight to YAML frontmatter, so mergeHooks
    // never gets a chance to filter disabled entries and strip `enabled`
    // flags. Do it here before emitting.
    const normalized = normalizeHooksConfiguration(definition.hooks);
    if (Object.keys(normalized).length > 0) frontmatter.hooks = normalized;
  }
  if (definition.effort) {
    frontmatter.effort = definition.effort;
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

  return { name: resolvedName, content: skillMarkdown, files: definition.files ?? [], mode };
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

    if (definition.enabled === false) {
      log.info("SKILLS", `${skillTsPath} is disabled (enabled: false); skipping.`);
      return null;
    }

    const normalized = normalizeSkillDefinition(definition, skillName, skillTsPath);
    if (!normalized) return null;

    const exclude = new Set<string>([SKILL_MD, SKILL_TS]);
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

    const files = Array.from(fileMap.entries()).map(([relativePath, content]) => {
      return {
        relativePath,
        content,
      };
    });

    return {
      name: skillName,
      files,
      mode: normalized.mode,
      trace: [createSkillTrace(layer, layerName, normalized.mode)],
    };
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
    return loadSkillFromTs(context, skillDir, skillName, layer, layerName);
  }

  if (!existsSync(skillMdPath)) {
    log.warn("SKILLS", `Skipping skill without ${SKILL_MD}: ${skillDir}`);
    return null;
  }

  const files = readSkillFiles(skillDir);
  return {
    name: skillName,
    files,
    mode: "override",
    trace: [createSkillTrace(layer, layerName, "override")],
  };
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
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);

  const skills = new Map<string, SkillBundle>();

  const applyLayer = (layerName: string, layerSkills: Map<string, SkillBundle>) => {
    for (const [name, bundle] of layerSkills) {
      const existing = skills.get(name);
      if (existing && bundle.mode === "append") {
        skills.set(name, appendSkillBundle(existing, bundle));
        continue;
      }

      if (existing) {
        log.warn("SKILLS", `Skill override detected (${layerName}): ${name}`);
        skills.set(name, {
          ...bundle,
          trace: [...(existing.trace ?? []), ...(bundle.trace ?? [])],
        });
        continue;
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
