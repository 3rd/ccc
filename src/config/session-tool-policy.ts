import { z } from "zod";

const SESSION_TOOL_POLICY_ENV = "AGENTS_SESSION_TOOL_POLICY";
const SESSION_TOOL_CATALOG_ENV = "AGENTS_SESSION_TOOL_CATALOG";
const SESSION_MCP_CATALOG_ENV = "AGENTS_SESSION_MCP_CATALOG";
const TOOL_PROVIDER_VERSION_ENV = "AGENTS_TOOL_PROVIDER_VERSION";
export const SESSION_TOOL_POLICY_PATCH_NAME = "session-tool-policy";

const sessionToolPolicySchema = z.object({
  version: z.literal(1),
  native: z.record(z.string(), z.boolean()).optional(),
  mcp: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
  }).strict()).optional(),
}).strict();

type SessionToolPolicy = z.infer<typeof sessionToolPolicySchema>;

export const readSessionToolPolicy = () => {
  const source = process.env[SESSION_TOOL_POLICY_ENV];
  if (source === undefined) return undefined;

  const value: unknown = JSON.parse(source);

  return sessionToolPolicySchema.parse(value);
};

export const isSessionToolCatalogMode = () => process.env[SESSION_TOOL_CATALOG_ENV] === "1";

export const isSessionToolControlRequested = () =>
  process.env[SESSION_TOOL_POLICY_ENV] !== undefined || isSessionToolCatalogMode();

export const isMcpEnabledForSession = (policy: SessionToolPolicy | undefined, name: string, isEnabledByDefault: boolean) =>
  policy?.mcp?.[name]?.enabled ?? isEnabledByDefault;

type SessionToolEnvironmentOptions = {
  providerVersion: string;
  mcpCatalogJson: string | undefined;
};

export const createSessionToolEnvironment = ({ providerVersion, mcpCatalogJson }: SessionToolEnvironmentOptions) => ({
  ...(isSessionToolCatalogMode() ? { [TOOL_PROVIDER_VERSION_ENV]: providerVersion } : {}),
  ...(mcpCatalogJson === undefined ? {} : { [SESSION_MCP_CATALOG_ENV]: mcpCatalogJson }),
});

type NativeToolSelection = {
  tools?: "default" | string[];
  disallowedTools?: string[];
};

export const resolveSessionNativeToolSelection = (selection: NativeToolSelection) => {
  const choices = readSessionToolPolicy()?.native;
  if (choices === undefined) return selection;

  const tools = selection.tools;
  const enabledNames = Object.keys(choices).filter((name) => choices[name] === true);

  return {
    ...selection,
    tools: Array.isArray(tools) ? [...new Set([...tools.filter((name) => choices[name] !== false), ...enabledNames])] : tools,
    disallowedTools: selection.disallowedTools?.filter((name) => choices[name] !== true),
  };
};
