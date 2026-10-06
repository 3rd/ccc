import { existsSync, mkdirSync } from "node:fs";

export const ensureDirectoryExists = (dirPath: string) => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};
