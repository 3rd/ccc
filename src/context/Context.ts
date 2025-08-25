import { randomUUID } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import { platform, release } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { $, cd } from "zx";
import { Project } from "./Project";

const buildDirectoryTree = (dir: string, prefix = "", depth = 0, maxDepth = 5): string => {
  if (depth >= maxDepth) return "";
  try {
    const items = readdirSync(dir).sort();
    const tree: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const itemPath = join(dir, item);
      const isLast = i === items.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const extension = isLast ? "    " : "│   ";
      try {
        const stats = statSync(itemPath);
        tree.push(prefix + connector + item + (stats.isDirectory() ? "/" : ""));

        if (stats.isDirectory() && depth < maxDepth - 1) {
          const subTree = buildDirectoryTree(itemPath, prefix + extension, depth + 1, maxDepth);
          if (subTree) tree.push(subTree);
        }
      } catch {}
    }
    return tree.join("\n");
  } catch {
    return "";
  }
};

export class Context {
  workingDirectory: string;
  launcherDirectory: string;
  project: Project;
  instanceId: string;
  configDirectory: string;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
    this.launcherDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    this.project = new Project(workingDirectory);
    this.instanceId = randomUUID();
    this.configDirectory = this.getConfigDirectory();
  }

  private getConfigDirectory(): string {
    const devConfigPath = join(this.launcherDirectory, "dev-config");
    if (existsSync(devConfigPath)) {
      return "dev-config";
    }
    return "config";
  }

  async init() {
    await this.project.loadProjectPresets(this);
    await this.project.loadProjectConfig(this.configDirectory);
  }

  isGitRepo() {
    try {
      const result = $.sync({ nothrow: true })`git rev-parse --git-dir 2>/dev/null`;
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  getGitBranch() {
    try {
      const result = $.sync({ nothrow: true })`git rev-parse --abbrev-ref HEAD 2>/dev/null`;
      if (result.exitCode === 0) {
        return result.text().trim();
      }
      return "";
    } catch {
      return "";
    }
  }

  getGitStatus() {
    try {
      const result = $.sync({ nothrow: true })`git status --porcelain 2>/dev/null`;
      if (result.exitCode === 0) {
        return result.text();
      }
      return "";
    } catch {
      return "";
    }
  }

  getGitRecentCommits(count = 5) {
    try {
      const result = $.sync({ nothrow: true })`git log --oneline -n ${count} 2>/dev/null`;
      if (result.exitCode === 0) {
        return result.text();
      }
      return "";
    } catch {
      return "";
    }
  }

  getDirectoryTree() {
    cd(this.workingDirectory);
    try {
      // use --gitignore if we're in a git repo
      const gitIgnoreFlag = this.isGitRepo() ? "--gitignore" : "";
      const result = $.sync({ nothrow: true })`tree ${gitIgnoreFlag} -L 5 2>/dev/null`;
      if (result.exitCode === 0) {
        return result.text().trim();
      }
      // fallback
      const tree = buildDirectoryTree(this.workingDirectory);
      if (tree) return tree;
      return "";
    } catch {
      // fallback
      const tree = buildDirectoryTree(this.workingDirectory);
      if (tree) return tree;
      return "";
    }
  }

  // eslint-disable-next-line functional/prefer-tacit
  getPlatform() {
    return platform();
  }

  getOsVersion(): string {
    return `${platform()} ${release()}`;
  }

  getCurrentDateTime(): string {
    return new Date().toISOString();
  }
}
