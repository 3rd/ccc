import type { Context } from "@/context/Context";
import type { HooksConfiguration } from "@/types/hooks";

export interface SkillFile {
  relativePath: string;
  content: string;
}

export interface SkillBundle {
  name: string;
  files: SkillFile[];
}

export interface SkillDefinition {
  /** Skill name (defaults to directory name if omitted). */
  name?: string;
  /** Required description used for skill discovery. */
  description: string;
  /** Markdown instructions content (body of SKILL.md). */
  content: string;
  /** Optional model override for this skill. */
  model?: string;
  /** Run in a forked context when set to "fork". */
  context?: "fork";
  /** Agent to use when context is "fork". */
  agent?: string;
  /** Tools allowed without prompting while the skill is active. */
  allowedTools?: string[] | string;
  /** Controls whether the skill appears in the slash command menu. */
  userInvocable?: boolean;
  /** Blocks programmatic invocation via the Skill tool. */
  disableModelInvocation?: boolean;
  /** Hook definitions scoped to this skill. */
  hooks?: HooksConfiguration | Record<string, unknown>;
  /**
   * Extra frontmatter fields to include verbatim.
   * Use this for advanced or future metadata not covered above.
   */
  frontmatter?: Record<string, unknown>;
  /** Additional files to inject into the skill directory. */
  files?: SkillFile[];
}

export type SkillDefinitionFactory = (context: Context) => Promise<SkillDefinition> | SkillDefinition;
