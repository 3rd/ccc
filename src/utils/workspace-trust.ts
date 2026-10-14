import { existsSync, readFileSync, realpathSync } from "fs";
import { resolve } from "path";

interface ClaudeProjectState extends Record<string, unknown> {
  hasTrustDialogAccepted?: boolean;
}

interface ClaudeStateFile extends Record<string, unknown> {
  projects?: Record<string, ClaudeProjectState>;
}

export interface VirtualClaudeStateResult {
  claudeStateJson: string;
  claudeStatePath: string;
  trustedPaths: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeWorkspacePath = (workspacePath: string) => {
  const resolved = resolve(workspacePath);
  try {
    return realpathSync.native?.(resolved) ?? realpathSync(resolved);
  } catch {
    return resolved;
  }
};

const parseClaudeStateFile = (claudeStatePath: string): ClaudeStateFile => {
  if (!existsSync(claudeStatePath)) return {};

  const raw = readFileSync(claudeStatePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) return {};

  const projects = isRecord(parsed.projects) ? parsed.projects : undefined;
  return {
    ...parsed,
    ...(projects && { projects: projects as Record<string, ClaudeProjectState> }),
  };
};

export const buildTrustedClaudeState = (workspacePaths: string[], claudeStatePath: string): VirtualClaudeStateResult => {
  const trustedPaths = Array.from(new Set(workspacePaths.map(normalizeWorkspacePath)));
  const claudeState = parseClaudeStateFile(claudeStatePath);
  const projects = { ...claudeState.projects };

  for (const trustedPath of trustedPaths) {
    const currentState = isRecord(projects[trustedPath]) ? projects[trustedPath] : {};
    projects[trustedPath] = {
      ...currentState,
      hasTrustDialogAccepted: true,
    };
  }

  return {
    claudeStateJson: `${JSON.stringify(
      {
        ...claudeState,
        projects,
      },
      null,
      2,
    )}\n`,
    claudeStatePath,
    trustedPaths,
  };
};
