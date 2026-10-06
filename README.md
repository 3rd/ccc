<img width="40" height="40" alt="CCC logo" src="https://github.com/user-attachments/assets/eaaf1e59-05fc-41a6-b41d-c5c78a6b573b"/>

---

**CCC** is a launcher for Claude Code that lets you configure prompts, commands, agents, skills, hooks, MCPs, and plugins from a single place, **in a layered way**.

- **Dynamic configuration:** generate prompts, commands, agents, and skills in TypeScript with access to the current project.
- **Layered config:** merge global configuration with auto-detected presets and project overrides.
- **Low‑effort extensibility:** write hooks, MCP servers, statuslines, and workflows in TypeScript with tiny helpers.

<img width="2089" height="885" alt="CCC config files in an editor next to a Claude Code session running the configured hooks and MCPs" src="https://github.com/user-attachments/assets/f3483ce9-a001-4ee4-a801-7550dde9a1ae" />

> Not affiliated with Anthropic. Uses the official `@anthropic-ai/claude-code` CLI.

> Warning: Not tested on Windows, open an issue if you run into problems.

---

## Getting Started

### 1. Setup

```bash
# clone this repo somewhere you'd like to keep going to edit your configuration
git clone https://github.com/3rd/ccc.git ~/my-claude-launcher
cd ~/my-claude-launcher

# install dependencies and link `ccc`
bun install
bun link
```

**Requirements**:

- [Bun](https://bun.sh) on `PATH`. `ccc` runs under Bun, and so do config loading, hooks, inline MCPs, and the statusline.
- Node.js 24 or newer on `PATH`, or set `CCC_NODE` to a Node binary. Claude Code itself runs under Node.
- Optional, Linux only: `unshare` (util-linux 2.38+) and a C compiler (`cc`). With them, child processes such as Bash tool commands also see your generated config (see [How It Works](#how-it-works)). Without them, CCC skips that step and still works.

**Claude Code version**: `@anthropic-ai/claude-code` is pinned to an exact version in `package.json`, so `bun update` leaves it unchanged. To try another release, run `bun add @anthropic-ai/claude-code@<version>`; at startup, CCC lists any runtime patch that no longer matches as `stale`. To run a different Claude Code executable without changing the dependency, set `CLAUDE_PATH`. CCC supports Claude Code 2.1.242 and later.

### 2. Customize your config

Your configuration lives in `./config`, which ships with examples:

```
~/my-claude-launcher/     # Your copy of this repository
└── config/
    ├── global/           # Applies everywhere
    │   ├── prompts/      # system.ts (system prompt) and user.ts (CLAUDE.md)
    │   ├── commands/     # Slash commands
    │   ├── agents/       # Sub-agents
    │   ├── settings.ts   # Claude Code settings plus CCC-only keys
    │   ├── hooks.ts      # Hooks
    │   ├── mcps.ts       # MCP servers
    │   └── statusline.ts # Statusline
    └── presets/          # Language/framework/whatever-specific configs
        ├── golang/
        ├── rust/
        └── typescript/
```

Add more as you need it: `skills/`, `rules/`, `output-styles/`, `workflows/`, and `plugins.ts` in any layer; `projects/<name>/` for project overrides; `plugins/` for [CCC plugins](#ccc-plugins); and `claude-plugins/` for local [Claude plugins](#claude-plugins).

CCC picks the config directory in this order:

1. `CCC_CONFIG_DIR`, if set (absolute, or relative to the launcher directory).
2. `./dev-config`, if it exists. Keep the committed examples in `./config` and your real configuration in `./dev-config`.
3. `./config`.

### 3. Use it

1. Edit your config.
2. Run `ccc` instead of `claude`, from anywhere.
3. CCC builds your config and launches Claude Code with it.

```sh
ccc                       # launch Claude Code
ccc --continue            # every argument is passed through to claude

ccc --profile <name>      # apply a settings profile (see Profiles); not passed to claude
ccc --plugin-dir <path>   # use this Claude plugin dir instead of the configured pluginDirs
ccc --doru --continue     # run through `npx doru --ui` to inspect network traffic
```

`--doru` is a launcher-only flag: put it before any Claude args. It opens doru's live UI; the first run may download `doru`, which needs `npx` and Node.js 22+.

To inspect your config without launching Claude, see [Debugging](#debugging).

## How It Works

CCC injects your configuration through a virtual filesystem instead of writing it to disk. It never modifies your Claude Code installation, and your real `~/.claude/settings.json` and `~/.claude/CLAUDE.md` keep their contents.

```
Global  ┐
Preset  ├─► merge ─► virtual ~/.claude ─► Claude Code (patched, under Node)
Project ┘
```

1. CCC loads and merges every layer (global, presets, project) plus enabled [CCC plugins](#ccc-plugins).
2. It extracts the JavaScript module graph from the native Claude Code binary and applies [runtime patches](#runtime-patches).
3. It starts Claude Code under Node with the `fs` module intercepted. Reads of `~/.claude.json`, `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, and the `~/.claude/{commands,agents,skills,rules,output-styles,workflows}` directories return the merged config.
4. On Linux, the session runs in a private user and mount namespace, where each of those directories that has generated content is a session-private tmpfs mount. Child processes, such as Bash tool commands and sub-agent CLIs, then see the same content. `sudo` does not work inside the namespace; set `CCC_NS_VFS=0` to turn the namespace off.

Settings changes made during a session, such as `/model`, last for that session only.

## Configuration Layers

CCC loads configuration in layers; later layers override earlier ones:

1. **Global** → `config/global/`
2. **Presets** → `config/presets/<name>/`: every preset whose matcher accepts the current project, in alphabetical order
3. **Project** → `config/projects/<name>/`: the project whose root contains the working directory

Each layer can contain:

- `settings.ts` - Claude Code settings plus [CCC-only keys](#settings)
- `prompts/system.{md,append.md,ts}` - [system prompt](#system-prompt)
- `prompts/user.{md,append.md,ts}` - [user prompt](#user-prompt-claudemd) (`~/.claude/CLAUDE.md`)
- `commands/*.{md,append.md,ts}` - [slash commands](#commands)
- `agents/*.{md,append.md,ts}` - [sub-agents](#agents)
- `skills/<name>/SKILL.{md,ts}` - [skills](#skills) and their supporting files
- `rules/**/*.md` - [rules](#rules)
- `output-styles/*.md` - [output styles](#output-styles)
- `workflows/*.{ts,js}` - [workflows](#workflows)
- `hooks.ts` - [hooks](#hooks)
- `mcps.ts` - [MCP servers](#mcps)
- `plugins.ts` - [Claude plugins](#claude-plugins) and [CCC plugins](#ccc-plugins)

`statusline.ts` is read from `global/` only. Presets and projects also need an `index.ts` that identifies them.

How layers combine:

- **Settings:** a later layer replaces each top-level key it sets, except `env` and `featureFlags`, which merge key by key.
- **Prompts, commands, agents:** a `.md` file or `createPrompt` replaces earlier layers; an `.append.md` file or `createAppendPrompt` adds to them. When one name has several files, `.ts` wins over `.append.md`, which wins over `.md`.
- **Skills:** a later layer replaces a skill with the same name, unless it uses `mode: "append"`.
- **Output styles, workflows, MCPs:** a later layer replaces an entry with the same name.
- **Rules:** every layer's rules apply together.
- **Hooks:** hooks from every layer run.
- **Plugins:** `ccc` and `claude.enabledPlugins` entries merge by name; the last layer that sets `claude.pluginDirs` wins.

### Presets

A preset applies to every project its matcher accepts:

```typescript
// config/presets/typescript/index.ts
import { createPreset } from "@/config/helpers";

export default createPreset({
  name: "typescript",
  matcher: ({ project }) => project.hasFile("tsconfig.json"),
});
```

Keep `name` equal to the folder name; CCC reads the preset's other files from `config/presets/<name>/`.

The project root is the nearest directory, from the working directory upward, that contains `.root`, `.git`, `package.json`, `go.mod`, `Cargo.toml`, or `pyproject.toml`. `project.hasFile()` and `project.hasDirectory()` accept a relative path or a glob pattern, and also check nested sub-projects (directories with one of those markers) up to 4 levels below the root.

### Projects

A project applies when the working directory is inside its `root`; if several roots match, the longest wins:

```typescript
// config/projects/myapp/index.ts
import { createProject } from "@/config/helpers";

export default createProject({
  name: "myapp",
  root: "~/code/myapp", // supports ~/ and $ENV_VARS
  disableParentClaudeMds: false, // optional: hide CLAUDE.md files from parent directories
});
```

```typescript
// config/projects/myapp/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  env: {
    NODE_ENV: "development",
    API_URL: "http://localhost:3000",
  },
});
```

Keep `name` equal to the folder name; CCC reads the project's other files from `config/projects/<name>/`.

### Disabling Entries

Most entries accept `enabled: false`, which leaves them out of the generated config without deleting them:

- Prompts, commands, and agents written in TypeScript: `createPrompt({ handler, enabled: false })`, and the same for the other prompt helpers
- Presets: `createPreset({ ..., enabled: false })`
- Skills: `enabled: false` in `SKILL.ts`
- MCP entries, hook definitions, and individual hooks: `enabled: false`
- CCC plugins: `false` in `plugins.ts`, or `enabled: false` in the plugin definition

## Settings

`settings.ts` holds Claude Code settings, which CCC writes to the virtual `~/.claude/settings.json`. CCC validates them against its schema (`src/config/schema.ts`) and drops keys the schema doesn't know. Setting `model: "auto"` removes the `model` key so Claude Code uses its default.

These CCC-only keys are read by CCC and never written to `settings.json`:

- `cli` - [Claude Code CLI flags](#cli-argument-settings)
- `profiles` - [named setting groups](#profiles) selected with `--profile`
- `patches` - [runtime patches](#user-defined-patches)
- `featureFlags` - [feature flag overrides](#feature-flags)
- `claudeState` - [keys for `~/.claude.json`](#claude-state)

Variables already set in your shell win over `env`: CCC leaves out any `env` key that already exists in its own environment.

### Using Models from Other Vendors

Any vendor with an Anthropic-compatible API works through `env`:

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  env: {
    // Z.ai (GLM)
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_AUTH_TOKEN: "<z.ai API key>",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",

    // Moonshot (Kimi)
    // ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
    // ANTHROPIC_AUTH_TOKEN: "<Moonshot API key>",
    // ANTHROPIC_MODEL: "kimi-k2.6",

    // DeepSeek
    // ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    // ANTHROPIC_AUTH_TOKEN: "<DeepSeek API key>",
    // ANTHROPIC_MODEL: "deepseek-v4-pro[1m]",
    // ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
  },
});
```

- `ANTHROPIC_BASE_URL` - the vendor's Anthropic-compatible endpoint
- `ANTHROPIC_AUTH_TOKEN` - your API key for the vendor
- `ANTHROPIC_MODEL` - the main model
- `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL` - the models behind the `opus`, `sonnet`, and `haiku` aliases; Claude Code also uses the haiku model for background tasks

Vendors rename models often, so check the vendor's Claude Code guide for current names. To switch vendors per launch, put these variables in a [profile](#profiles).

### Profiles

Profiles are named groups of settings selected at launch:

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  profiles: {
    glm: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "<z.ai API key>",
      },
    },
    planning: {
      cli: { permissionMode: "plan" },
    },
  },
});
```

```sh
ccc --profile glm
```

- Profiles with the same name merge across layers.
- The selected profile merges over the merged settings, with the same rules as layers.
- A profile's `env` is also exported to the process environment before Claude Code starts, so authentication tokens in a profile take effect.
- An unknown profile name stops the launch and lists the available profiles; `ccc --print-config` lists them too.

### Claude State

CCC serves a virtual `~/.claude.json` built from your real one, with the workspace trust prompt already accepted for the project root and working directory. To force top-level `~/.claude.json` keys, set them in `claudeState`:

```typescript
export default createConfigSettings({
  claudeState: {
    leftArrowOpensAgents: false,
  },
});
```

Keys in `claudeState` win over your real `~/.claude.json`; everything else is still read from that file.

### Feature Flags

`featureFlags` overrides Claude Code's GrowthBook feature flags:

```typescript
export default createConfigSettings({
  featureFlags: {
    some_flag_name: true,
  },
});
```

CCC writes the values into the virtual `~/.claude.json` feature cache and patches Claude Code's flag readers so these values win. Set `CCC_DEBUG_FEATURE_FLAGS=1` to log each override as Claude Code reads it.

### CLI Argument Settings

`settings.cli` holds Claude Code command-line flags, which CCC passes on every launch. See the [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags) for details.

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  cli: {
    disallowedTools: ["WebSearch", "WebFetch"],
    allowedTools: ["Read", "Glob", "Grep"],
    addDir: ["/path/to/shared/libs"],
    permissionMode: "plan",
    debug: "api,hooks",
    agent: "code-reviewer",
  },
});
```

A flag you pass to `ccc`, as `--flag value` or `--flag=value`, replaces the matching `settings.cli` value, for example `ccc --permission-mode plan`.

- `tools` (`string[]` or `"default"`, `--tools "Tool1,Tool2"`): Available tools (`"default"` for all, `[]` to disable)
- `disallowedTools` (`string[]`, `--disallowedTools "Tool1,Tool2"`): Tools removed from model context entirely
- `allowedTools` (`string[]`, `--allowedTools "Tool1,Tool2"`): Tools that execute without permission prompts
- `addDir` (`string[]`, `--add-dir path`, one flag per entry): Additional directories Claude can access
- `permissionMode` (`enum`, `--permission-mode mode`): Start mode: `default`, `acceptEdits`, `auto`, `plan`, `bypassPermissions`, `dontAsk`
- `dangerouslySkipPermissions` (`boolean`, `--dangerously-skip-permissions`): Bypass all permission checks
- `allowDangerouslySkipPermissions` (`boolean`, `--allow-dangerously-skip-permissions`): Allow bypassing permissions without starting in that mode
- `permissionPromptTool` (`string`, `--permission-prompt-tool name`): MCP tool that answers permission prompts in non-interactive mode
- `model` (`string`, `--model name`): Model for the session
- `fallbackModel` (`string`, `--fallback-model name`): Fallback model when primary is overloaded
- `effort` (`enum`, `--effort level`): Effort level: `low`, `medium`, `high`, `xhigh`, `max`
- `thinking` (`enum`, `--thinking mode`): Thinking mode: `enabled`, `adaptive`, `disabled`
- `betas` (`string[]`, `--betas "beta1,beta2"`): Beta headers for API requests (API key users only)
- `agent` (`string`, `--agent name`): Default agent for the session
- `agents` (`Record<string, AgentDef>`, `--agents JSON`): Custom subagent definitions
- `systemPrompt` (`string`, `--system-prompt text`): Replace Claude Code's system prompt
- `systemPromptFile` (`string`, `--system-prompt-file path`): Replace Claude Code's system prompt with a file's contents
- `appendSystemPrompt` (`string`, `--append-system-prompt text`): Text appended after the [CCC system prompt](#system-prompt)
- `appendSystemPromptFile` (`string`, `--append-system-prompt-file path`): Append a file's contents to the system prompt
- `appendSubagentSystemPrompt` (`string`, `--append-subagent-system-prompt text`): Text appended to every subagent's system prompt, instead of the CCC system prompt
- `appendSubagentSystemPromptFile` (`string`, `--append-subagent-system-prompt-file path`): Same as above, read from a file
- `settingSources` (`string[]`, `--setting-sources "user,project,local"`): Config sources to use
- `settings` (`string`, `--settings path-or-json`): Load additional settings from a file or JSON string
- `strictMcpConfig` (`boolean`, `--strict-mcp-config`): Only use specified MCP config
- `channels` (`string[]`, `--channels server`, one flag per entry): MCP servers whose channel notifications register this session
- `dangerouslyLoadDevelopmentChannels` (`string[]`, `--dangerously-load-development-channels server`, one flag per entry): Load channel servers that are not on the approved allowlist (local development only)
- `disableSlashCommands` (`boolean`, `--disable-slash-commands`): Disable slash commands
- `chrome` (`boolean`, `--chrome` / `--no-chrome`): Enable/disable Chrome browser integration
- `ide` (`boolean`, `--ide`): Auto-connect to IDE on startup
- `worktree` (`boolean` or `string`, `--worktree [name]`): Run the session in a new git worktree
- `tmux` (`boolean` or `string`, `--tmux` or `--tmux=<value>`): Create a tmux session for the worktree; `"classic"` uses plain tmux instead of iTerm2 panes
- `teammateMode` (`enum`, `--teammate-mode mode`): Agent team display: `auto`, `in-process`, `iterm2`, `tmux`
- `forkSession` (`boolean`, `--fork-session`): Create new session ID when resuming
- `sessionId` (`string`, `--session-id id`): Use a specific session ID
- `fromPr` (`number` or `string`, `--from-pr pr`): Resume the session linked to a PR number or URL
- `init` (`boolean`, `--init`): Run Setup hooks with the init trigger, then continue
- `initOnly` (`boolean`, `--init-only`): Run Setup and SessionStart hooks, then exit
- `maintenance` (`boolean`, `--maintenance`): Run Setup hooks with the maintenance trigger, then continue
- `file` (`string[]`, `--file spec`, one flag per entry): File resources to download at startup (`file_id:relative_path`)
- `verbose` (`boolean`, `--verbose`): Enable verbose logging
- `debug` (`boolean` or `string`, `--debug [filter]`): Enable debug mode, optionally with category filter; also enables CCC's debug log
- `debugFile` (`string`, `--debug-file path`): Write debug logs to a file
- `enableLspLogging` (`boolean`, `--enable-lsp-logging`): Enable verbose LSP logging
- `outputFormat` (`enum`, `--output-format format`): Print mode output: `text`, `json`, `stream-json`
- `inputFormat` (`enum`, `--input-format format`): Print mode input: `text`, `stream-json`
- `jsonSchema` (`string`, `--json-schema schema`): Validate print mode output against a JSON schema
- `maxTurns` (`number`, `--max-turns n`): Limit agentic turns (print mode only)
- `maxBudgetUsd` (`number`, `--max-budget-usd n`): Maximum dollar amount to spend on API calls (print mode only)
- `noSessionPersistence` (`boolean`, `--no-session-persistence`): Don't save the session (print mode only)
- `includePartialMessages` (`boolean`, `--include-partial-messages`): Include partial streaming events (print mode with `stream-json`)
- `replayUserMessages` (`boolean`, `--replay-user-messages`): Re-emit stdin user messages on stdout (`stream-json` input and output)

## Prompts

Prompts, commands, and agents share one format. A `.md` file is static. A `.ts` file builds the content from the [context object](#context-object), with `createPrompt`, `createCommand`, or `createAgent` to replace earlier layers, or `createAppendPrompt`, `createAppendCommand`, or `createAppendAgent` to add to them. A `<name>.append.md` file is the static form of append.

### System Prompt

The system prompt is appended to Claude Code's default system prompt with `--append-system-prompt`. CCC also appends it to every subagent's system prompt, unless you set `cli.appendSubagentSystemPrompt` or `cli.appendSubagentSystemPromptFile`, or pass either flag yourself. It is separate from Claude Code's [output styles](#output-styles).

```typescript
// config/global/prompts/system.ts
import { createPrompt } from "@/config/helpers";

export default createPrompt(
  (context) => `
You are working in ${context.workingDirectory}
${context.isGitRepo() ? `Current branch: ${context.getGitBranch()}` : ""}
Write clean, maintainable code.
`,
);
```

```typescript
// config/presets/typescript/prompts/system.ts
import { createAppendPrompt } from "@/config/helpers";

export default createAppendPrompt(
  () => `
Additional instructions for TypeScript projects.
`,
);
```

### User Prompt (CLAUDE.md)

The user prompt is served as `~/.claude/CLAUDE.md`. The example config ships `config/global/prompts/user.ts`:

```typescript
import { createPrompt } from "@/config/helpers";

export default createPrompt(
  (context) => `
# CRITICAL RULES

Do exactly what the user asks. No alternatives, no "better" solutions...

Working in: ${context.workingDirectory}
Git branch: ${context.getGitBranch()}
`,
);
```

## Commands

Each file in `commands/` is a slash command named after the file; `review.md` becomes `/review`. The example config ships `commit.md` and `template.md`.

`config/global/commands/review.md`:

```markdown
# Review

Review: "$ARGUMENTS"
You are conducting a code review...
```

```typescript
// config/global/commands/branch-status.ts
import { createCommand } from "@/config/helpers";

export default createCommand(
  (context) => `
# Branch Status

Working in ${context.workingDirectory}
Current branch: ${context.getGitBranch()}
`,
);
```

Commands in the working directory's `.claude/commands/*.md` are added too, and replace a layered command with the same name.

## Agents

Each file in `agents/` defines a sub-agent. `config/global/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: [Read, Grep, Glob, Bash]
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately
```

```typescript
// config/global/agents/debugger.ts
import { basename } from "node:path";
import { createAgent } from "@/config/helpers";

export default createAgent(
  (context) => `
---
name: debugger
description: Debug issues in ${basename(context.project.rootDirectory)}
tools: [Read, Edit, Bash, Grep, Glob]
---

You are debugging code in ${context.workingDirectory}
Current branch: ${context.getGitBranch()}
`,
);
```

Agents in the working directory's `.claude/agents/*.md` are added too, and replace a layered agent with the same name.

## Skills

Skills are reusable instruction bundles that Claude invokes with its Skill tool. Each skill is a folder under `skills/` with a `SKILL.md` (static) or `SKILL.ts` (structured), plus any supporting files such as `references/*.md`.

`config/global/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: Quick checks for the current repo
allowed-tools:
  - Read
  - Grep
---

Use this skill to run quick repository checks and summarize findings.
```

```typescript
// config/global/skills/my-skill/SKILL.ts
import { basename } from "node:path";
import { createSkill } from "@/config/helpers";

export default createSkill((context) => ({
  description: `Checks for ${basename(context.project.rootDirectory)}`,
  content: `
Run targeted analysis for ${context.workingDirectory}.
Use $ARGUMENTS to accept parameters.
`,
  allowedTools: ["Read", "Grep"],
  userInvocable: true,
  disableModelInvocation: false,
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "echo 'Skill hook'" }],
      },
    ],
  },
}));
```

- The skill name defaults to the folder name.
- `SKILL.ts` also supports `model`, `context: "fork"`, `agent`, `disallowedTools`, `isolation`, `background`, `effort`, extra `frontmatter`, and generated `files`; see `SkillDefinition` in `src/types/skills.ts`.
- Skill layers resolve global, then presets, then project, then CCC plugins. A later skill with the same name replaces the earlier one, unless it sets `mode: "append"`: then its body and description are appended, its files are added, and the earlier skill's other metadata is kept. An append-mode skill with no earlier skill must have its own description.

## Rules

Markdown files under `rules/`, including subfolders, are served from `~/.claude/rules/`. Global rules keep their relative path; preset rules are placed under `<preset-name>/` and project rules under `project/`, so every layer's rules apply together.

## Output Styles

Markdown files in `output-styles/` are served from `~/.claude/output-styles/`; a later layer replaces a file with the same name. Select a style with `outputStyle`, using its frontmatter `name`, or the file name without `.md` when there is no `name`:

```typescript
export default createConfigSettings({
  outputStyle: "concise",
});
```

## Hooks

Hooks run TypeScript handlers on Claude Code events. `createHook` handlers run in `bun` processes that Claude Code starts for each event. Hook lists can also contain plain Claude Code hook entries such as `{ type: "command", command: "..." }`. See `config/global/hooks.ts` for more examples.

```typescript
// config/global/hooks.ts
import p from "picocolors";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

const bashDenyList = [
  {
    match: /^git\s+(checkout|reset)\b/,
    message: "You are not allowed to do checkouts or resets",
  },
  {
    match: /^grep\b(?!.*\|)/,
    message: "Use 'rg' (ripgrep) instead of 'grep' for better performance",
  },
];

const sessionStartHook = createHook({
  event: "SessionStart",
  id: "global-session-start",
  handler: (input) => {
    console.log(`🚀 Session started from ${p.yellow(input.source)} in ${p.yellow(process.cwd())}`);
  },
});

const preBashValidationHook = createHook({
  event: "PreToolUse",
  id: "bash-deny-list",
  handler: (input) => {
    const command = input.tool_input.command;
    if (input.tool_name !== "Bash" || typeof command !== "string") return;
    const firstMatchingRule = bashDenyList.find((rule) => rule.match.test(command));
    if (!firstMatchingRule) return;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: firstMatchingRule.message,
      },
    };
  },
});

export default createConfigHooks({
  SessionStart: [{ hooks: [sessionStartHook] }],
  PreToolUse: [{ matcher: "Bash", hooks: [preBashValidationHook] }],
});
```

A preset can block the end of a turn until the project typechecks:

```typescript
// config/presets/typescript/hooks.ts
import { $ } from "zx";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

export default createConfigHooks({
  Stop: [
    {
      hooks: [
        createHook({
          event: "Stop",
          id: "typescript-validation",
          handler: async () => {
            const result = await $({ nothrow: true })`tsc --noEmit`;
            if (result.exitCode !== 0) {
              return {
                decision: "block",
                reason: `Failed tsc --noEmit:\n${result.text()}`,
              };
            }
            return { suppressOutput: true };
          },
        }),
      ],
    },
  ],
});
```

`createHook` options:

- `timeout` - timeout in seconds
- `once` - run only the first time in a session
- `scope` - `"main"` (default) skips events fired inside subagents; `"all"` runs for them too
- `batchable` - run together with other batchable hooks for the same event in one `bun` process; a hook joins a batch only when it sets no `timeout` or `once`

`getSessionContext()` from `@/config/helpers` returns the session ID and the hook events recorded so far; the example `config/global/mcps.ts` uses it from an inline MCP.

## MCPs

`mcps.ts` defines MCP servers. Servers can be stdio (`command`), `type: "http"`, `type: "sse"`, or inline TypeScript servers. See `config/global/mcps.ts` for examples.

```typescript
// config/global/mcps.ts
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createConfigMCPs, createMCP } from "@/config/helpers";

const customTools = createMCP((context) => {
  const server = new FastMCP({ name: "custom-tools", version: "1.0.0" });

  server.addTool({
    name: "getProjectInfo",
    description: "Get current project information",
    parameters: z.object({}),
    execute: async () =>
      JSON.stringify({ directory: context.workingDirectory, branch: context.getGitBranch() }, null, 2),
  });

  return server;
});

export default createConfigMCPs({
  "local-server": {
    command: "/path/to/mcp-server",
    args: ["--stdio"],
    env: { SERVER_ROOT: "/home/user" },
    filter: (tool) => tool.name !== "unwanted_tool",
  },
  "remote-server": {
    type: "http",
    url: "https://mcp.example.com/mcp",
  },
  "custom-tools": customTools,
});
```

- Inline servers are built with [FastMCP](https://github.com/punkpeye/fastmcp); each one runs as its own `bun` process.
- `filter` receives each tool's `name` and `description`; return `false` to hide the tool. CCC serves a filtered server through a local stdio proxy, so filtering works for stdio, HTTP, and SSE servers.

## Workflows

Workflows are deterministic scripts that orchestrate multiple subagents. Claude Code runs them with its `Workflow` tool.

```typescript
// config/global/workflows/find-flaky-tests.ts
import { z } from "zod/v4";
import { createWorkflow } from "@/config/helpers";

const argsSchema = z.object({
  pattern: z.string().describe("Test name, file glob, or failure pattern to investigate"),
});

export default createWorkflow({
  name: "find-flaky-tests",
  description: "Find flaky tests and propose fixes",
  schema: argsSchema,
  phases: [{ title: "Scan" }, { title: "Verify", model: "haiku" }],
  handler: async ({ args, agent, phase, log }) => {
    phase("Scan");
    const flaky = await agent<string[]>(`Find flaky tests matching ${args.pattern}`, {
      schema: { type: "array", items: { type: "string" } },
    });
    log(`found ${flaky.length}`);
    return flaky;
  },
});
```

CCC bundles each workflow and its imports into `~/.claude/workflows/<name>.js`.

- `name` and `description` are required; `whenToUse`, `schema`, and `phases` are optional.
- Metadata must be literal values written directly in the `createWorkflow` call.
- `schema` must be a `zod/v4` schema. CCC infers the type of `args` from it and appends its JSON Schema to `whenToUse`.
- The handler receives `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args`, and `budget`.
- Claude Code rejects workflow files larger than 512 KiB, and workflows that call `Date.now()`, `new Date()`, or `Math.random()`, because they break resume.
- Claude Code enables workflows by default except on the Pro plan. Set `CLAUDE_CODE_WORKFLOWS: "1"` in `env` to force them on.

## Statusline

CCC picks the statusline in this order:

1. `config/global/statusline.ts`, run with `bun`
2. `settings.statusLine`, for example `{ type: "command", command: "/path/to/statusline-script" }`
3. none

Statuslines don't layer: only the global file or the merged `statusLine` setting is used.

```typescript
// config/global/statusline.ts
import { createStatusline } from "@/config/helpers";
import type { StatusLineInput } from "@/types/statusline";

export default createStatusline(async (data: StatusLineInput) => {
  const modelIcon = data.model.id.includes("opus") ? "🦆" : "🐇";
  const dir = data.workspace.project_dir || data.workspace.current_dir;
  const components = [`${modelIcon} ${data.model.display_name}`, `📁 ${dir.split("/").slice(-2).join("/")}`];

  if (data.context_window.used_percentage !== null) {
    components.push(`🧠 ${Math.round(data.context_window.used_percentage)}%`);
  }

  console.log(components.join(" │ "));
});
```

You can also pipe the input to another statusline command:

```typescript
import { createStatusline } from "@/config/helpers";
import { $ } from "bun";

export default createStatusline(async (data) => {
  const output = await $`echo ${JSON.stringify(data)} | /path/to/statusline-command`.text();
  console.log(output.trim());
});
```

The handler receives the JSON Claude Code sends to statusline commands. Commonly used fields:

- `model.id`, `model.display_name` - the current model
- `workspace.current_dir`, `workspace.project_dir`, `cwd` - directories
- `session_id`, `transcript_path`, `version` - session details
- `output_style.name` - active output style
- `cost` - session cost, duration, and lines changed
- `context_window` - token counts and context usage percentage
- `rate_limits` - usage limit windows, when available
- `effort`, `thinking`, `fast_mode`, `vim`, `agent`, `worktree`, `pr` - session modes

See `src/types/statusline.ts` for every field.

## Claude Plugins

`plugins.ts` configures Claude Code's own plugins under the `claude` key, in any layer.

To enable an installed plugin, install it with `/plugin`, find its key in `~/.claude/plugins/installed_plugins.json`, and add it to `enabledPlugins`. LSP plugins work the same way.

```typescript
// config/global/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  claude: {
    enabledPlugins: {
      "typescript-lsp@claude-plugins-official": true,
      "gopls-lsp@claude-plugins-official": true,
    },
    extraKnownMarketplaces: {
      "my-marketplace": { source: "github", repo: "owner/repo" },
      "local-marketplace": { source: "local", path: "/path/to/marketplace" },
    },
    pluginDirs: [
      "./claude-plugins/my-plugin", // relative paths resolve against the config directory
    ],
  },
});
```

- Local plugins in `config/claude-plugins/<name>/` are discovered automatically; each needs a `.claude-plugin/plugin.json`.
- `ccc --plugin-dir <path>` replaces the configured `pluginDirs` for that launch.

## CCC Plugins

CCC plugins are local TypeScript modules that bundle commands, skills, agents, workflows, MCPs, hooks, and prompts, with typed settings and optional persistent state. Unlike [Claude plugins](#claude-plugins), they are built per launch with access to the [context object](#context-object).

### Structure

```
config/plugins/my-plugin/
├── plugin.json    # manifest
└── index.ts       # definition, using createPlugin() (or index.js)
```

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A custom CCC plugin",
  "author": "Your Name",
  "license": "MIT",
  "homepage": "https://example.com/my-plugin",
  "repository": "https://github.com/user/my-plugin",
  "dependencies": ["base-plugin"]
}
```

`name` (kebab-case), `version` (semver), and `description` are required.

CCC looks for plugins in `<launcher>/plugins/`, `~/.ccc/plugins/`, `<project root>/.ccc/plugins/`, and `<config>/plugins/`, in that order; when two plugins share a name, the first one found wins. A plugin loads only when it is enabled in a `plugins.ts` layer:

```typescript
// config/global/plugins.ts
import { createConfigPlugins } from "@/config/helpers";

export default createConfigPlugins({
  ccc: {
    "my-plugin": true,
    "another-plugin": false,
    "configurable-plugin": {
      enabled: true,
      settings: { maxItems: 50, mode: "fast" },
    },
  },
});
```

### Definition

`createPlugin` takes these optional fields. Each component function receives the plugin context and returns entries keyed by name:

- `commands` - `{ content, mode }` per command
- `skills` - the same fields as `SKILL.ts`
- `agents` - `{ content, mode }` per agent
- `workflows` - a workflow source path, relative to the plugin folder
- `mcps` - the same entries as `mcps.ts`
- `hooks` - the same shape as `hooks.ts`
- `prompts` - `{ system?, user? }`, each a string or `{ content, mode }`; always appended after the layered prompts
- `settingsSchema` - a Zod schema for the plugin's settings
- `stateType` - where `context.state` is stored
- `onLoad` - a callback run when the plugin loads
- `enabled` - `false` to disable the plugin

Plugin commands, skills, agents, workflows, and MCPs are namespaced with the plugin name, such as `/task-tracker:track` in the example below. A config layer's workflow wins over a plugin workflow with the same name.

```typescript
// config/plugins/task-tracker/index.ts
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createMCP, createPlugin } from "@/config/helpers";
import { createHook } from "@/hooks/hook-generator";

export default createPlugin({
  stateType: "project",

  commands: () => ({
    track: {
      content: `
# Task Tracker
Track a new task: "$ARGUMENTS"
Use the task_add MCP tool to add this task.
      `.trim(),
      mode: "override",
    },
  }),

  mcps: (context) => ({
    "task-tracker": createMCP(() => {
      const server = new FastMCP({ name: "task-tracker", version: "1.0.0" });

      server.addTool({
        name: "task_add",
        description: "Add a new task",
        parameters: z.object({
          title: z.string(),
          priority: z.enum(["low", "medium", "high"]).default("medium"),
        }),
        execute: async (args) => {
          context.state.update((state) => {
            const tasks = state.get<string[]>("tasks") ?? [];
            state.set("tasks", [...tasks, `[${args.priority}] ${args.title}`]);
          });
          return `Added: ${args.title}`;
        },
      });

      server.addTool({
        name: "task_list",
        description: "List all tasks",
        parameters: z.object({}),
        execute: async () => {
          const tasks = context.state.get<string[]>("tasks") ?? [];
          return tasks.length > 0 ? tasks.join("\n") : "No tasks";
        },
      });

      return server;
    }),
  }),

  hooks: () => ({
    SessionStart: [
      {
        hooks: [
          createHook({
            event: "SessionStart",
            id: "task-tracker-init",
            handler: () => {
              console.log("📋 Task Tracker plugin loaded");
            },
          }),
        ],
      },
    ],
  }),
});
```

`ccc --print-config` lists loaded plugins and their components:

```
CCC Plugins:
  task-tracker (v1.0.0) [enabled]
    Commands: task-tracker:track
    MCPs: task-tracker:task-tracker
    Hooks: SessionStart(1)
```

### Plugin Context

Component functions and `onLoad` receive a `PluginContext`: every [context object](#context-object) member, plus:

```typescript
{
  plugin: {
    name: string;     // from plugin.json
    version: string;  // from plugin.json
    root: string;     // plugin directory
    settings: S;      // validated plugin settings
  };
  state: PluginState; // see Plugin State
  getPlugin(name: string): PluginContext | undefined; // another loaded plugin's context
}
```

### Plugin Settings

Define settings with a Zod schema; `context.plugin.settings` is typed from it:

```typescript
// config/plugins/configurable-plugin/index.ts
import { z } from "zod";
import { createPlugin } from "@/config/helpers";

const settingsSchema = z.object({
  maxItems: z.number().default(100),
  mode: z.enum(["fast", "balanced", "thorough"]).default("balanced"),
});

export default createPlugin({
  settingsSchema,
  onLoad: (context) => {
    const { maxItems, mode } = context.plugin.settings;
    console.log(`loaded with maxItems=${maxItems} mode=${mode}`);
  },
});
```

Pass values with `settings` in `plugins.ts`, as shown in [Structure](#structure). CCC validates them when the plugin loads; if validation fails, CCC logs the error and continues without the plugin.

### Plugin State

`context.state` is a key-value store:

```typescript
context.state.get<T>(key)       // read a value
context.state.set(key, value)   // write a value
context.state.getAll()          // read all values
context.state.clear()           // remove all values
context.state.update((state) => { /* get and set */ }) // atomic read-modify-write
```

`stateType` selects where it lives:

- `"none"` (default) - in memory only, for state that doesn't need to persist
- `"temp"` - `/tmp/ccc-plugin-{name}-{instanceId}.json`, per-session state cleared on reboot
- `"project"` - `{working directory}/.ccc/state/plugins/{name}.json`, persistent state for one project
- `"user"` - `~/.ccc/state/plugins/{name}.json`, persistent state shared across projects

- The instance ID is the `CCC_INSTANCE_ID` of the current CCC session.
- Hooks and inline MCPs run in their own processes, so they share state only through a file-backed `stateType`.
- `update()` runs the change under a file lock, and throws a `PluginStateError` with code `busy` if another process holds the lock.
- `onLoad` runs in every process that loads the plugin: once at launch, and again in each hook or inline MCP process that needs it.

### Plugin Dependencies

`dependencies` in `plugin.json` load before the plugins that list them. A dependency is not enabled automatically, so enable it in `plugins.ts` too. A circular dependency stops all CCC plugins from loading.

## Runtime Patches

CCC patches Claude Code at runtime and never modifies `node_modules`. It extracts the JavaScript module graph embedded in the Claude Code binary to `~/.cache/ccc/claude-cli/<version>/`, applies the patches, caches the result in `~/.cache/ccc/claude-cli-patched/`, and runs Claude Code from there. Both paths move under `$XDG_CACHE_HOME` when it is set.

Built-in patches, applied on every launch:

- Disable the `/security-review` command
- Make [`featureFlags`](#feature-flags) override Claude Code's feature flags
- Stop the Bash tool from replacing `find` and `grep` with the native binary's built-in versions, which do not work when Claude Code runs under Node
- Load Claude Code's built-in plugins from memory, as the native binary does, because the folder path they otherwise use only exists under Bun

### User-defined Patches

```typescript
export default createConfigSettings({
  patches: [
    { find: "ultrathink", replace: "uuu" },
    { name: "my-patch", fn: (source) => source.replace("old text", "new text") },
  ],
});
```

- A `find`/`replace` patch replaces every occurrence; a `fn` patch receives the whole CLI source and returns the patched source.
- User patches run after the built-in patches.
- At startup, CCC reports patches that matched nothing as `stale`.
- The patched copy is cached by the extracted Claude Code build, CCC's built-in patches, and your patches' content. A `fn` patch is identified by its source text, so if it reads values from outside its body, run once with `CCC_PATCH_CACHE=0` after changing them. `CCC_PATCH_CACHE=verify` rebuilds the patched copy and compares it with the cache.

## Debugging

These commands print and exit without launching Claude:

```sh
ccc --print-config          # merged settings, profiles, plugins, prompt previews, and every generated item
ccc --print-system-prompt
ccc --print-user-prompt
ccc --doctor                # where each piece of config came from
ccc --doctor --json
ccc --dump-config           # write the generated config to disk
ccc --debug-mcp <mcp-name>  # open an MCP server in the MCP Inspector
ccc --timing                # how long each config-building step took
```

### Doctor

`ccc --doctor` reports:

- the presets detected and the project configuration in use
- layering traces (override/append) for the system and user prompts
- per-item layering traces for commands, agents, skills, rules, output styles, workflows, and hooks
- MCP servers, their transport type, and the layer that defined them
- CCC plugins and Claude plugin settings (enabled plugins, plugin dirs, marketplaces)
- profiles

### Dump Configuration

`ccc --dump-config` writes the generated config to `.config-dump/<timestamp>/` in the current directory:

- `system.md`, `user.md` - the system prompt and `CLAUDE.md`
- `settings.json` - the generated `settings.json`
- `claude.json` - the parts of `~/.claude.json` CCC manages: `cachedGrowthBookFeatures` and your `claudeState` keys
- `commands/`, `agents/`, `skills/`, `rules/`, `output-styles/`, `workflows/` - the generated files
- `mcps.json` - the MCP server configuration passed to Claude
- `metadata.json` - context, paths, and file counts

The dump leaves out your account details and project history. Values in `env` and MCP `headers` whose names look secret (containing `token`, `key`, `secret`, `password`, `auth`, `credential`, or `cookie`) are replaced with `[redacted]`. CCC also writes a `.gitignore` into `.config-dump/`, so git ignores dumps in any project.

### Debug MCPs

`ccc --debug-mcp <mcp-name>` opens the server in the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), where you can list its tools, resources, and prompts, call tools, and inspect payloads. It works with stdio and inline servers, not HTTP or SSE; a filtered server shows its tools after filtering.

### Logs

Passing `--debug` (or `-d`), setting `DEBUG`, or setting `cli.debug` enables CCC's debug log. CCC prints the log paths at startup and writes the logs to `<launcher>/.cache/<instance-id>/` (`log` and `hooks.jsonl`).

## Reference

### Context Object

Dynamic configuration receives a context object:

```typescript
{
  workingDirectory: string;          // current working directory
  launcherDirectory: string;         // launcher installation
  configDirectory: string;           // config directory in use
  instanceId: string;                // unique instance identifier
  project: Project;                  // rootDirectory, presets, projectConfig, hasFile(), hasDirectory()
  mcpServers?: Record<string, ClaudeMCPConfig>; // processed MCP configs for this run
  loadedPlugins: LoadedPlugin[];     // CCC plugins loaded for this run
  isGitRepo(): boolean;
  getGitBranch(): string;
  getGitStatus(): string;            // porcelain
  getGitRecentCommits(n?): string;   // default 5
  getGitRemoteUrl(remote?): string;  // default "origin"
  getGitCommitHash(short?): string;  // HEAD
  getDirectoryTree(): string;
  getPackageJson(): Record<string, unknown> | null; // package.json in the working directory
  getProjectRelativePath(path): string; // relative to the working directory
  getEnv(key, default?): string | undefined;
  isCI(): boolean;
  getPlatform(): string;
  getOsVersion(): string;
  getCurrentDateTime(): string;      // ISO timestamp
  hasMCP(name: string): boolean;     // true if an MCP with that name is configured
}
```

### Environment Variables

- `CCC_CONFIG_DIR` - config directory (absolute, or relative to the launcher directory)
- `CLAUDE_PATH` - Claude Code executable to run instead of the bundled dependency (2.1.242+)
- `CCC_NODE` - Node.js binary to run Claude Code with (default: `node` on `PATH`)
- `DEBUG` - enable CCC's debug log
- `CCC_NS_VFS=0` - turn off the Linux mount namespace
- `CCC_PATCH_CACHE` - `0` to turn off the patched CLI cache, `verify` to check it against a fresh build
- `CCC_COMPILE_CACHE=0` - turn off Node's compile cache (default location: `~/.cache/ccc/v8-compile-cache`)
- `CCC_DEBUG_FEATURE_FLAGS=1` - log `featureFlags` overrides as Claude Code reads them

## License

MIT License. See `LICENSE` for details.
