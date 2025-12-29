import type { HooksConfiguration } from "@/types/hooks";
import type { MCPServers } from "@/types/mcps";
import type { AgentConfig, CommandConfig, LoadedPlugin, PluginInfo, PromptConfig } from "./types";

const namespace = (pluginName: string, componentName: string): string => {
  return `${pluginName}:${componentName}`;
};

export const getPluginCommands = (plugins: LoadedPlugin[]): Record<string, CommandConfig> => {
  const commands: Record<string, CommandConfig> = {};

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.definition.commands) continue;

    const pluginCommands = plugin.definition.commands(plugin.context);
    for (const [name, config] of Object.entries(pluginCommands)) {
      commands[namespace(plugin.manifest.name, name)] = config;
    }
  }

  return commands;
};

export const getPluginAgents = (plugins: LoadedPlugin[]): Record<string, AgentConfig> => {
  const agents: Record<string, AgentConfig> = {};

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.definition.agents) continue;

    const pluginAgents = plugin.definition.agents(plugin.context);
    for (const [name, config] of Object.entries(pluginAgents)) {
      agents[namespace(plugin.manifest.name, name)] = config;
    }
  }

  return agents;
};

export const getPluginMCPs = (plugins: LoadedPlugin[]): MCPServers => {
  const mcps: MCPServers = {};

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.definition.mcps) continue;

    const pluginMCPs = plugin.definition.mcps(plugin.context);
    for (const [name, config] of Object.entries(pluginMCPs)) {
      mcps[namespace(plugin.manifest.name, name)] = config;
    }
  }

  return mcps;
};

export const getPluginHooks = (plugins: LoadedPlugin[]): HooksConfiguration => {
  const hooks: HooksConfiguration = {};

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.definition.hooks) continue;

    const pluginHooks = plugin.definition.hooks(plugin.context);
    for (const [event, definitions] of Object.entries(pluginHooks)) {
      const eventName = event as keyof HooksConfiguration;
      if (!hooks[eventName]) {
        hooks[eventName] = [];
      }
      hooks[eventName]!.push(...(definitions ?? []));
    }
  }

  return hooks;
};

export const getPluginPrompts = (
  plugins: LoadedPlugin[],
): { system: PromptConfig[]; user: PromptConfig[] } => {
  const system: PromptConfig[] = [];
  const user: PromptConfig[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.definition.prompts) continue;

    const prompts = plugin.definition.prompts(plugin.context);
    if (prompts.system) {
      system.push(prompts.system);
    }
    if (prompts.user) {
      user.push(prompts.user);
    }
  }

  return { system, user };
};

export const getPluginInfo = (plugins: LoadedPlugin[]): PluginInfo[] => {
  return plugins.map((plugin) => {
    const commands: string[] = [];
    const agents: string[] = [];
    const mcps: string[] = [];
    const hookCounts: Record<string, number> = {};
    let hasSystemPrompt = false;
    let hasUserPrompt = false;

    if (plugin.definition.commands) {
      const pluginCommands = plugin.definition.commands(plugin.context);
      commands.push(...Object.keys(pluginCommands).map((n) => namespace(plugin.manifest.name, n)));
    }

    if (plugin.definition.agents) {
      const pluginAgents = plugin.definition.agents(plugin.context);
      agents.push(...Object.keys(pluginAgents).map((n) => namespace(plugin.manifest.name, n)));
    }

    if (plugin.definition.mcps) {
      const pluginMCPs = plugin.definition.mcps(plugin.context);
      mcps.push(...Object.keys(pluginMCPs).map((n) => namespace(plugin.manifest.name, n)));
    }

    if (plugin.definition.hooks) {
      const pluginHooks = plugin.definition.hooks(plugin.context);
      for (const [event, definitions] of Object.entries(pluginHooks)) {
        hookCounts[event] = definitions?.length ?? 0;
      }
    }

    if (plugin.definition.prompts) {
      const prompts = plugin.definition.prompts(plugin.context);
      hasSystemPrompt = Boolean(prompts.system);
      hasUserPrompt = Boolean(prompts.user);
    }

    return {
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      enabled: plugin.enabled,
      root: plugin.root,
      components: {
        commands,
        agents,
        mcps,
        hooks: hookCounts,
        prompts: { system: hasSystemPrompt, user: hasUserPrompt },
      },
    };
  });
};
