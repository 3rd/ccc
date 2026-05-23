import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, test } from "bun:test";
import { buildWorkflows } from "@/config/builders/build-workflows";
import { WORKFLOW_SIZE_LIMIT } from "@/config/workflow-schema";
import { Context } from "@/context/Context";
import type { PluginContext } from "@/plugins/context";
import type { LoadedPlugin } from "@/plugins/types";
import { log } from "@/utils/log";
import { getFixturePath } from "../utils/test-runner";

type TempConfigTest = (paths: { configDir: string; tempDir: string }) => Promise<void>;

const withTempConfig = async (fn: TempConfigTest) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ccc-workflows-"));
  try {
    await cp(join(process.cwd(), "tsconfig.json"), join(tempDir, "tsconfig.json"));
    await symlink(join(process.cwd(), "src"), join(tempDir, "src"), "junction");
    await symlink(join(process.cwd(), "node_modules"), join(tempDir, "node_modules"), "junction");
    await fn({ configDir: join(tempDir, "config"), tempDir });
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
};

const createContext = async (configDir: string) => {
  const context = new Context(getFixturePath("projects", "typescript-basic"));
  context.configDirectory = configDir;
  await context.init();
  return context;
};

const writeConfigFile = async (configDir: string, relativePath: string, content: string) => {
  const filePath = join(configDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

const writeTempFile = async (filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

const workflowBody = (content: string) => {
  const marker = "};\n\n";
  const bodyStart = content.indexOf(marker);
  if (bodyStart === -1) throw new Error("Expected rendered workflow body");
  return content.slice(bodyStart + marker.length);
};

const expectWorkflowBodyParses = (content: string) => {
  expect(() => Function(`async function _check() {\n${workflowBody(content)}\n}`)).not.toThrow();
};

const createPlugin = (
  context: Context,
  root: string,
  workflows: NonNullable<LoadedPlugin["definition"]["workflows"]>,
): LoadedPlugin => {
  return ({
    manifest: {
      name: "fixture-plugin",
      version: "1.0.0",
      description: "fixture plugin",
    },
    root,
    definition: { workflows },
    enabled: true,
    settings: {},
    context: context as PluginContext,
  })
};

describe("buildWorkflows", () => {
  test("extracts createWorkflow handler files into native workflow scripts", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/research.ts",
        `
import { createWorkflow } from "@/config/helpers";

const resultSchema = { type: "object" } as const;

export default createWorkflow({
  name: "research",
  description: "single file workflow",
  phases: [{ title: "scan", model: "haiku" }],
  handler: async ({ agent, phase }) => {
    phase("scan");
    const result: string = await agent("summarize", { schema: resultSchema });
    return result;
  },
});
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));
      const content = workflows.files.get("research.js") ?? "";

      expect(content.startsWith('export const meta = {\n  "name": "research"')).toBe(true);
      expect(content).toContain('"description": "single file workflow"');
      expect(content).toContain("__cccWorkflowDefinition");
      expect(content).toContain("args: __cccWorkflowParseArgs(args)");
      expect(content).not.toContain("createWorkflow");
      expectWorkflowBodyParses(content);
    });
  });

  test("serializes Zod workflow args schema into whenToUse without bundling it into the handler", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/schema-demo.ts",
        `
import { createWorkflow } from "@/config/helpers";
import { z } from "zod/v4";

const argsSchema = z.object({
  topic: z.string().describe("Subject to investigate"),
  includeRisks: z.boolean().optional().describe("Whether to include risk findings"),
  labels: z.array(z.string()).optional(),
});

export default createWorkflow({
  name: "schema-demo",
  description: "schema demo",
  whenToUse: "Use this with a topic.",
  schema: argsSchema,
  handler: ({ args, log }) => {
    log(args.topic);
    return args.includeRisks ?? false;
  },
});
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));
      const content = workflows.files.get("schema-demo.js") ?? "";
      const body = workflowBody(content);

      expect(content).toContain('"whenToUse": "Use this with a topic.\\n\\nArgs schema');
      expect(content).toContain('\\"topic\\"');
      expect(content).toContain('\\"required\\"');
      expect(content).not.toContain('"schema":');
      expect(body).not.toContain("zod/v4");
      expect(body).not.toContain("argsSchema");
      expectWorkflowBodyParses(content);
    });
  });

  test("skips workflows whose Zod args schema cannot be serialized", async () => {
    await withTempConfig(async ({ configDir }) => {
      const warnings: string[] = [];
      const originalWarn = log.warn.bind(log);
      log.warn = (category: string, message: string) => {
        warnings.push(`${category}: ${message}`);
      };

      try {
        await writeConfigFile(
          configDir,
          "global/workflows/date-schema.ts",
          `
import { createWorkflow } from "@/config/helpers";
import { z } from "zod/v4";

export default createWorkflow({
  name: "date-schema",
  description: "date schema",
  schema: z.date(),
  handler: () => undefined,
});
`,
        );

        const workflows = await buildWorkflows(await createContext(configDir));

        expect(workflows.files.has("date-schema.js")).toBe(false);
        expect(warnings.some((warning) => warning.includes("Date cannot be represented in JSON Schema"))).toBe(true);
      } finally {
        log.warn = originalWarn;
      }
    });
  });

  test("strips schema-only declarations even when they share a variable statement", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/mixed-schema.ts",
        `
import { createWorkflow } from "@/config/helpers";
import { z } from "zod/v4";

const argsSchema = z.object({ topic: z.string() }), suffix = "!";

export default createWorkflow({
  name: "mixed-schema",
  description: "mixed schema declaration",
  schema: argsSchema,
  handler: ({ args }) => args.topic + suffix,
});
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));
      const content = workflows.files.get("mixed-schema.js") ?? "";
      const body = workflowBody(content);

      expect(workflows.files.has("mixed-schema.js")).toBe(true);
      expect(body).toContain('suffix = "!"');
      expect(body).not.toContain("argsSchema");
      expect(body).not.toContain("zod/v4");
      expectWorkflowBodyParses(content);
    });
  });

  test("uses preset override content and records built traces", async () => {
    const context = await createContext(join(getFixturePath("configs", "workflow-layering"), "config"));
    const workflows = await buildWorkflows(context);
    const content = workflows.files.get("inline-triage.js") ?? "";

    expect(content).toContain("Preset-overridden inline triage");
    expect(content).toContain("from-preset");
    expect(content).not.toContain("Inline-form fixture");
    expect(workflows.traces["inline-triage.js"]).toEqual([
      { layer: "global", mode: "override" },
      { layer: "preset", name: "typescript", mode: "override" },
    ]);
    expectWorkflowBodyParses(content);
  });

  test("bundles value imports without changing the native meta prologue", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/lib/support.ts",
        `
export const prompts = ["one", "two"];
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/imported.ts",
        `
import { createWorkflow } from "@/config/helpers";
import { prompts } from "./lib/support";

export default createWorkflow({
  name: "imported",
  description: "uses imports",
  handler: async ({ agent, parallel, phase }) => {
    phase("Scope");
    const url = new URL("https://example.com/a");
    const results = await parallel(prompts.map((prompt) => () => agent(prompt)));
    const values = new Map(results.map((result, index) => [index, result]));
    return { ...Object.fromEntries(values), host: url.host };
  },
});
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));
      const content = workflows.files.get("imported.js") ?? "";

      expect(content.startsWith('export const meta = {\n  "name": "imported"')).toBe(true);
      expect(content).toContain("__cccWorkflowBundle");
      expect(content).toContain("return (0, __cccWorkflowBundle.__cccWorkflowDefinition.handler)");
      expectWorkflowBodyParses(content);
    });
  });

  test("rejects raw native metadata and removed createWorkflow forms", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/raw.js",
        `
export const meta = { name: "raw", description: "raw" };
log("raw");
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/body.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "body", description: "body", body: "phase('x');" });
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/script.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ scriptPath: "./workflow.js" });
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/missing.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "missing", description: "missing" });
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));

      expect(workflows.files.has("raw.js")).toBe(false);
      expect(workflows.files.has("body.js")).toBe(false);
      expect(workflows.files.has("script.js")).toBe(false);
      expect(workflows.files.has("missing.js")).toBe(false);
    });
  });

  test("skips workflows with enabled: false and emits workflows with enabled: true or unspecified", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/disabled.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({
  name: "disabled",
  description: "disabled fixture",
  enabled: false,
  handler: ({ log }) => log("disabled"),
});
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/explicitly-enabled.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({
  name: "explicitly-enabled",
  description: "enabled fixture",
  enabled: true,
  handler: ({ log }) => log("enabled"),
});
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/default-enabled.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({
  name: "default-enabled",
  description: "default enabled fixture",
  handler: ({ log }) => log("default"),
});
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));

      expect(workflows.files.has("disabled.js")).toBe(false);
      expect(workflows.files.has("explicitly-enabled.js")).toBe(true);
      expect(workflows.files.has("default-enabled.js")).toBe(true);

      const enabledContent = workflows.files.get("explicitly-enabled.js") ?? "";
      const metaPrologue = enabledContent.slice(0, enabledContent.indexOf("\n\n"));
      expect(metaPrologue).not.toContain('"enabled"');
      expect(enabledContent).not.toContain("enabled: true");
      expect(enabledContent).not.toContain("enabled: false");
    });
  });

  test("rejects non-boolean enabled values", async () => {
    await withTempConfig(async ({ configDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/bad-enabled.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({
  name: "bad-enabled",
  description: "bad enabled fixture",
  enabled: "yes" as unknown as boolean,
  handler: () => undefined,
});
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));

      expect(workflows.files.has("bad-enabled.js")).toBe(false);
    });
  });

  test("skips unsafe and oversize workflows", async () => {
    await withTempConfig(async ({ configDir }) => {
      const huge = "x".repeat(WORKFLOW_SIZE_LIMIT + 1);
      await writeConfigFile(
        configDir,
        "global/workflows/unsafe.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "../unsafe", description: "unsafe", handler: () => undefined });
`,
      );
      await writeConfigFile(
        configDir,
        "global/workflows/huge.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "huge", description: "huge", handler: () => undefined });
${huge}
`,
      );

      const workflows = await buildWorkflows(await createContext(configDir));

      expect(workflows.files.has("../unsafe.js")).toBe(false);
      expect(workflows.files.has("huge.js")).toBe(false);
    });
  });

  test("warns when two files emit the same workflow filename", async () => {
    await withTempConfig(async ({ configDir }) => {
      const warnings: string[] = [];
      const originalWarn = log.warn.bind(log);
      log.warn = (category: string, message: string) => {
        warnings.push(`${category}: ${message}`);
      };

      try {
        await writeConfigFile(
          configDir,
          "global/workflows/a.ts",
          `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "same", description: "a", handler: ({ log }) => log("a") });
`,
        );
        await writeConfigFile(
          configDir,
          "global/workflows/b.ts",
          `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "same", description: "b", handler: ({ log }) => log("b") });
`,
        );

        const workflows = await buildWorkflows(await createContext(configDir));

        expect(workflows.files.get("same.js")).toContain('"description": "b"');
        expect(warnings.some((warning) => warning.includes("same.js") && warning.includes("overrides"))).toBe(true);
      } finally {
        log.warn = originalWarn;
      }
    });
  });

  test("uses .ts workflows over matching .js files and warns", async () => {
    await withTempConfig(async ({ configDir }) => {
      const warnings: string[] = [];
      const originalWarn = log.warn.bind(log);
      log.warn = (category: string, message: string) => {
        warnings.push(`${category}: ${message}`);
      };

      try {
        await writeConfigFile(
          configDir,
          "global/workflows/dupe.ts",
          `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "dupe", description: "typescript", handler: ({ log }) => log("ts") });
`,
        );
        await writeConfigFile(
          configDir,
          "global/workflows/dupe.js",
          `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "dupe", description: "javascript", handler: ({ log }) => log("js") });
`,
        );

        const workflows = await buildWorkflows(await createContext(configDir));

        expect(workflows.files.get("dupe.js")).toContain('"description": "typescript"');
        expect(workflows.files.get("dupe.js")).toContain('log("ts")');
        expect(warnings.some((warning) => warning.includes("Using dupe.ts over dupe.js"))).toBe(true);
      } finally {
        log.warn = originalWarn;
      }
    });
  });

  test("loads plugin workflow source files relative to plugin root and namespaces meta.name", async () => {
    await withTempConfig(async ({ configDir, tempDir }) => {
      const pluginRoot = join(tempDir, "plugin");
      await writeTempFile(
        join(pluginRoot, "plugin-workflow.ts"),
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "child", description: "plugin workflow", handler: ({ log }) => log("plugin") });
`,
      );
      const context = await createContext(configDir);
      context.loadedPlugins = [
        createPlugin(context, pluginRoot, () => {
          return ({
            child: "./plugin-workflow.ts",
          })
        }),
      ];

      const workflows = await buildWorkflows(context);
      const content = workflows.files.get("fixture-plugin:child.js") ?? "";

      expect(content).toContain('"name": "fixture-plugin:child"');
      expect(content).toContain('log("plugin")');
      expect(workflows.traces["fixture-plugin:child.js"]).toEqual([
        { layer: "plugin", name: "fixture-plugin", mode: "override" },
      ]);
    });
  });

  test("keeps config-layer workflows over colliding plugin workflows", async () => {
    await withTempConfig(async ({ configDir, tempDir }) => {
      await writeConfigFile(
        configDir,
        "global/workflows/config-child.ts",
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "fixture-plugin:child", description: "config wins", handler: ({ log }) => log("config") });
`,
      );
      const pluginRoot = join(tempDir, "plugin");
      await writeTempFile(
        join(pluginRoot, "plugin-workflow.ts"),
        `
import { createWorkflow } from "@/config/helpers";
export default createWorkflow({ name: "child", description: "plugin loses", handler: ({ log }) => log("plugin") });
`,
      );
      const context = await createContext(configDir);
      context.loadedPlugins = [
        createPlugin(context, pluginRoot, () => {
          return ({
            child: "./plugin-workflow.ts",
          })
        }),
      ];

      const workflows = await buildWorkflows(context);

      expect(workflows.files.get("fixture-plugin:child.js")).toContain('log("config")');
      expect(workflows.files.get("fixture-plugin:child.js")).not.toContain('log("plugin")');
      expect(workflows.traces["fixture-plugin:child.js"]).toEqual([
        { layer: "global", mode: "override" },
      ]);
    });
  });
});
