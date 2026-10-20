import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { Context } from "@/context/Context";
import type { WorkflowBuildResult, WorkflowLayerTrace } from "@/types/workflows";
import { isSafeWorkflowName, WORKFLOW_SIZE_LIMIT } from "@/config/workflow-schema";
import { getPluginWorkflows } from "@/plugins/registry";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";
import { type ConfigLayer, formatConfigError } from "@/utils/errors";
import { log } from "@/utils/log";
import { createWorkflowBuildCache, type WorkflowBuildCache, type WorkflowCacheKeyParts } from "./workflow-build-cache";

interface ResolveContext {
  errorLayer: ConfigLayer;
  traceLayer: WorkflowLayerTrace["layer"];
  layerName?: string;
  cache: WorkflowBuildCache;
}

interface LoadedWorkflow {
  filename: string;
  content: string;
  sourcePath: string;
  trace: WorkflowLayerTrace;
}

const workflowByteLength = (content: string) => Buffer.byteLength(content, "utf8");

const createWorkflowTrace = (layer: WorkflowLayerTrace["layer"], layerName?: string): WorkflowLayerTrace => {
  return layerName ? { layer, name: layerName, mode: "override" } : { layer, mode: "override" };
};

const rejectOversizeWorkflow = (label: string, content: string) => {
  const bytes = workflowByteLength(content);
  if (bytes <= WORKFLOW_SIZE_LIMIT) return false;
  log.warn("WORKFLOWS", `Workflow ${label} is ${bytes} bytes and exceeds ${WORKFLOW_SIZE_LIMIT}; skipping.`);
  return true;
};

const sourcePathForReference = (reference: string, baseDir: string) => {
  return resolve(baseDir, reference);
};

const compileCachedWorkflow = async (cache: WorkflowBuildCache, parts: WorkflowCacheKeyParts) => {
  const key = cache.keyFor(parts);

  const cached = cache.read(key);
  if (cached) return cached;

  const { compileWorkflowSource } = await import("./workflow-compiler");
  const inputs = new Set<string>();
  const result = await compileWorkflowSource({ ...parts, inputs });
  cache.write({ key, result, inputs, sourcePath: parts.sourcePath });

  return result;
};

const loadWorkflowSource = async (
  sourcePath: string,
  ctx: ResolveContext,
  canonicalName?: string,
): Promise<LoadedWorkflow | null> => {
  if (!existsSync(sourcePath)) {
    log.warn("WORKFLOWS", `workflow source does not exist: ${sourcePath}`);
    return null;
  }

  const source = readFileSync(sourcePath, "utf8");
  if (rejectOversizeWorkflow(sourcePath, source)) return null;

  try {
    const compiled = await compileCachedWorkflow(ctx.cache, { source, sourcePath, canonicalName });
    if (compiled.status === "invalid") {
      log.warn("WORKFLOWS", formatConfigError(compiled.message, ctx.errorLayer, ctx.layerName, sourcePath));

      return null;
    }
    if (compiled.status === "disabled") {
      log.info("WORKFLOWS", `${sourcePath} is disabled (enabled: false); skipping.`);
      return null;
    }
    if (compiled.status === "unsafe-name") {
      log.warn("WORKFLOWS", `${sourcePath} has unsafe workflow name: ${compiled.name}`);
      return null;
    }
    if (rejectOversizeWorkflow(compiled.name, compiled.content)) return null;

    return {
      filename: `${compiled.name}.js`,
      content: compiled.content,
      sourcePath,
      trace: createWorkflowTrace(ctx.traceLayer, ctx.layerName),
    };
  } catch (error) {
    log.warn("WORKFLOWS", formatConfigError(error, ctx.errorLayer, ctx.layerName, sourcePath));
    return null;
  }
};

const setLoadedWorkflow = (workflows: Map<string, LoadedWorkflow>, workflow: LoadedWorkflow) => {
  const existing = workflows.get(workflow.filename);
  if (existing) {
    log.warn(
      "WORKFLOWS",
      `Workflow ${workflow.filename} from ${workflow.sourcePath} overrides ${existing.sourcePath} in the same layer`,
    );
  }
  workflows.set(workflow.filename, workflow);
};

const loadWorkflowsFromPath = async (dirPath: string, ctx: ResolveContext): Promise<Map<string, LoadedWorkflow>> => {
  const workflows = new Map<string, LoadedWorkflow>();
  if (!existsSync(dirPath)) return workflows;

  const stems = new Set<string>();
  for (const entry of readdirSync(dirPath)) {
    if (entry.startsWith(".")) continue;
    if (entry.endsWith(".ts")) stems.add(entry.slice(0, -3));
    else if (entry.endsWith(".js")) stems.add(entry.slice(0, -3));
  }

  for (const stem of Array.from(stems).sort()) {
    const tsPath = join(dirPath, `${stem}.ts`);
    const jsPath = join(dirPath, `${stem}.js`);
    const sourcePath = existsSync(tsPath) ? tsPath : jsPath;

    if (existsSync(tsPath) && existsSync(jsPath)) {
      log.warn("WORKFLOWS", `Using ${stem}.ts over ${stem}.js in ${dirPath}`);
    }

    const loaded = await loadWorkflowSource(sourcePath, ctx);
    if (loaded) setLoadedWorkflow(workflows, loaded);
  }

  return workflows;
};

const applyWorkflow = (result: WorkflowBuildResult, workflow: LoadedWorkflow) => {
  result.files.set(workflow.filename, workflow.content);
  result.traces[workflow.filename] = [...(result.traces[workflow.filename] ?? []), workflow.trace];
};

export const buildWorkflows = async (context: Context): Promise<WorkflowBuildResult> => {
  const result: WorkflowBuildResult = { files: new Map(), traces: {} };
  const configBase = resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory);
  const cache = createWorkflowBuildCache();

  const globalPath = join(configBase, "global", "workflows");
  for (const workflow of (await loadWorkflowsFromPath(globalPath, { errorLayer: "global", traceLayer: "global", cache })).values()) {
    applyWorkflow(result, workflow);
    log.info("WORKFLOWS", `Loaded global workflow: ${workflow.filename}`);
  }

  for (const preset of context.project.presets) {
    const presetPath = join(configBase, "presets", preset.name, "workflows");
    const presetContext = { errorLayer: "preset", traceLayer: "preset", layerName: preset.name, cache } satisfies ResolveContext;

    for (const workflow of (await loadWorkflowsFromPath(presetPath, presetContext)).values()) {
      applyWorkflow(result, workflow);
      log.info("WORKFLOWS", `Loaded preset workflow (${preset.name}): ${workflow.filename}`);
    }
  }

  if (context.project.projectConfig) {
    const projectPath = join(configBase, "projects", context.project.projectConfig.name, "workflows");
    const projectContext = {
      errorLayer: "project",
      traceLayer: "project",
      layerName: context.project.projectConfig.name,
      cache,
    } satisfies ResolveContext;

    for (const workflow of (await loadWorkflowsFromPath(projectPath, projectContext)).values()) {
      applyWorkflow(result, workflow);
      log.info("WORKFLOWS", `Loaded project workflow: ${workflow.filename}`);
    }
  }

  const pluginWorkflows = getPluginWorkflows(context.loadedPlugins);
  for (const [namespacedName, entry] of Object.entries(pluginWorkflows)) {
    if (!isSafeWorkflowName(namespacedName)) {
      log.warn("WORKFLOWS", `Skipping plugin workflow with unsafe name: ${namespacedName}`);
      continue;
    }

    const sourcePath = sourcePathForReference(entry.config, entry.plugin.root);
    const loaded = await loadWorkflowSource(
      sourcePath,
      {
        errorLayer: "global",
        traceLayer: "plugin",
        layerName: entry.plugin.manifest.name,
        cache,
      },
      namespacedName,
    );
    if (!loaded) continue;

    if (result.files.has(loaded.filename)) {
      log.warn(
        "WORKFLOWS",
        `Skipping plugin workflow ${loaded.filename} - already defined by a config layer`,
      );
      continue;
    }
    applyWorkflow(result, loaded);
    log.info("WORKFLOWS", `Loaded plugin workflow: ${loaded.filename}`);
  }

  log.info("WORKFLOWS", `Total workflows loaded: ${result.files.size}`);
  return result;
};
