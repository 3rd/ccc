import type { Context } from "@/context/Context";
import type { PluginManifest } from "./schema";
import { createPluginState, type PluginState, type StateType } from "./state";

export interface PluginMetadata<S = Record<string, unknown>> {
  name: string;
  version: string;
  root: string;
  settings: S;
}

export interface PluginContext<S = Record<string, unknown>> extends Context {
  plugin: PluginMetadata<S>;
  state: PluginState;
  getPlugin: (name: string) => PluginContext | undefined;
}

const pluginContextRegistry = new Map<string, PluginContext>();

export const registerPluginContext = (name: string, ctx: PluginContext): void => {
  pluginContextRegistry.set(name, ctx);
};

export const getPluginContext = (name: string): PluginContext | undefined => {
  return pluginContextRegistry.get(name);
};

export const clearPluginContextRegistry = (): void => {
  pluginContextRegistry.clear();
};

export const createPluginContext = (
  baseContext: Context,
  manifest: PluginManifest,
  root: string,
  settings: Record<string, unknown>,
  stateType: StateType = "none",
): PluginContext => {
  const pluginMetadata: PluginMetadata = {
    name: manifest.name,
    version: manifest.version,
    root,
    settings,
  };

  const state = createPluginState(manifest.name, baseContext.workingDirectory, stateType);

  const pluginContext: PluginContext = Object.create(baseContext, {
    plugin: {
      value: pluginMetadata,
      enumerable: true,
    },
    state: {
      value: state,
      enumerable: true,
    },
    getPlugin: {
      value: getPluginContext,
      enumerable: true,
    },
  });

  return pluginContext;
};
