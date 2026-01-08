/* eslint-disable @typescript-eslint/class-methods-use-this */
import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { platform, release } from "os";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { $, cd } from "zx";
import type { LoadedPlugin } from "@/plugins/types";
import type { ClaudeMCPConfig } from "@/types/mcps";
import { Project } from "./Project";

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const TTL = {
  PERMANENT: undefined, // never expires during session
  GIT_BRANCH: 5000, // 5 seconds
  GIT_STATUS: 2000, // 2 seconds - changes frequently
  GIT_COMMITS: 5000, // 5 seconds
  DIRECTORY_TREE: 10_000, // 10 seconds
} as const;

class Memoize {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string, fn: () => T, ttlMs?: number): T {
    const entry = this.cache.get(key);
    const now = Date.now();

    // return cached value if within TTL
    if (entry && (ttlMs === undefined || now - entry.timestamp < ttlMs)) {
      return entry.value as T;
    }

    // compute and cache
    const value = fn();
    this.cache.set(key, { value, timestamp: now });
    return value;
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

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
  mcpServers?: Record<string, ClaudeMCPConfig>;
  loadedPlugins: LoadedPlugin[] = [];
  private memo = new Memoize();

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
    this.launcherDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    this.project = new Project(workingDirectory);
    this.instanceId = randomUUID();
    this.configDirectory = this.getConfigDirectory();
  }

  invalidateCache(key?: string): void {
    this.memo.invalidate(key);
  }

  private getConfigDirectory(): string {
    // allow env override for testing with custom config directories
    if (process.env.CCC_CONFIG_DIR) {
      return process.env.CCC_CONFIG_DIR;
    }
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

  isGitRepo(): boolean {
    return this.memo.get(
      "isGitRepo",
      () => {
        try {
          const result = $.sync({ nothrow: true })`git rev-parse --git-dir 2>/dev/null`;
          return result.exitCode === 0;
        } catch {
          return false;
        }
      },
      TTL.PERMANENT,
    );
  }

  getGitBranch(): string {
    return this.memo.get(
      "gitBranch",
      () => {
        try {
          const result = $.sync({ nothrow: true })`git rev-parse --abbrev-ref HEAD 2>/dev/null`;
          if (result.exitCode === 0) {
            return result.text().trim();
          }
          return "";
        } catch {
          return "";
        }
      },
      TTL.GIT_BRANCH,
    );
  }

  getGitStatus(): string {
    return this.memo.get(
      "gitStatus",
      () => {
        try {
          const result = $.sync({ nothrow: true })`git status --porcelain 2>/dev/null`;
          if (result.exitCode === 0) {
            return result.text();
          }
          return "";
        } catch {
          return "";
        }
      },
      TTL.GIT_STATUS,
    );
  }

  getGitRecentCommits(count = 5): string {
    return this.memo.get(
      `gitCommits:${count}`,
      () => {
        try {
          const result = $.sync({ nothrow: true })`git log --oneline -n ${count} 2>/dev/null`;
          if (result.exitCode === 0) {
            return result.text();
          }
          return "";
        } catch {
          return "";
        }
      },
      TTL.GIT_COMMITS,
    );
  }

  getDirectoryTree(): string {
    return this.memo.get(
      "directoryTree",
      () => {
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
      },
      TTL.DIRECTORY_TREE,
    );
  }

  getGitRemoteUrl(remote = "origin"): string {
    if (!this.isGitRepo()) return "";
    return this.memo.get(
      `gitRemote:${remote}`,
      () => {
        try {
          const result = $.sync({ nothrow: true })`git remote get-url ${remote} 2>/dev/null`;
          if (result.exitCode === 0) {
            return result.text().trim();
          }
          return "";
        } catch {
          return "";
        }
      },
      TTL.PERMANENT,
    );
  }

  getGitCommitHash(short = false): string {
    if (!this.isGitRepo()) return "";
    const cacheKey = short ? "gitCommitShort" : "gitCommitFull";
    return this.memo.get(
      cacheKey,
      () => {
        try {
          const args = short ? ["rev-parse", "--short", "HEAD"] : ["rev-parse", "HEAD"];
          const result = $.sync({ nothrow: true })`git ${args} 2>/dev/null`;
          if (result.exitCode === 0) {
            return result.text().trim();
          }
          return "";
        } catch {
          return "";
        }
      },
      TTL.GIT_BRANCH,
    );
  }

  getPackageJson(): Record<string, unknown> | null {
    return this.memo.get(
      "packageJson",
      () => {
        const pkgPath = join(this.workingDirectory, "package.json");
        try {
          return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
      TTL.PERMANENT,
    );
  }

  getEnv(key: string, defaultValue?: string): string | undefined {
    return process.env[key] ?? defaultValue;
  }

  isCI(): boolean {
    return this.memo.get(
      "isCI",
      () => {
        return Boolean(
          process.env.CI ||
            process.env.GITHUB_ACTIONS ||
            process.env.GITLAB_CI ||
            process.env.JENKINS_URL ||
            process.env.CIRCLECI ||
            process.env.TRAVIS ||
            process.env.BUILDKITE ||
            process.env.CODEBUILD_BUILD_ID,
        );
      },
      TTL.PERMANENT,
    );
  }

  getProjectRelativePath(absolutePath: string): string {
    return relative(this.workingDirectory, absolutePath);
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

  hasMCP(name: string): boolean {
    return Boolean(this.mcpServers?.[name]);
  }
}
