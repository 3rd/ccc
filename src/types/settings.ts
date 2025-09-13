export type ClaudeSettings = {
  model?: ({} & string) | "auto" | "opus" | "opusplan" | "sonnet";
  env?: Record<string, string>;
  apiKeyHelper?: string;
  includeCoAuthoredBy?: boolean;
  spinnerTipsEnabled?: boolean;
  statusLine?: {
    type: string;
    command: string;
  };
  permissions?: {
    defaultMode?: "acceptEdits" | "bypassPermissions" | "default" | "plan";
    additionalDirectories?: string[];
    allow?: string[];
    deny?: string[];
  };
};
