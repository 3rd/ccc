export {
  normalizeEnablement,
  type PluginEnablementConfig,
  pluginEnablementConfigSchema,
  type PluginEnablementValue,
  pluginEnablementValueSchema,
  type PluginManifest,
  pluginManifestSchema,
  validateManifest,
} from "./schema";

export {
  type AgentConfig,
  type CommandConfig,
  type LoadedPlugin,
  type PluginDefinition,
  type PluginInfo,
  type PromptConfig,
} from "./types";

export {
  clearPluginContextRegistry,
  createPluginContext,
  getPluginContext,
  type PluginContext,
  type PluginMetadata,
  registerPluginContext,
} from "./context";

export { createPluginState, type PluginState, type StateType } from "./state";

export {
  checkDependencies,
  type DiscoveredPlugin,
  discoverPlugins,
  type DiscoveryError,
  type DiscoveryResult,
  getDefaultPluginDirs,
  sortByDependencies,
} from "./discovery";

export { type LoaderResult, loadPlugins } from "./loader";

export {
  getPluginAgents,
  getPluginCommands,
  getPluginHooks,
  getPluginInfo,
  getPluginMCPs,
  getPluginPrompts,
} from "./registry";

export { getEnabledPluginNames, getPluginSettings, mergePluginConfigs, mergePluginSettings } from "./merge";
