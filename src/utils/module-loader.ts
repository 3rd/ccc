import { existsSync } from "node:fs";

export const loadModuleDefault = async <T>(filePath: string): Promise<T | undefined> => {
  if (!existsSync(filePath)) return;

  try {
    const module = await import(filePath);
    return module.default as T;
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error);
  }
};

export const loadModuleExport = async <T>(filePath: string, exportName: string): Promise<T | undefined> => {
  if (!existsSync(filePath)) return;

  try {
    const module = await import(filePath);
    return module[exportName] as T;
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error);
  }
};
