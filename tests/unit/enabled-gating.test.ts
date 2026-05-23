import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, test } from "bun:test";
import { buildCommands } from "@/config/builders/build-commands";
import { buildMCPs } from "@/config/builders/build-mcps";
import { buildSkills } from "@/config/builders/build-skills";
import {
  createAgent,
  createAppendCommand,
  createCommand,
  createConfigMCPs,
} from "@/config/helpers";
import { mergeHooks } from "@/config/layers";
import { loadPresets } from "@/config/presets";
import { Context } from "@/context/Context";
import { clearPluginContextRegistry, getPluginContext } from "@/plugins/context";
import { loadPlugins } from "@/plugins/loader";
import { getPluginHooks, getPluginInfo, getPluginPrompts } from "@/plugins/registry";
import { isMCPLayerDisabled } from "@/types/mcps";
import type { DiscoveredPlugin } from "@/plugins/discovery";
import type { HooksConfiguration } from "@/types/hooks";
import { getFixturePath } from "../utils/test-runner";

type TempConfigTest = (paths: { configDir: string }) => Promise<void>;

const withTempConfig = async (fn: TempConfigTest) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ccc-enabled-"));
  try {
    await cp(join(process.cwd(), "tsconfig.json"), join(tempDir, "tsconfig.json"));
    await symlink(join(process.cwd(), "src"), join(tempDir, "src"), "junction");
    await symlink(join(process.cwd(), "node_modules"), join(tempDir, "node_modules"), "junction");
    await fn({ configDir: join(tempDir, "config") });
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
};

const writeConfigFile = async (configDir: string, relativePath: string, content: string) => {
  const filePath = join(configDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

const createContext = async (configDir: string) => {
  const context = new Context(getFixturePath("projects", "typescript-basic"));
  context.configDirectory = configDir;
  await context.init();
  return context;
};

describe("enabled gating", () => {
  describe("skills", () => {
    test("skips skills with enabled: false and emits enabled or default skills", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "global/skills/disabled/SKILL.ts",
          `
import { createSkill } from "@/config/helpers";
export default createSkill({
  description: "disabled fixture",
  enabled: false,
  content: "should not appear",
});
`,
        );
        await writeConfigFile(
          configDir,
          "global/skills/enabled-default/SKILL.ts",
          `
import { createSkill } from "@/config/helpers";
export default createSkill({
  description: "default enabled fixture",
  content: "should appear",
});
`,
        );
        await writeConfigFile(
          configDir,
          "global/skills/enabled-explicit/SKILL.ts",
          `
import { createSkill } from "@/config/helpers";
export default createSkill({
  description: "explicit enabled fixture",
  enabled: true,
  content: "should appear",
});
`,
        );

        const context = await createContext(configDir);
        const skills = await buildSkills(context);
        const names = skills.map((skill) => skill.name);

        expect(names).toContain("enabled-default");
        expect(names).toContain("enabled-explicit");
        expect(names).not.toContain("disabled");
      });
    });
  });

  describe("mcps", () => {
    test("createConfigMCPs drops entries flagged enabled: false (inline form)", () => {
      const result = createConfigMCPs({
        keep: { command: "echo", args: ["hi"] },
        drop: { command: "echo", args: ["bye"], enabled: false },
        keepExplicit: { command: "echo", args: ["yes"], enabled: true },
      });

      expect(Object.keys(result).sort()).toEqual(["keep", "keepExplicit"]);
    });

    test("createConfigMCPs drops entries flagged enabled: false (wrapped form)", () => {
      const result = createConfigMCPs({
        keep: { type: "traditional", config: { command: "echo" } },
        dropOuter: {
          type: "traditional",
          config: { command: "echo" },
          enabled: false,
        },
        dropInner: {
          type: "traditional",
          config: { command: "echo", enabled: false },
        },
      });

      expect(Object.keys(result).sort()).toEqual(["keep"]);
    });
  });

  describe("prompts (commands/agents)", () => {
    const dummyContext = {} as Context;

    test("function form returns enabled-less PromptLayerData", async () => {
      const factory = createCommand(async () => "body");
      const data = await factory(dummyContext);

      expect(data).toEqual({ content: "body", mode: "override" });
    });

    test("options form passes handler through when enabled is true", async () => {
      const factory = createCommand({ handler: async () => "body", enabled: true });
      const data = await factory(dummyContext);

      expect(data).toEqual({ content: "body", mode: "override" });
    });

    test("options form yields a sentinel with enabled=false when disabled", async () => {
      const factory = createCommand({ handler: async () => "body", enabled: false });
      const data = await factory(dummyContext);

      expect(data.enabled).toBe(false);
      expect(data.content).toBe("");
    });

    test("createAppendCommand carries append mode through the options form", async () => {
      const factory = createAppendCommand({ handler: async () => "appendix", enabled: true });
      const data = await factory(dummyContext);

      expect(data).toEqual({ content: "appendix", mode: "append" });
    });

    test("createAgent shares the same shape as createCommand", async () => {
      const factory = createAgent({ handler: async () => "agent", enabled: false });
      const data = await factory(dummyContext);

      expect(data.enabled).toBe(false);
      expect(data.mode).toBe("override");
    });
  });

  describe("hooks", () => {
    test("filters disabled hook entries and drops empty definitions", () => {
      const config: HooksConfiguration = {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "keep.sh" },
              { type: "command", command: "drop.sh", enabled: false },
            ],
          },
          {
            matcher: "Edit",
            enabled: false,
            hooks: [{ type: "command", command: "wholly-disabled.sh" }],
          },
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "dropped-too.sh", enabled: false }],
          },
        ],
      };

      const merged = mergeHooks(config);

      expect(merged.PreToolUse).toBeDefined();
      expect(merged.PreToolUse).toHaveLength(1);
      expect(merged.PreToolUse?.[0]?.matcher).toBe("Bash");
      expect(merged.PreToolUse?.[0]?.hooks).toEqual([{ type: "command", command: "keep.sh" }]);
    });

    test("strips the enabled flag from surviving hook entries and definitions", () => {
      const config: HooksConfiguration = {
        PostToolUse: [
          {
            matcher: "Read",
            enabled: true,
            hooks: [{ type: "command", command: "logger.sh", enabled: true }],
          },
        ],
      };

      const merged = mergeHooks(config);
      const def = merged.PostToolUse?.[0];

      expect(def).toBeDefined();
      expect("enabled" in (def ?? {})).toBe(false);
      const entry = def?.hooks[0];
      expect(entry).toBeDefined();
      expect("enabled" in (entry ?? {})).toBe(false);
    });

    test("returns empty result when every entry is disabled", () => {
      const config: HooksConfiguration = {
        Stop: [
          {
            matcher: "auto",
            hooks: [{ type: "command", command: "x.sh", enabled: false }],
          },
        ],
      };

      const merged = mergeHooks(config);

      expect(merged.Stop).toBeUndefined();
    });
  });

  describe("presets", () => {
    test("loadPresets skips presets whose definition declares enabled: false", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "presets/keep/index.ts",
          `
import { createPreset } from "@/config/helpers";
export default createPreset({
  name: "keep",
  matcher: () => true,
});
`,
        );
        await writeConfigFile(
          configDir,
          "presets/drop/index.ts",
          `
import { createPreset } from "@/config/helpers";
export default createPreset({
  name: "drop",
  matcher: () => true,
  enabled: false,
});
`,
        );

        const context = await createContext(configDir);
        const { presets, tags } = await loadPresets(context);

        expect(tags).toContain("keep");
        expect(tags).not.toContain("drop");
        expect(presets.map((p) => p.name)).toEqual(["keep"]);
      });
    });

    test("loadPresets short-circuits before evaluating the matcher when disabled", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "presets/throwing-matcher/index.ts",
          `
import { createPreset } from "@/config/helpers";
export default createPreset({
  name: "throwing-matcher",
  matcher: () => {
    throw new Error("matcher should never run when enabled: false");
  },
  enabled: false,
});
`,
        );

        const context = await createContext(configDir);
        const { presets, tags } = await loadPresets(context);

        expect(tags).not.toContain("throwing-matcher");
        expect(presets).toEqual([]);
      });
    });
  });

  describe("plugins", () => {
    const buildDiscovered = (pluginRoot: string, name: string): DiscoveredPlugin => ({
      manifest: { name, version: "1.0.0", description: `${name} plugin` },
      root: pluginRoot,
    });

    test("plugin with enabled: false in its definition is loaded but marked disabled", async () => {
      await withTempConfig(async ({ configDir }) => {
        const pluginRoot = join(configDir, "plugins/disabled-plugin");
        await writeConfigFile(
          configDir,
          "plugins/disabled-plugin/index.ts",
          `
import { createPlugin } from "@/config/helpers";

let onLoadFired = false;
(globalThis as any).__cccDisabledPluginOnLoad = () => onLoadFired;

export default createPlugin({
  enabled: false,
  onLoad: () => { onLoadFired = true; },
  commands: () => ({ ghost: { content: "should never appear", mode: "override" } }),
});
`,
        );

        const context = await createContext(configDir);
        const { plugins, errors } = await loadPlugins(
          [buildDiscovered(pluginRoot, "disabled-plugin")],
          { "disabled-plugin": true },
          context,
        );

        expect(errors).toEqual([]);
        expect(plugins).toHaveLength(1);
        expect(plugins[0]?.enabled).toBe(false);

        const onLoadFired = (globalThis as { __cccDisabledPluginOnLoad?: () => boolean })
          .__cccDisabledPluginOnLoad;
        expect(onLoadFired?.()).toBe(false);
      });
    });

    test("plugin with enabled: true (or unspecified) loads normally", async () => {
      await withTempConfig(async ({ configDir }) => {
        const pluginRoot = join(configDir, "plugins/active-plugin");
        await writeConfigFile(
          configDir,
          "plugins/active-plugin/index.ts",
          `
import { createPlugin } from "@/config/helpers";
export default createPlugin({
  commands: () => ({ hi: { content: "hi", mode: "override" } }),
});
`,
        );

        const context = await createContext(configDir);
        const { plugins, errors } = await loadPlugins(
          [buildDiscovered(pluginRoot, "active-plugin")],
          { "active-plugin": true },
          context,
        );

        expect(errors).toEqual([]);
        expect(plugins[0]?.enabled).toBe(true);
      });
    });

    test("disabled plugin does not register in pluginContextRegistry", async () => {
      await withTempConfig(async ({ configDir }) => {
        clearPluginContextRegistry();

        const pluginRoot = join(configDir, "plugins/unregistered-plugin");
        await writeConfigFile(
          configDir,
          "plugins/unregistered-plugin/index.ts",
          `
import { createPlugin } from "@/config/helpers";
export default createPlugin({ enabled: false });
`,
        );

        const context = await createContext(configDir);
        await loadPlugins(
          [buildDiscovered(pluginRoot, "unregistered-plugin")],
          { "unregistered-plugin": true },
          context,
        );

        // disabled plugins must not appear in the registry — getPlugin from
        // another plugin's context returns undefined.
        expect(getPluginContext("unregistered-plugin")).toBeUndefined();
      });
    });

    test("disabled plugin's hooks/commands/info do not surface via registry getters", async () => {
      await withTempConfig(async ({ configDir }) => {
        clearPluginContextRegistry();

        const pluginRoot = join(configDir, "plugins/silent-plugin");
        await writeConfigFile(
          configDir,
          "plugins/silent-plugin/index.ts",
          `
import { createPlugin } from "@/config/helpers";
export default createPlugin({
  enabled: false,
  commands: () => { throw new Error("commands() should not run for disabled plugin"); },
  hooks: () => { throw new Error("hooks() should not run for disabled plugin"); },
});
`,
        );

        const context = await createContext(configDir);
        const { plugins } = await loadPlugins(
          [buildDiscovered(pluginRoot, "silent-plugin")],
          { "silent-plugin": true },
          context,
        );

        // every registry getter should treat disabled plugins as absent —
        // none of these calls should invoke the plugin's throwing functions.
        expect(getPluginHooks(plugins)).toEqual({});

        const infos = getPluginInfo(plugins);
        expect(infos).toHaveLength(1);
        expect(infos[0]?.enabled).toBe(false);
        expect(infos[0]?.components.commands).toEqual([]);
        expect(infos[0]?.components.hooks).toEqual({});
      });
    });

    test("enabled plugin's disabled prompts are stripped from getPluginPrompts", async () => {
      await withTempConfig(async ({ configDir }) => {
        clearPluginContextRegistry();

        const pluginRoot = join(configDir, "plugins/prompt-plugin");
        await writeConfigFile(
          configDir,
          "plugins/prompt-plugin/index.ts",
          `
import { createPlugin } from "@/config/helpers";
export default createPlugin({
  prompts: () => ({
    system: { content: "system body", mode: "append", enabled: false },
    user: { content: "user body", mode: "append" },
  }),
});
`,
        );

        const context = await createContext(configDir);
        const { plugins } = await loadPlugins(
          [buildDiscovered(pluginRoot, "prompt-plugin")],
          { "prompt-plugin": true },
          context,
        );
        const pluginPrompts = getPluginPrompts(plugins);

        expect(pluginPrompts.system).toEqual([]);
        expect(pluginPrompts.user).toHaveLength(1);
      });
    });

    test("enabled plugin's disabled hook entries are stripped from getPluginHooks", async () => {
      await withTempConfig(async ({ configDir }) => {
        clearPluginContextRegistry();

        const pluginRoot = join(configDir, "plugins/hook-plugin");
        await writeConfigFile(
          configDir,
          "plugins/hook-plugin/index.ts",
          `
import { createPlugin } from "@/config/helpers";
export default createPlugin({
  hooks: () => ({
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "keep.sh" },
          { type: "command", command: "drop.sh", enabled: false },
        ],
      },
      {
        matcher: "Edit",
        enabled: false,
        hooks: [{ type: "command", command: "wholly-disabled.sh" }],
      },
    ],
  }),
});
`,
        );

        const context = await createContext(configDir);
        const { plugins } = await loadPlugins(
          [buildDiscovered(pluginRoot, "hook-plugin")],
          { "hook-plugin": true },
          context,
        );
        const pluginHooks = getPluginHooks(plugins);

        expect(pluginHooks.PreToolUse).toBeDefined();
        expect(pluginHooks.PreToolUse).toHaveLength(1);
        expect(pluginHooks.PreToolUse?.[0]?.matcher).toBe("Bash");
        expect(pluginHooks.PreToolUse?.[0]?.hooks).toEqual([
          { type: "command", command: "keep.sh" },
        ]);
      });
    });
  });

  describe("end-to-end runtime invisibility", () => {
    test("isMCPLayerDisabled detects the flag in every wrapper position", () => {
      const inlineFactory: import("@/types/mcps").FastMCPFactory = (() =>
        ({ start: async () => undefined }) as unknown as ReturnType<
          import("@/types/mcps").FastMCPFactory
        >);

      expect(
        isMCPLayerDisabled({ type: "traditional", config: { command: "x" } }),
      ).toBe(false);
      expect(
        isMCPLayerDisabled({ type: "traditional", config: { command: "x" }, enabled: false }),
      ).toBe(true);
      expect(
        isMCPLayerDisabled({
          type: "traditional",
          config: { command: "x", enabled: false },
        }),
      ).toBe(true);
      // inline configs don't carry an inner enabled flag; only the outer wrapper does
      expect(
        isMCPLayerDisabled({ type: "inline", config: inlineFactory, enabled: false }),
      ).toBe(true);
      expect(
        isMCPLayerDisabled({ type: "inline", config: inlineFactory }),
      ).toBe(false);
    });

    test("Context.hasMCP returns false for an MCP authored with enabled: false", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "global/mcps.ts",
          `
import { createConfigMCPs } from "@/config/helpers";
export default createConfigMCPs({
  visible: { command: "echo", args: ["visible"] },
  ghost: { command: "echo", args: ["ghost"], enabled: false },
});
`,
        );

        const context = await createContext(configDir);
        const mcps = await buildMCPs(context);
        context.mcpServers = mcps;

        expect(context.hasMCP("visible")).toBe(true);
        expect(context.hasMCP("ghost")).toBe(false);
        expect(Object.keys(mcps).sort()).toEqual(["visible"]);
      });
    });

    test("buildMCPs filters disabled MCPs even when authored via the raw wrapper", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "global/mcps.ts",
          `
export default {
  active: { type: "traditional", config: { command: "echo", args: ["yes"] } },
  inactive: { type: "traditional", config: { command: "echo", args: ["no"], enabled: false } },
  alsoOff: { type: "traditional", config: { command: "echo", args: ["no2"] }, enabled: false },
};
`,
        );

        const context = await createContext(configDir);
        const mcps = await buildMCPs(context);

        expect(Object.keys(mcps).sort()).toEqual(["active"]);
      });
    });

    test("buildMCPs strips the enabled flag from surviving entries", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "global/mcps.ts",
          `
import { createConfigMCPs } from "@/config/helpers";
export default createConfigMCPs({
  surviving: { command: "echo", args: ["yes"], enabled: true },
});
`,
        );

        const context = await createContext(configDir);
        const mcps = await buildMCPs(context);
        const survivor = mcps.surviving;

        expect(survivor).toBeDefined();
        expect("enabled" in (survivor ?? {})).toBe(false);
      });
    });

    test("buildCommands does not include disabled command files in the final map", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "global/commands/keep.ts",
          `
import { createCommand } from "@/config/helpers";
export default createCommand(async () => "keep command body");
`,
        );
        await writeConfigFile(
          configDir,
          "global/commands/drop.ts",
          `
import { createCommand } from "@/config/helpers";
export default createCommand({ handler: async () => "drop command body", enabled: false });
`,
        );

        const context = await createContext(configDir);
        const commands = await buildCommands(context);

        expect(commands.has("keep.md")).toBe(true);
        expect(commands.has("drop.md")).toBe(false);
      });
    });

    test("disabled override layer falls back to the underlying layer", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(configDir, "global/commands/shared.md", "global body");
        await writeConfigFile(
          configDir,
          "global/settings.ts",
          `
import { createConfigSettings } from "@/config/helpers";
export default createConfigSettings({});
`,
        );

        await writeConfigFile(
          configDir,
          "presets/ts/index.ts",
          `
import { createPreset } from "@/config/helpers";
export default createPreset({ name: "ts", matcher: () => true });
`,
        );
        await writeConfigFile(
          configDir,
          "presets/ts/commands/shared.ts",
          `
import { createCommand } from "@/config/helpers";
export default createCommand({
  handler: async () => "preset would override but is disabled",
  enabled: false,
});
`,
        );

        const context = await createContext(configDir);
        const commands = await buildCommands(context);

        expect(commands.has("shared.md")).toBe(true);
        expect(commands.get("shared.md")).toContain("global body");
        expect(commands.get("shared.md")).not.toContain("preset would override");
      });
    });

    test("skill-level hook with enabled: false is stripped from emitted SKILL.md frontmatter", async () => {
      await withTempConfig(async ({ configDir }) => {
        await writeConfigFile(
          configDir,
          "global/skills/has-hooks/SKILL.ts",
          `
import { createSkill } from "@/config/helpers";
export default createSkill({
  description: "fixture with enabled and disabled skill hooks",
  content: "skill body",
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "keep.sh" },
          { type: "command", command: "drop.sh", enabled: false },
        ],
      },
      {
        matcher: "Edit",
        enabled: false,
        hooks: [{ type: "command", command: "wholly-disabled.sh" }],
      },
    ],
  },
});
`,
        );

        const context = await createContext(configDir);
        const skills = await buildSkills(context);
        const bundle = skills.find((s) => s.name === "has-hooks");
        const md = bundle?.files.find((f) => f.relativePath === "SKILL.md")?.content ?? "";

        expect(md).toContain("keep.sh");
        expect(md).not.toContain("drop.sh");
        expect(md).not.toContain("wholly-disabled.sh");
        expect(md).not.toMatch(/enabled:\s*false/);
        expect(md).not.toMatch(/enabled:\s*true/);
      });
    });
  });
});
