import { z } from "zod";

export const pluginManifestSchema = z.object({
  // required
  name: z.string().regex(/^[a-z][\da-z-]*$/, "plugin name must be kebab-case"),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "version must be semver"),
  description: z.string(),

  // optional metadata
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  repository: z.string().optional(),

  // dependencies
  dependencies: z.array(z.string()).optional(),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const pluginEnablementValueSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type PluginEnablementValue = z.infer<typeof pluginEnablementValueSchema>;

export const pluginEnablementConfigSchema = z.record(z.string(), pluginEnablementValueSchema);
export type PluginEnablementConfig = z.infer<typeof pluginEnablementConfigSchema>;

export const normalizeEnablement = (
  value: PluginEnablementValue,
): { enabled: boolean; settings: Record<string, unknown> } => {
  if (typeof value === "boolean") {
    return { enabled: value, settings: {} };
  }
  return { enabled: value.enabled, settings: value.settings ?? {} };
};

export const validateManifest = (data: unknown): PluginManifest => {
  return pluginManifestSchema.parse(data);
};
