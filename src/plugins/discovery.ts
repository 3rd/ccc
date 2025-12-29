import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { type PluginManifest, pluginManifestSchema } from "./schema";

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  root: string;
}

export interface DiscoveryError {
  path: string;
  error: string;
}

export interface DiscoveryResult {
  plugins: DiscoveredPlugin[];
  errors: DiscoveryError[];
}

export const getDefaultPluginDirs = (launcherDir: string, projectRoot?: string): string[] => {
  const dirs: string[] = [];

  // built-in plugins
  dirs.push(join(launcherDir, "plugins"));

  // user plugins (~/.ccc/plugins/)
  dirs.push(join(homedir(), ".ccc", "plugins"));

  // project plugins ({projectRoot}/.ccc/plugins/)
  if (projectRoot) {
    dirs.push(join(projectRoot, ".ccc", "plugins"));
  }

  return dirs;
};

const discoverInDir = (dir: string): DiscoveryResult => {
  const plugins: DiscoveredPlugin[] = [];
  const errors: DiscoveryError[] = [];

  if (!existsSync(dir)) {
    return { plugins, errors };
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    errors.push({ path: dir, error: `failed to read directory: ${error}` });
    return { plugins, errors };
  }

  for (const entry of entries) {
    const pluginDir = join(dir, entry);
    try {
      if (!statSync(pluginDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = join(pluginDir, "plugin.json");
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifestContent = readFileSync(manifestPath, "utf8");
      const manifestData = JSON.parse(manifestContent);
      const manifest = pluginManifestSchema.parse(manifestData);

      plugins.push({ manifest, root: pluginDir });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path: manifestPath, error: message });
    }
  }

  return { plugins, errors };
};

export const discoverPlugins = (dirs: string[]): DiscoveryResult => {
  const allPlugins: DiscoveredPlugin[] = [];
  const allErrors: DiscoveryError[] = [];
  const seenNames = new Set<string>();

  for (const dir of dirs) {
    const result = discoverInDir(dir);

    for (const plugin of result.plugins) {
      // first discovered wins if duplicate names
      if (seenNames.has(plugin.manifest.name)) {
        allErrors.push({
          path: plugin.root,
          error: `duplicate plugin name '${plugin.manifest.name}' - using first discovered`,
        });
        continue;
      }

      seenNames.add(plugin.manifest.name);
      allPlugins.push(plugin);
    }

    allErrors.push(...result.errors);
  }

  return { plugins: allPlugins, errors: allErrors };
};

// sort plugins by dependencies
export const sortByDependencies = (plugins: DiscoveredPlugin[]): DiscoveredPlugin[] => {
  const byName = new Map(plugins.map((p) => [p.manifest.name, p]));
  const sorted: DiscoveredPlugin[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`circular dependency detected involving plugin '${name}'`);
    }

    const plugin = byName.get(name);
    if (!plugin) return;

    visiting.add(name);

    for (const dep of plugin.manifest.dependencies ?? []) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(plugin);
  };

  for (const plugin of plugins) {
    visit(plugin.manifest.name);
  }

  return sorted;
};

export const checkDependencies = (
  plugins: DiscoveredPlugin[],
): { missing: { plugin: string; dependency: string }[] } => {
  const available = new Set(plugins.map((p) => p.manifest.name));
  const missing: { plugin: string; dependency: string }[] = [];

  for (const plugin of plugins) {
    for (const dep of plugin.manifest.dependencies ?? []) {
      if (!available.has(dep)) {
        missing.push({ plugin: plugin.manifest.name, dependency: dep });
      }
    }
  }

  return { missing };
};
