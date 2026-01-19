import { z } from "zod";
import { pluginEnablementConfigSchema } from "@/plugins/schema";

const claudePluginEnablementValueSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const claudePluginEnablementSchema = z.record(z.string(), claudePluginEnablementValueSchema);

const claudeMarketplaceSchema = z.object({
  source: z.enum(["github", "local", "url"]),
  repo: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  allow_network: z.boolean().optional(),
});

const claudePluginsSchema = z.object({
  enabledPlugins: claudePluginEnablementSchema.optional(),
  pluginDirs: z.array(z.string()).optional(),
  extraKnownMarketplaces: z.record(z.string(), claudeMarketplaceSchema).optional(),
});

export const pluginsSchema = z.object({
  ccc: pluginEnablementConfigSchema.optional(),
  claude: claudePluginsSchema.optional(),
});

export type ClaudePluginEnablement = z.infer<typeof claudePluginEnablementSchema>;
export type ClaudeMarketplaceConfig = z.infer<typeof claudeMarketplaceSchema>;
export type ClaudePluginsConfig = z.infer<typeof claudePluginsSchema>;
export type PluginsConfig = z.infer<typeof pluginsSchema>;

export const validatePlugins = (config: unknown): PluginsConfig => {
  const parsed = pluginsSchema.safeParse(config);
  if (!parsed.success) {
    const errorMessages = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  • ${path}: ${issue.message}`;
    });
    const errorMessage = ["Plugins config validation failed:", ...errorMessages].join("\n");
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  return parsed.data;
};
