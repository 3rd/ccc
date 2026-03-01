import { join } from "path";
import type { Context } from "@/context/Context";
import type { PluginEnablementConfig } from "@/plugins/schema";
import type { LoadedPlugin } from "@/plugins/types";
import { discoverPlugins, getDefaultPluginDirs, sortByDependencies } from "@/plugins/discovery";
import { loadPlugins } from "@/plugins/loader";
import { resolveConfigDirectoryPath } from "@/utils/config-directory";

export interface CCCPluginLoadResult {
  plugins: LoadedPlugin[];
  discoveryErrors: { path: string; error: string }[];
  loadErrors: { plugin: string; error: string }[];
}

export const loadCCCPluginsFromConfig = async (
  context: Context,
  enablement: PluginEnablementConfig = {},
): Promise<CCCPluginLoadResult> => {
  const pluginDirs = getDefaultPluginDirs(context.launcherDirectory, context.project.rootDirectory);
  const configPluginsDir = join(
    resolveConfigDirectoryPath(context.launcherDirectory, context.configDirectory),
    "plugins",
  );
  pluginDirs.push(configPluginsDir);

  const discovered = discoverPlugins(pluginDirs);
  const sorted = sortByDependencies(discovered.plugins);
  const loadResult = await loadPlugins(sorted, enablement, context);

  return {
    plugins: loadResult.plugins,
    discoveryErrors: discovered.errors,
    loadErrors: loadResult.errors,
  };
};
