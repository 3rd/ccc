/* eslint-disable @typescript-eslint/class-methods-use-this */
import glob from "fast-glob";
import { existsSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import type { Context } from "@/context/Context";
import type { ProjectConfig } from "@/types";
import type { PresetConfig } from "@/types/presets";
import { loadPresets } from "@/config/presets";
import { findProjectConfigDir, loadProjectConfig } from "@/config/project-config";
import { PROJECT_SCAN_MAX_DEPTH, ROOT_MARKERS } from "@/constants";

export class Project {
  rootDirectory: string;
  tags: string[] = [];
  presets: PresetConfig[] = [];
  projectConfig: ProjectConfig | null = null;
  workingDirectory: string;
  private candidateRootsCache: string[] | null = null;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
    this.rootDirectory = this.findProjectRoot(workingDirectory);
  }

  private get candidateRoots(): string[] {
    this.candidateRootsCache ??= this.findProjectRoots(this.rootDirectory);
    return this.candidateRootsCache;
  }

  private findProjectRoots(root: string): string[] {
    const roots = [root];

    const walk = (directory: string, depth: number): void => {
      if (depth >= PROJECT_SCAN_MAX_DEPTH) return;

      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const child = join(directory, entry.name);
        if (ROOT_MARKERS.some((marker) => existsSync(join(child, marker)))) roots.push(child);
        walk(child, depth + 1);
      }
    };

    walk(root, 0);
    return roots;
  }

  private hasStaticPath(root: string, relativePath: string, entryType: "directory" | "file"): boolean {
    try {
      const stats = statSync(join(root, relativePath));
      return entryType === "file" ? stats.isFile() : stats.isDirectory();
    } catch {
      return false;
    }
  }

  private hasPattern(pattern: string, entryType: "directory" | "file"): boolean {
    const isStatic = !glob.isDynamicPattern(pattern);

    return this.candidateRoots.some((root) => {
      if (isStatic) {
        return this.hasStaticPath(root, pattern, entryType);
      }

      try {
        const matches = glob.sync(pattern, {
          cwd: root,
          absolute: false,
          onlyFiles: entryType === "file",
          onlyDirectories: entryType === "directory",
          dot: true,
          ignore: [],
        });
        return matches.length > 0;
      } catch {
        return this.hasStaticPath(root, pattern, entryType);
      }
    });
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
    return this.hasPattern(relativePath, "file");
  }

  hasDirectory(relativePath: string) {
    return this.hasPattern(relativePath, "directory");
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
