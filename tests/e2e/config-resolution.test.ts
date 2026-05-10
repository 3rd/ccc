import { describe, expect, test } from "bun:test";
import { join } from "path";
import { buildSkills } from "@/config/builders/build-skills";
import { Context } from "@/context/Context";
import type { SkillBundle } from "@/types/skills";
import { assertConfigContains, assertExitCode, assertStdoutContains } from "../utils/assertions";
import { getFixturePath, runCCC } from "../utils/test-runner";

const createSkillLayeringContext = async () => {
  const context = new Context(getFixturePath("projects", "typescript-basic"));
  context.configDirectory = join(getFixturePath("configs", "skill-layering"), "config");
  await context.init();
  return context;
};

const requireSkill = (skills: SkillBundle[], name: string) => {
  const skill = skills.find((candidate) => candidate.name === name);
  if (!skill) throw new Error(`Expected skill ${name}`);
  return skill;
};

const mapSkillFiles = (skill: SkillBundle) => {
  return new Map(skill.files.map((file) => [file.relativePath, file.content]));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

interface DoctorTrace {
  layer: string;
  name?: string;
  mode: string;
}

const isDoctorTrace = (value: unknown): value is DoctorTrace => {
  if (!isRecord(value)) return false;
  if (typeof value.layer !== "string") return false;
  if (typeof value.mode !== "string") return false;
  return value.name === undefined || typeof value.name === "string";
};

const readDoctorSkillTrace = (stdout: string, skillName: string): DoctorTrace[] => {
  const report: unknown = JSON.parse(stdout);
  if (!isRecord(report) || !isRecord(report.skills)) {
    throw new Error("Expected doctor skills report");
  }

  const trace = report.skills[skillName];
  if (!Array.isArray(trace) || !trace.every(isDoctorTrace)) {
    throw new Error(`Expected doctor trace for ${skillName}`);
  }

  return trace;
};

describe("config resolution", () => {
  test("loads global settings from minimal config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "minimal",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertConfigContains(result.stdout, "env.TEST_MINIMAL", "true");
  });

  test("loads global settings from full-featured config", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    assertConfigContains(result.stdout, "env.TEST_GLOBAL", "true");
    assertConfigContains(result.stdout, "env.FEATURE_FLAG", "enabled");
  });

  test("merges preset settings with global settings", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-config"],
    });

    assertExitCode(result.exitCode, 0);
    // typescript preset should add PRESET_TYPESCRIPT env var
    assertConfigContains(result.stdout, "env.PRESET_TYPESCRIPT", "true");
    // global settings should still be present
    assertConfigContains(result.stdout, "env.TEST_GLOBAL", "true");
  });

  test("user prompt appends preset content", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "full-featured",
      args: ["--print-user-prompt"],
    });

    assertExitCode(result.exitCode, 0);
    // should contain base user prompt
    assertStdoutContains(result.stdout, "Test User Prompt");
    // should contain appended content from typescript preset
    assertStdoutContains(result.stdout, "TypeScript Preset Additions");
  });

  test("skill layers append structured definitions", async () => {
    const context = await createSkillLayeringContext();
    const skills = await buildSkills(context);

    expect(skills.some((skill) => skill.name === "invalid-mode")).toBe(false);

    const layered = requireSkill(skills, "layered-skill");
    const layeredFiles = mapSkillFiles(layered);
    const layeredSkill = layeredFiles.get("SKILL.md") ?? "";

    expect(layered.trace).toEqual([
      { layer: "global", mode: "override" },
      { layer: "preset", name: "typescript", mode: "append" },
    ]);
    expect(layeredSkill.match(/^---$/gm)).toHaveLength(2);
    expect(layeredSkill).toContain('description: "Base layered skill"');
    expect(layeredSkill).toContain("Base layered body");
    expect(layeredSkill).toContain("Preset layered body");
    expect(layeredSkill).not.toContain("Preset layered skill");
    expect(layeredFiles.get("shared.md")).toBe("preset sidecar\n");
    expect(layeredFiles.get("preset-only.md")).toBe("preset-only sidecar\n");

    const precedence = requireSkill(skills, "ts-precedence");
    const precedenceSkill = mapSkillFiles(precedence).get("SKILL.md") ?? "";

    expect(precedence.trace).toEqual([{ layer: "global", mode: "append" }]);
    expect(precedenceSkill).toContain("TS precedence body");
    expect(precedenceSkill).not.toContain("markdown fallback body");
  });

  test("doctor reports validated skill layer traces", async () => {
    const result = await runCCC({
      projectDir: "typescript-basic",
      configFixture: "skill-layering",
      args: ["--doctor", "--json"],
    });

    assertExitCode(result.exitCode, 0);

    const report: unknown = JSON.parse(result.stdout);
    if (!isRecord(report) || !isRecord(report.skills)) {
      throw new Error("Expected doctor skills report");
    }

    expect(report.skills["invalid-mode"]).toBeUndefined();
    expect(readDoctorSkillTrace(result.stdout, "layered-skill")).toEqual([
      { layer: "global", mode: "override" },
      { layer: "preset", name: "typescript", mode: "append" },
    ]);
    expect(readDoctorSkillTrace(result.stdout, "ts-precedence")).toEqual([
      { layer: "global", mode: "append" },
    ]);
  });
});
