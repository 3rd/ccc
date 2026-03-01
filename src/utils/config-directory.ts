import { isAbsolute, join, normalize } from "path";

export const resolveConfigDirectoryPath = (launcherDirectory: string, configDirectory: string): string => {
  const trimmed = configDirectory.trim();
  if (trimmed.length === 0) return join(launcherDirectory, "config");
  return normalize(isAbsolute(trimmed) ? trimmed : join(launcherDirectory, trimmed));
};
