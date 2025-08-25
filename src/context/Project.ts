import glob from "fast-glob";
import { existsSync, statSync } from "fs";
import { dirname, join } from "path";
import type { Context } from "@/context/Context";
import type { ProjectConfig } from "@/types";
import type { PresetConfig } from "@/types/presets";
import { loadPresets } from "@/config/presets";
import { findProjectConfigDir, loadProjectConfig } from "@/config/project-config";
import { ROOT_MARKERS } from "@/constants";

export class Project {
  rootDirectory: string;
  tags: string[] = [];
  presets: PresetConfig[] = [];
  projectConfig: ProjectConfig | null = null;
  workingDirectory: string;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
    this.rootDirectory = this.findProjectRoot(workingDirectory);
  }

  private hasFilePattern(pattern: string): boolean {
    try {
      const matches = glob.sync(pattern, {
        cwd: this.rootDirectory,
        absolute: false,
        onlyFiles: true,
        dot: true,
        ignore: [],
      });
      return matches.length > 0;
    } catch {
      // fallback to exact match
      const path = join(this.rootDirectory, pattern);
      return existsSync(path) && statSync(path).isFile();
    }
  }

  private hasDirectoryPattern(pattern: string): boolean {
    try {
      const matches = glob.sync(pattern, {
        cwd: this.rootDirectory,
        absolute: false,
        onlyDirectories: true,
        dot: true,
        ignore: [],
      });
      return matches.length > 0;
    } catch {
      // fallback to exact match
      const path = join(this.rootDirectory, pattern);
      return existsSync(path) && statSync(path).isDirectory();
    }
  }

  findProjectRoot(startDir: string) {
    let currentDir = startDir;
    while (currentDir !== "/") {
      for (const marker of ROOT_MARKERS) {
        const markerPath = join(currentDir, marker);
        if (existsSync(markerPath)) {
          return currentDir;
        }
      }
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return startDir;
  }

  hasFile(relativePath: string) {
    return this.hasFilePattern(relativePath);
  }

  hasDirectory(relativePath: string) {
    return this.hasDirectoryPattern(relativePath);
  }

  async loadProjectPresets(context: Context) {
    const { presets, tags } = await loadPresets(context);
    this.presets = presets;
    this.tags = tags;
  }

  async loadProjectConfig(configDirectory: string) {
    const projectConfigDir = await findProjectConfigDir(this.workingDirectory, configDirectory);
    if (projectConfigDir) {
      this.projectConfig = await loadProjectConfig(projectConfigDir);
      if (this.projectConfig) {
        this.tags.push(`project:${this.projectConfig.name}`);
      }
    }
  }
}
