import type { Context } from "@/context/Context";
import type { PluginManifest } from "./schema";
import { createPluginState, type PluginState, type PluginStateData, type StateType } from "./state";

export interface PluginMetadata<S = Record<string, unknown>> {
  name: string;
  version: string;
  root: string;
  settings: S;
}

export interface PluginContext<S = Record<string, unknown>, State extends PluginStateData = PluginState> extends Context {
  plugin: PluginMetadata<S>;
  state: State;
  getPlugin: (name: string) => PluginContext | undefined;
}

export type PluginStateContext<S = Record<string, unknown>> = PluginContext<S, PluginStateData>;

export const updatePluginState = <S, R>(
  context: PluginContext<S>,
  operation: (context: PluginStateContext<S>) => R,
  expectedRevision?: string,
) => context.state.update((state) => {
  const transactionContext: PluginStateContext<S> = Object.create(context, {
    state: { value: state, enumerable: true },
  });
  return operation(transactionContext);
}, expectedRevision);

const pluginContextRegistry = new Map<string, PluginContext>();

export const registerPluginContext = (name: string, ctx: PluginContext) => {
  pluginContextRegistry.set(name, ctx);
};

export const getPluginContext = (name: string): PluginContext | undefined => {
  return pluginContextRegistry.get(name);
};

export const clearPluginContextRegistry = () => {
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
