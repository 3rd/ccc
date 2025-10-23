import { createPrompt } from "@/config/helpers";

// System prompts build the "custom" output style
export default createPrompt((context) => {
  const isGitRepo = context.isGitRepo();
  const platform = context.getPlatform();
  const osVersion = context.getOsVersion();
  const currentDateTime = context.getCurrentDateTime();
  const workingDirectory = context.workingDirectory;

  //   const gitSection = (() => {
  //     if (!isGitRepo) return "";
  //     const branch = context.getGitBranch();
  //     const status = context.getGitStatus();
  //     const recentCommits = context.getGitRecentCommits();
  //     return `
  // Current branch: ${branch}
  //
  // Status:
  // ${status}
  //
  // Recent commits:
  // ${recentCommits}`;
  //   })();
  //   const directoryStructure = context.getDirectoryTree();

  // Ex. could include in prompt:
  // <directory-structure>
  // ${directoryStructure}
  // </directory-structure>
  //
  // Below is the Git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation:
  //
  // <git-status>
  // ${gitSection}
  // </git-status>

  return `
You are a coding agent that helps users with software engineering tasks.

---

Here is useful information about the environment you are running in:

<env>
Working directory: ${workingDirectory}
Is directory a git repo: ${isGitRepo}
Platform: ${platform}
OS Version: ${osVersion}
Session start timestamp: ${currentDateTime}
</env>
`.trim();
});
