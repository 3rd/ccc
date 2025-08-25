import { z } from "zod";

// https://docs.anthropic.com/en/docs/claude-code/settings
export const settingsSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),

  apiKeyHelper: z.string().optional(),
  awsAuthRefresh: z.string().optional(),
  cleanupPeriodDays: z.number().optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  forceLoginMethod: z.string().optional(),
  includeCoAuthoredBy: z.boolean().optional(),
  model: z.string().optional(),

  permissions: z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),
    additionalDirectories: z.array(z.string()).optional(),
    defaultMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional(),
    disableBypassPermissionsMode: z.boolean().optional(),
  }),

  statusLine: z.object({ type: z.string(), command: z.string() }).optional(),

  // overwritten
  // outputStyle: z.string().optional(),
  // hooks: z.record(z.string(), z.array(z.any())).optional(),

  // config
  // autoUpdates: z.boolean().optional(),
  // preferredNotifChannel: z.string().optional(),
  // theme: z.string().optional(),
  // verbose: z.boolean().optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const validateSettings = (settings: unknown) => {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new Error(`Settings validation failed: ${z.treeifyError(parsed.error)}`);
  }
  return parsed.data;
};
