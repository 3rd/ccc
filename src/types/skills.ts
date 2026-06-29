import type { Context } from "@/context/Context";
import type { HooksConfiguration } from "@/types/hooks";

export interface SkillFile {
  relativePath: string;
  content: string;
}

export type SkillLayerMode = "append" | "override";

export interface SkillLayerTrace {
  layer: "global" | "preset" | "project";
  name?: string;
  mode: SkillLayerMode;
}

export interface SkillBundle {
  name: string;
  files: SkillFile[];
  mode?: SkillLayerMode;
  trace?: SkillLayerTrace[];
}

export interface SkillDefinition {
  /** Skill name (defaults to directory name if omitted). */
  name?: string;
  /** Required description used for skill discovery. */
  description: string;
  /** How this skill layer combines with earlier matching skill names. */
  mode?: SkillLayerMode;
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
  /** Tools removed from the model while this skill is active (v2.1.152). */
  disallowedTools?: string[] | string;
  /** Controls whether the skill appears in the slash command menu. */
  userInvocable?: boolean;
  /** Blocks programmatic invocation via the Skill tool. */
  disableModelInvocation?: boolean;
  /** Run agent in an isolated git worktree, or a remote CCR sandbox (worktree v2.1.50, remote v2.1.178). */
  isolation?: "worktree" | "remote";
  /** Always run as a background task (v2.1.49). */
  background?: boolean;
  /** Override effort level when this skill is invoked (v2.1.80). */
  effort?: "high" | "low" | "max" | "medium";
  /** Hook definitions scoped to this skill. */
  hooks?: HooksConfiguration;
  /**
   * Extra frontmatter fields to include verbatim.
   * Use this for advanced or future metadata not covered above.
   */
  frontmatter?: Record<string, unknown>;
  /** Additional files to inject into the skill directory. */
  files?: SkillFile[];
  /**
   * Build-time gate. When `false`, CCC skips emitting this skill bundle.
   * Defaults to `true`. Not written to SKILL.md frontmatter.
   */
  enabled?: boolean;
}

export type SkillDefinitionFactory = (context: Context) => Promise<SkillDefinition> | SkillDefinition;
