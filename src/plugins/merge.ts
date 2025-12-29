import { normalizeEnablement, type PluginEnablementConfig, type PluginEnablementValue } from "./schema";

// merge plugin configs from multiple layers
export const mergePluginConfigs = (
  ...layers: (PluginEnablementConfig | undefined)[]
): PluginEnablementConfig => {
  const result: PluginEnablementConfig = {};

  for (const layer of layers) {
    if (!layer) continue;

    for (const [name, value] of Object.entries(layer)) {
      // later layers override earlier ones
      result[name] = value;
    }
  }

  return result;
};

export const getEnabledPluginNames = (config: PluginEnablementConfig): string[] => {
  const enabled: string[] = [];

  for (const [name, value] of Object.entries(config)) {
    const { enabled: isEnabled } = normalizeEnablement(value);
    if (isEnabled) {
      enabled.push(name);
    }
  }

  return enabled;
};

export const getPluginSettings = (
  config: PluginEnablementConfig,
  pluginName: string,
): Record<string, unknown> => {
  const value = config[pluginName];
  if (!value) return {};
  const { settings } = normalizeEnablement(value);
  return settings;
};

export const mergePluginSettings = (
  ...layers: (PluginEnablementValue | undefined)[]
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const layer of layers) {
    if (!layer) continue;
    const { settings } = normalizeEnablement(layer);
    Object.assign(result, settings);
  }

  return result;
};
