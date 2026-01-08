<img width="40" height="885" alt="image" src="https://github.com/user-attachments/assets/eaaf1e59-05fc-41a6-b41d-c5c78a6b573b"/>

---

**CCC** is a launcher for Claude Code that lets you configure prompts, commands, agents, hooks, and MCPs from a single place, **in a layered way**.

**What you get**

- **Dynamic Configuration**: Generate system/user prompts, commands, agents dynamically.
- **Layered config:** Merge global configuration with presets and project overrides.
- **Low‑effort extensibility:** write hooks & MCPs in TypeScript with tiny helpers.

<img width="2089" height="885" alt="image" src="https://github.com/user-attachments/assets/f3483ce9-a001-4ee4-a801-7550dde9a1ae" />

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

# install tsx globally (required for runtime interception)
bun add -g tsx
```

**Note**: Claude Code (`@anthropic-ai/claude-code`) is included as a dependency.
\
To update it to the latest version do a `bun update`.

### 2. Customize your config

Your configuration lives in the `./config` directory, which includes some examples by default.

```
~/my-claude-launcher/     # Your copy of this repository
└── config/
    ├── global/           # Global configuration
    │   ├── prompts/      # System (output style) / user (CLAUDE.md) prompts
    │   ├── commands/     # Your commands
    │   ├── agents/       # Your sub-agents
    │   ├── hooks.ts      # Your hooks
    │   └── mcps.ts       # Your MCPs
    ├── presets/          # Your language/framework/whatever-specific configs
    │   └── typescript/   # Example: TypeScript-specific settings
    └── projects/         # Your project-specific overrides
        └── myapp/        # Example: Settings for your 'myapp' project
```

**Development Mode**: If a `./dev-config` directory exists, it will be used instead of `./config`. This allows you to keep the example configuration in `./config` (committed to git) while using `./dev-config` for your actual development configuration.

### 3. Use it

**Your workflow**:

1. Edit your config in `~/my-claude-launcher/config/`
2. Run `ccc` instead of `claude` from anywhere
3. Your config is dynamically built and loaded

```sh
ccc # wrap and launch claude
ccc --continue # all the arguments you pass will be passed through to claude

# except these special cases used for debugging (they don't launch claude)
ccc --doctor
ccc --print-config
ccc --print-system-prompt
ccc --print-user-prompt
ccc --dump-config
ccc --debug-mcp <mcp-name>
```

## Configuration Layers

`ccc` loads configurations in layers (later overrides earlier):

1. **Global** → `config/global/` - Base configuration for all projects
2. **Presets** → `config/presets/` - Auto-detected based on project type
3. **Projects** → `config/projects/` - Specific project overrides

Each layer can define:

- `settings.ts` - Settings that will go into Claude Code's `settings.json`
- `prompts/user.{md,ts}` - User instructions (CLAUDE.md)
- `prompts/system.{md,ts}` - Output style
- `commands/*.{md,ts}` - Custom slash commands
- `agents/*.{md,ts}` - Custom sub-agents
- `hooks.ts` - Custom hooks
- `mcps.ts` - Custom MCPs

## How It Works

`ccc` injects configurations using a virtual filesystem overlay. Your actual Claude installation remains untouched.
Configurations are injected at runtime through Node.js module interception.

The launcher:

1. Discovers and merges configurations from all layers
2. Generates a vfs with the merged config
3. Intercepts Node's modules to serve virtual files
4. Launches Claude with the injected configuration


```
Global  ┐
Preset  ├─► merge ─► "virtual overlay" ─► Claude Code
Project ┘
```

## Using Models from Other Vendors

You can configure CCC to use models from other vendors by setting environment variables in your `settings.ts`. This allows you to use models like GLM, Kimi K2, or Deepseek through their Anthropic-compatible APIs.

### Configuration Examples

Add these environment variables to your `config/global/settings.ts`:

```typescript
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  env: {
    // GLM 4.5
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_AUTH_TOKEN: "Z_API_KEY",
    ANTHROPIC_MODEL: "glm-4.5",
    ANTHROPIC_FAST_MODEL: "glm-4.5-air",

    // Kimi K2
    // ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
    // ANTHROPIC_AUTH_TOKEN: "KIMI_API_KEY",

    // Deepseek
    // ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    // ANTHROPIC_AUTH_TOKEN: "DEEPSEEK_API_KEY",
    // ANTHROPIC_MODEL: "deepseek-chat",
    // ANTHROPIC_FAST_MODEL: "deepseek-chat"
  }
});
```

### Environment Variables

- `ANTHROPIC_BASE_URL` - The base URL for the vendor's API endpoint
- `ANTHROPIC_AUTH_TOKEN` - Your API key for the vendor
- `ANTHROPIC_MODEL` - The main model to use (e.g., "glm-4.5", "deepseek-chat")
- `ANTHROPIC_FAST_MODEL` - The model to use for quick operations (optional)

### Usage

Once configured, CCC will automatically use the specified vendor's models instead of Anthropic's models. All CCC features like prompts, commands, agents, hooks, and MCPs will continue to work with the alternative models.

**Note**: Make sure you have the required API keys and that the vendor's API is compatible with Anthropic's API format.

## Extra Configuration

Some settings will still be read from your global `~/.claude.json`:

```bash
# things like these:
claude config set -g autocheckpointingEnabled true
claude config set -g diffTool delta
claude config set -g supervisorMode true
claude config set -g autoCompactEnabled true
claude config set --global preferredNotifChannel terminal_bell
claude config set -g verbose true
```

## CLI argument settings

Some settings are passed directly as CLI arguments to Claude rather than being written to `settings.json`. These are grouped under `settings.cli`. See [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference#cli-flags) for details.

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  cli: {
    tools: ["Bash", "Read", "Edit", "Write"],
    disallowedTools: ["WebSearch", "WebFetch"],
    allowedTools: ["Read", "Glob", "Grep"],
    addDir: ["/path/to/shared/libs"],
    permissionMode: "plan",
    verbose: true,
    debug: "api,hooks",
    chrome: true,
    ide: true,
    enableLspLogging: false,
    agent: "code-reviewer",
  },
  // other settings go to settings.json as normal
  env: { ... },
});
```

### Available CLI-Only Settings

| Setting | Type | CLI Flag | Description |
|---------|------|----------|-------------|
| `tools` | `string[] \| "default"` | `--tools "Tool1,Tool2"` | Available tools (`"default"` for all, `[]` to disable) |
| `disallowedTools` | `string[]` | `--disallowedTools "Tool1,Tool2"` | Tools removed from model context entirely |
| `allowedTools` | `string[]` | `--allowedTools "Tool1,Tool2"` | Tools that execute without permission prompts |
| `addDir` | `string[]` | `--add-dir path` | Additional directories Claude can access |
| `permissionMode` | `enum` | `--permission-mode mode` | Start mode: `default`, `acceptEdits`, `plan`, `bypassPermissions` |
| `verbose` | `boolean` | `--verbose` | Enable verbose logging |
| `debug` | `boolean \| string` | `--debug [filter]` | Enable debug mode, optionally with category filter |
| `chrome` | `boolean` | `--chrome` / `--no-chrome` | Enable/disable Chrome browser integration |
| `ide` | `boolean` | `--ide` | Auto-connect to IDE on startup |
| `enableLspLogging` | `boolean` | `--enable-lsp-logging` | Enable verbose LSP logging |
| `agent` | `string` | `--agent name` | Default agent for the session |
| `agents` | `Record<string, AgentDef>` | `--agents JSON` | Custom subagent definitions |
| `forkSession` | `boolean` | `--fork-session` | Create new session ID when resuming |
| `fallbackModel` | `string` | `--fallback-model name` | Fallback model when primary is overloaded |
| `settingSources` | `string[]` | `--setting-sources "user,project,local"` | Config sources to use |
| `strictMcpConfig` | `boolean` | `--strict-mcp-config` | Only use specified MCP config |

### CLI Override

CLI arguments provided directly to `ccc` override the corresponding `settings.cli` values:

```bash
# override disallowedTools from settings
ccc --disallowedTools "WebSearch,WebFetch"

# start in plan mode regardless of settings
ccc --permission-mode plan
```

---

## System & User Prompts

### System Prompt (Output Style)

Controls how Claude responds and behaves.

**Static (Markdown)** (`config/global/prompts/system.md`):

```markdown
You are a helpful coding assistant.
Write clean, maintainable code.
Follow best practices.
```

**Dynamic (TypeScript)** (`config/global/prompts/system.ts`):

```typescript
import { createPrompt } from "@/config/helpers";

export default createPrompt(
  (context) => `
You are working in ${context.workingDirectory}
${context.isGitRepo() ? `Current branch: ${context.getGitBranch()}` : ""}
Write clean, maintainable code.
`,
);
```

**Append Mode** (adds to previous layers):

```typescript
import { createAppendPrompt } from "@/config/helpers";

export default createAppendPrompt(
  (context) => `
Additional instructions for this preset.
`,
);
```

You can also use Markdown files in append mode, just name them: `<target>.append.md`


### User Prompt (CLAUDE.md)

Project-specific instructions and context. See `config/global/prompts/user.ts` for a full example:

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

Custom slash commands available in Claude. See `config/global/commands/` for examples:

**Static (Markdown)** (`config/global/commands/review.md`):

```markdown
# Review

Review: "$ARGUMENTS"
You are conducting a code review...
```

**Dynamic (TypeScript)**:

```typescript
import { createCommand } from "@/config/helpers";

export default createCommand(
  (context) => `
# Custom Command

Working in ${context.workingDirectory}
Current branch: ${context.getGitBranch()}

Your command instructions here...
`,
);
```

**Append to existing command**:

```typescript
import { createAppendCommand } from "@/config/helpers";

export default createAppendCommand(
  (context) => `
Additional instructions for TypeScript projects...
`,
);
```

## Hooks

Event handlers that run at specific Claude events. See `config/global/hooks.ts` for examples:

**Examples for global hooks**:

```typescript
import p from "picocolors";
import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

const bashDenyList = [
  {
    match: /^\bgit\bcheckout/,
    message: "You are not allowed to do checkouts or resets",
  },
  {
    match: /^\bgrep\b(?!.*\|)/,
    message: "Use 'rg' (ripgrep) instead of 'grep' for better performance",
  },
];

const sessionStartHook = createHook({
  event: "SessionStart",
  id: "global-session-start",
  handler: (input) => {
    const timestamp = new Date().toISOString();
    console.log(p.dim("🞄"));
    console.log(
      `🚀 Session started from ${p.yellow(input.source)} at ${p.blue(timestamp)}`,
    );
    console.log(`📍 Working directory: ${p.yellow(process.cwd())}`);
    console.log(`🔧 Node version: ${p.yellow(process.version)}`);
    console.log(p.dim("🞄"));
  },
});

const preBashValidationHook = createHook({
  event: "PreToolUse",
  id: "bash-deny-list",
  handler: (input) => {
    const command = input.tool_input.command as string;
    if (input.tool_name !== "Bash" || !command) return;
    const firstMatchingRule = bashDenyList.find((rule) =>
      command.match(rule.match),
    );
    if (!firstMatchingRule) return;
    return {
      continue: true,
      decision: "block",
      reason: firstMatchingRule?.message,
    };
  },
});

export default createConfigHooks({
  SessionStart: [{ hooks: [sessionStartHook] }],
  PreToolUse: [{ hooks: [preBashValidationHook] }],
});
```

**Hook Options**:

```typescript
const oneTimeHook = createHook({
  event: "SessionStart",
  id: "one-time-setup",
  handler: (input) => {
    // this will only run once per session
    console.log("First session start only");
  },
  timeout: 5000,  // optional: timeout in ms
  once: true,     // optional: run only first time per session
});
```

**TypeScript Validation Example** (`config/presets/typescript/hooks.ts`):

```typescript
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
            const result = await $`tsc --noEmit`;
            if (result.exitCode !== 0) {
              return {
                continue: true,
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

## Agents

Specialized sub-agents for specific tasks. See `config/global/agents/` for examples:

**Static (Markdown)** (`config/global/agents/code-reviewer.md`):

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: [Read, Grep, Glob, Bash]
---

# Code Reviewer Agent

You are a specialized code review agent conducting **SYSTEMATIC, EVIDENCE-FIRST CODE REVIEWS**.

## Core Principles

**EVIDENCE BEFORE OPINION** - Always provide file:line references...
```

**Dynamic (TypeScript)**:

```typescript
import { createAgent } from "@/config/helpers";

export default createAgent(
  (context) => `
---
name: debugger
description: Debug issues in ${context.project.name}
tools: [Read, Edit, Bash, Grep, Glob]
---

# Debugger Agent

You are debugging code in ${context.workingDirectory}
Current branch: ${context.getGitBranch()}
`,
);
```

## MCPs

Model Context Protocol servers for extending Claude's capabilities. See `config/global/mcps/` for examples:

### External MCPs

```typescript
import { createConfigMCPs } from "@/config/helpers";

export default createConfigMCPs({
  filesystem: {
    command: "npx",
    args: ["@modelcontextprotocol/server-filesystem"],
    env: { FS_ROOT: "/home/user" },
  },
});
```

### Filtering MCP Tools

You can filter which tools are exposed from an external MCP:

```typescript
import { createConfigMCPs } from "@/config/helpers";

export default createConfigMCPs({
  nixos: {
    command: "nix",
    args: ["run", "github:utensils/mcp-nixos", "--"],
    filter: (tool) => {
      // Exclude specific tools
      return tool.name !== "nixos_search";
    },
  },
});
```

The filter function receives a tool object with `name` and `description` properties. Return `true` to include the tool, `false` to exclude it.

### Custom MCPs

You can easily define custom MCPs in your config using FastMCP.

```typescript
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createConfigMCPs, createMCP } from "@/config/helpers";

const customTools = createMCP((context) => {
  const server = new FastMCP({
    name: "custom-tools",
    version: "1.0.0",
  });

  server.addTool({
    name: "getProjectInfo",
    description: "Get current project information",
    parameters: z.object({}),
    execute: async () => {
      return JSON.stringify(
        {
          directory: context.workingDirectory,
          branch: context.getGitBranch(),
          isGitRepo: context.isGitRepo(),
        },
        null,
        2,
      );
    },
  });

  return server;
});

export default createConfigMCPs({
  "custom-tools": customTools,
});
```

## Plugins

CCC supports Claude Code plugins through the `enabledPlugins` and `pluginDirs` settings.

### Workflow

1. Install plugins using the `/plugin` command
2. Find plugin keys in `~/.claude/plugins/installed_plugins.json`
3. Enable plugins in your CCC settings (plugins won't be active until added to config)

### Enabling Plugins

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  enabledPlugins: {
    // Use keys from ~/.claude/plugins/installed_plugins.json
    "typescript-lsp@claude-plugins-official": true,
    "gopls-lsp@claude-plugins-official": true,
  },
});
```

### Local Plugin Directories

```typescript
export default createConfigSettings({
  pluginDirs: [
    "./config/plugins/my-plugin",
  ],
});
```

Or via CLI: `ccc --plugin-dir ./my-plugin`

### LSP Plugin Support

LSP plugins are supported natively. Just enable your LSP plugins normally:

```typescript
export default createConfigSettings({
  enabledPlugins: {
    "typescript-lsp@claude-plugins-official": true,
  },
});
```

## CCC Plugins

CCC has its own plugin system for bundling reusable configuration components. Unlike Claude's built-in plugins (configured via `enabledPlugins`), CCC plugins are local TypeScript modules that can define commands, agents, MCPs, hooks, and prompts dynamically, and which have access to enriched information about the current session.

### CCC Plugins vs Claude Plugins

| Aspect | CCC Plugins (`cccPlugins`) | Claude Plugins (`enabledPlugins`) |
|--------|---------------------------|-----------------------------------|
| **Location** | `config/plugins/` directory | `~/.claude/plugins/` |
| **Format** | TypeScript with `createPlugin()` | Claude's plugin format |
| **Components** | commands, agents, MCPs, hooks, prompts | Defined by Claude |
| **Distribution** | Local to your config | Via `/plugin` command |

### Plugin Structure

A CCC plugin requires two files:

```
config/plugins/my-plugin/
├── plugin.json    # Manifest with name, version, description
└── index.ts       # Plugin definition using createPlugin()
```

**plugin.json** (manifest):

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A custom CCC plugin"
}
```

**index.ts** (definition):

```typescript
import { createPlugin } from "@/config/helpers";

export default createPlugin({
  // Commands - custom slash commands
  commands: (context) => ({
    "my-command": {
      content: `
# My Command
Your command instructions here...
      `.trim(),
      mode: "override",
    },
  }),

  // Agents - specialized sub-agents
  agents: (context) => ({
    "my-agent": {
      content: `
---
name: my-agent
description: A specialized agent
tools: [Read, Grep, Glob]
---
Agent instructions...
      `.trim(),
      mode: "override",
    },
  }),

  // MCPs - inline MCP servers
  mcps: (context) => ({
    "my-mcp": {
      type: "inline",
      config: () => createMyMCP(context),
    },
  }),

  // Hooks - event handlers
  hooks: (context) => ({
    Stop: [
      {
        hooks: [
          createHook({
            event: "Stop",
            id: "plugin-stop-hook",
            handler: () => {
              // Hook logic
            },
          }),
        ],
      },
    ],
  }),

  // Prompts - system/user prompt additions
  prompts: (context) => ({
    user: {
      content: "Additional user prompt content",
      mode: "append",
    },
  }),
});
```

### Enabling CCC Plugins

Enable plugins via `cccPlugins` in your settings:

```typescript
// config/global/settings.ts
import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  cccPlugins: {
    "my-plugin": true,           // Enable plugin
    "another-plugin": false,     // Explicitly disable
  },
});
```

You can also enable plugins in presets:

```typescript
// config/presets/typescript/index.ts
import { createPreset } from "@/config/helpers";

export default createPreset({
  matcher: (context) => context.project.hasFile("tsconfig.json"),
  cccPlugins: {
    "typescript-helpers": true,
  },
});
```

### Plugin Context

Plugins receive a `PluginContext` with access to:

```typescript
{
  // Standard context properties
  workingDirectory: string;
  launcherDirectory: string;
  isGitRepo(): boolean;
  getGitBranch(): string;
  // ... all Context methods

  // Plugin-specific
  manifest: PluginManifest;        // Plugin's plugin.json
  root: string;                     // Plugin directory path
  settings: Record<string, unknown>; // Plugin settings

  // State management
  state: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    clear(): void;
    getAll(): Record<string, unknown>;
  };
}
```

### Plugin State

Plugins can persist state using the built-in state API. State is automatically saved to disk and restored between sessions.

**State API:**

```typescript
context.state.get<T>(key: string): T | undefined  // Get a value
context.state.set(key: string, value: unknown): void  // Set a value
context.state.clear(): void  // Clear all state
context.state.getAll(): Record<string, unknown>  // Get all state
```

**State Locations:**

By default, plugin state is stored in `/tmp/ccc-plugin-{name}-{sessionId}.json`. The location is isolated by session ID (CCC_INSTANCE_ID) to prevent conflicts between concurrent CCC instances.

| Location | Path | Use Case |
|----------|------|----------|
| `temp` (default) | `/tmp/ccc-plugin-{name}-{sessionId}.json` | Session-scoped data |
| `project` | `{cwd}/.ccc/state/plugins/{name}.json` | Project-specific persistent data |
| `user` | `~/.ccc/state/plugins/{name}.json` | Global user preferences |

**Example - Stateful MCP:**

```typescript
export default createPlugin({
  mcps: (context) => ({
    "stateful-mcp": {
      type: "inline",
      config: () => {
        const server = new FastMCP({ name: "stateful", version: "1.0.0" });

        server.addTool({
          name: "save_data",
          parameters: z.object({ key: z.string(), value: z.string() }),
          execute: async (args) => {
            context.state.set(args.key, args.value);
            return "Saved!";
          },
        });

        server.addTool({
          name: "load_data",
          parameters: z.object({ key: z.string() }),
          execute: async (args) => {
            return context.state.get(args.key) ?? "Not found";
          },
        });

        return server;
      },
    },
  }),
});
```

### Plugin Settings

Plugins define settings using **Zod schemas** in `index.ts`. The type is automatically inferred:

```typescript
// my-plugin/index.ts
import { z } from "zod";
import { createPlugin } from "@/config/helpers";

const settingsSchema = z.object({
  maxItems: z.number().default(100),
  mode: z.enum(["fast", "balanced", "thorough"]).default("balanced"),
});

export default createPlugin({
  settingsSchema,
  mcps: (context) => {
    // context.plugin.settings is typed as { maxItems: number, mode: "fast" | "balanced" | "thorough" }
    const { maxItems, mode } = context.plugin.settings;
    // ...
  },
});
```

**Pass settings when enabling the plugin:**

```typescript
// config/global/settings.ts
export default createConfigSettings({
  cccPlugins: {
    "my-plugin": {
      enabled: true,
      settings: {
        maxItems: 50,
        mode: "fast",
      },
    },
  },
});
```

Settings are validated with Zod at plugin load time. Invalid settings throw errors.

### Plugin State

Plugins get a `context.state` API for key-value storage:

```typescript
context.state.get<T>(key)      // get value
context.state.set(key, value)  // set value
context.state.clear()          // clear all state
context.state.getAll()         // get all state
```

**By default, state is in-memory only** (not persisted). To persist state, set `stateType`:

```typescript
export default createPlugin({
  stateType: "temp",     // /tmp/ccc-plugin-{name}-{sessionId}.json (per-instance)
  // or:
  stateType: "project",  // {projectRoot}/.ccc/state/plugins/{name}.json
  // or:
  stateType: "user",     // ~/.ccc/state/plugins/{name}.json

  mcps: (context) => { /* ... */ },
});
```

| stateType | Path | Use case |
|-----------|------|----------|
| `"none"` (default) | (in-memory only) | No persistence needed |
| `"temp"` | `/tmp/ccc-plugin-{name}-{sessionId}.json` | Per-instance state, cleared on reboot |
| `"project"` | `{projectRoot}/.ccc/state/plugins/{name}.json` | Project-specific persistent state |
| `"user"` | `~/.ccc/state/plugins/{name}.json` | User-wide persistent state |

### onLoad Hook

Plugins can define an `onLoad` callback for initialization:

```typescript
export default createPlugin({
  onLoad: async (context) => {
    console.log(`Plugin ${context.plugin.name} loaded`);
  },
  commands: () => ({ /* ... */ }),
});
```

### Inter-Plugin Communication

Plugins can access other loaded plugins using `getPlugin()`:

```typescript
export default createPlugin({
  mcps: (context) => ({
    "my-mcp": {
      type: "inline",
      config: () => {
        const server = new FastMCP({ name: "my-mcp", version: "1.0.0" });

        server.addTool({
          name: "get_other_plugin_data",
          parameters: z.object({}),
          execute: async () => {
            // Access another plugin's context
            const otherPlugin = context.getPlugin("other-plugin");
            if (!otherPlugin) return "Other plugin not loaded";

            // Read its state
            const data = otherPlugin.state.get("shared-data");
            return JSON.stringify(data);
          },
        });

        return server;
      },
    },
  }),
});
```

### Plugin Dependencies

Plugins can declare dependencies on other plugins in `plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Depends on base-plugin",
  "dependencies": ["base-plugin", "utility-plugin"]
}
```

Dependencies are loaded first, ensuring they're available when your plugin loads.

### Full plugin.json Schema

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A complete example plugin",

  "author": "Your Name",
  "license": "MIT",
  "homepage": "https://example.com/my-plugin",
  "repository": "https://github.com/user/my-plugin",

  "dependencies": ["other-plugin"]
}
```

Note: Settings are defined via Zod schema in `index.ts`, not in `plugin.json`.

### Example: Complete Plugin

Here's a complete example of a plugin with commands, an MCP, and hooks:

```typescript
// config/plugins/task-tracker/index.ts
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createPlugin } from "@/config/helpers";
import { createHook } from "@/hooks/hook-generator";

export default createPlugin({
  commands: () => ({
    "track": {
      content: `
# Task Tracker
Track a new task: "$ARGUMENTS"
Use the task_add MCP tool to add this task.
      `.trim(),
      mode: "override",
    },
  }),

  mcps: (context) => ({
    "task-tracker": {
      type: "inline",
      config: () => {
        const server = new FastMCP({
          name: "task-tracker",
          version: "1.0.0",
        });

        server.addTool({
          name: "task_add",
          description: "Add a new task",
          parameters: z.object({
            title: z.string(),
            priority: z.enum(["low", "medium", "high"]).default("medium"),
          }),
          execute: async (args) => {
            const tasks = context.state.get<string[]>("tasks") ?? [];
            tasks.push(`[${args.priority}] ${args.title}`);
            context.state.set("tasks", tasks);
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
      },
    },
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

### Viewing Plugin Info

Use `ccc --print-config` to see loaded CCC plugins:

```
CCC Plugins:
  my-plugin (v1.0.0) [enabled]
    Commands: my-plugin:my-command
    MCPs: my-plugin:my-mcp
    Hooks: Stop(1)
```

Note: Plugin components are namespaced with the plugin name (e.g., `my-plugin:my-command`).

## Runtime Patches

All CLI patches are applied at runtime - the original `node_modules` files are never modified. The launcher reads the CLI, applies patches, writes to a temp file, and imports that instead.

### Built-in Patches

Applied automatically on every launch:
- Disable `pr-comments` and `security-review` features

### User-defined Patches

Add custom string replacements via settings:

```typescript
export default createConfigSettings({
  patches: [
    { find: "ultrathink", replace: "uuu" },  // shorter alias
  ],
});
```

Patches are applied after built-in patches. No reinstall needed when changing configuration.

## Statusline

Customize the Claude statusline with a simple configuration-based approach.

### Priority Order

1. **`config/global/statusline.ts`** - If this file exists, it will be executed with `bun`
2. **`settings.statusLine`** - Otherwise, use the statusLine configuration from settings
3. **None** - If neither is configured, no statusline is displayed

### Creating a Statusline

Create `config/global/statusline.ts`:

```typescript
import { createStatusline } from "@/config/helpers";
import type { StatusLineInput } from "@/types/statusline";

export default createStatusline(async (data: StatusLineInput) => {
  const modelIcon = data.model?.id?.includes("opus") ? "🦆" : "🐇";
  const components = [];

  // Model and icon
  components.push(`${modelIcon} ${data.model.display_name }`);

  // Working directory
  if (data.workspace) {
    const dir = data.workspace.project_dir || data.workspace.current_dir;
    const shortDir = dir.split("/").slice(-2).join("/");
    components.push(`📁 ${shortDir}`);
  }

  // Hook event (if present)
  if (data.hook_event_name) {
    components.push(`⚡ ${data.hook_event_name}`);
  }

  console.log(components.join(" │ "));
});
```

### Using External Tools

You can also integrate external statusline tools:

```typescript
import { createStatusline } from "@/config/helpers";
import { $ } from "bun";

export default createStatusline(async (data) => {
  // Use external ccstatusline tool
  const output = await $`echo ${JSON.stringify(data)} | bunx ccstatusline`.text();
  const modelIcon = data.model?.id?.includes("opus") ? "🦆" : "🐇";
  console.log(`${modelIcon} ${output.trim()}`);
});
```

### StatusLineInput Type

The statusline function receives a `StatusLineInput` object with:
- `model.id` - Model identifier (e.g., "claude-3-opus-20240229")
- `model.display_name` - Human-readable model name
- `workspace.current_dir` - Current working directory
- `workspace.project_dir` - Project root directory
- `hook_event_name` - Current hook event being executed
- `session_id` - Current session identifier
- `transcript_path` - Path to the transcript file
- `cwd` - Current working directory
- `output_style` - Output style configuration

### Settings Configuration

Alternatively, configure a custom statusline command in `settings.ts`:

```typescript
export default createConfigSettings({
  statusLine: {
    type: "command",
    command: "/path/to/your/statusline-script",
  },
});
```

**Note:** Unlike other configuration types, statuslines do NOT support layering or merging. Only the global configuration or settings are used.

## Doctor (Config Inspector)

Use `ccc --doctor` to print a diagnostic report of your merged configuration without launching Claude:

```
ccc --doctor
ccc --doctor --json
```

The report shows:
- Presets detected and project configuration in use
- Layering traces (override/append) for system/user prompts
- Per-command and per-agent layering traces across global/presets/project
- MCP servers and their transport type

## Dump Configuration

Use `ccc --dump-config` to create a complete dump of the computed configuration that Claude sees:

```bash
ccc --dump-config
```

This creates a `.config-dump/{timestamp}/` directory containing:

- `system.md` - The actual computed system prompt
- `user.md` - The actual computed user prompt
- `commands/` - All command files as Claude sees them
- `agents/` - All agent files as Claude sees them
- `settings.json` - The merged settings
- `mcps.json` - The computed MCP configurations
- `metadata.json` - Context and dump information

This is useful for debugging configuration issues and understanding exactly what Claude sees.

## Debug MCPs

Use `ccc --debug-mcp <mcp-name>` to launch the MCP Inspector for debugging MCP servers:

```bash
ccc --debug-mcp filesystem
ccc --debug-mcp custom-tools
```

This launches the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) with your MCP server, allowing you to:
- View all available tools, resources, and prompts
- Test tool invocations interactively
- Inspect request/response payloads
- Debug filtered MCPs (shows tools after filtering)

**Note**:
- Only works with stdio transport MCPs (not HTTP/SSE)
- Filtered MCPs will show the filtered tools, not the original ones
- Inline MCPs (created with FastMCP) are supported

## Project Configuration

Create a project-specific configuration:

```typescript
// config/projects/myapp/project.ts
export default {
  name: "myapp",
  root: "/path/to/myapp",
  disableParentClaudeMds: false, // optional, will disable Claude's behavior of loading upper CLAUDE.md files
};
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

## Context Object

All dynamic configurations receive a context object with a few utilities:

```typescript
{
  workingDirectory: string;          // Current working directory
  launcherDirectory: string;         // Path to launcher installation
  instanceId: string;                // Unique instance identifier
  project: Project;                  // Project instance with config
  mcpServers?: Record<string, ClaudeMCPConfig>; // Processed MCP configs for this run
  isGitRepo(): boolean;              // Check if in git repository
  getGitBranch(): string;            // Current git branch
  getGitStatus(): string;            // Git status (porcelain)
  getGitRecentCommits(n): string;    // Recent commit history
  getDirectoryTree(): string;        // Directory structure
  getPlatform(): string;             // OS platform
  getOsVersion(): string;            // OS version info
  getCurrentDateTime(): string;      // ISO timestamp
  hasMCP(name: string): boolean;     // True if MCP with name is configured
}
```

## Other things

- ?

---

## License

MIT License. See `LICENSE` for details.
