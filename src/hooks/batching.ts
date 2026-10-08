import {
  createHookBatchCommand,
  getInternalHookCommandMetadata,
  type HookBatchCommandEntry,
  type HookBatchCommandSource,
} from "@/hooks/hook-generator";
import type { ClaudeHookInput, HookCommand, HookDefinition, HookEntry, HookMatcherType } from "@/types/hooks";

export interface SourcedHookDefinition extends HookDefinition {
  source: HookBatchCommandSource;
}

const SIMPLE_MATCHER_RE = /^[\w|]+$/;

const combineSourceKinds = (
  current: HookBatchCommandSource,
  next: HookBatchCommandSource,
): HookBatchCommandSource => {
  if (current === next) return current;
  if (current === "plugin" || next === "plugin") return "plugin";
  if (current === "config" || next === "config") return "config";
  return "builtin";
};

const appendMatcher = (entry: HookBatchCommandEntry, matcher: HookMatcherType | undefined) => {
  if (entry.matchers.includes("*")) return;
  if (!matcher || matcher === "*") {
    // eslint-disable-next-line no-param-reassign
    entry.matchers = ["*"];
    return;
  }
  if (!entry.matchers.includes(matcher)) {
    entry.matchers.push(matcher);
  }
};

const getHookMatcherQuery = (input: ClaudeHookInput) => {
  switch (input.hook_event_name) {
    case "ConfigChange": {
      return input.source;
    }
    case "Elicitation": {
      return input.mcp_server_name;
    }
    case "ElicitationResult": {
      return input.mcp_server_name;
    }
    case "InstructionsLoaded": {
      return input.load_reason;
    }
    case "Notification": {
      return input.notification_type;
    }
    case "PermissionRequest": {
      return input.tool_name;
    }
    case "PostCompact": {
      return input.trigger;
    }
    case "PostToolUse": {
      return input.tool_name;
    }
    case "PostToolUseFailure": {
      return input.tool_name;
    }
    case "PreCompact": {
      return input.trigger;
    }
    case "PreToolUse": {
      return input.tool_name;
    }
    case "SessionEnd": {
      return input.reason;
    }
    case "SessionStart": {
      return input.source;
    }
    case "Setup": {
      return input.trigger;
    }
    case "StopFailure": {
      return input.error;
    }
    case "SubagentStart": {
      return input.agent_type;
    }
    case "SubagentStop": {
      return input.agent_type;
    }
    default: {
      return undefined;
    }
  }
};

const doesSingleMatcherMatch = (query: string, matcher: HookMatcherType) => {
  if (matcher === "*") return true;

  if (SIMPLE_MATCHER_RE.test(matcher)) {
    if (matcher.includes("|")) {
      return matcher.split("|").includes(query);
    }
    return query === matcher;
  }

  try {
    return new RegExp(matcher).test(query);
  } catch {
    return false;
  }
};

const toHookDefinition = (definition: SourcedHookDefinition): HookDefinition => {
  return definition.matcher ?
      { matcher: definition.matcher, hooks: definition.hooks }
    : { hooks: definition.hooks };
};

export const isBatchableInternalHookCommand = (entry: HookEntry): entry is HookCommand => {
  if (entry.type !== "command") return false;
  const metadata = getInternalHookCommandMetadata(entry);
  if (!metadata?.batchable) return false;
  return (
    entry.timeout == null &&
    entry.statusMessage == null &&
    entry.once !== true &&
    entry.async !== true &&
    entry.asyncRewake !== true &&
    entry.onFailure == null
  );
};

export const batchHookDefinitionsForEvent = (definitions: SourcedHookDefinition[]): HookDefinition[] => {
  const batchEntries = new Map<string, HookBatchCommandEntry>();
  const preservedDefinitions: HookDefinition[] = [];

  for (const definition of definitions) {
    const preservedHooks: HookEntry[] = [];

    for (const hook of definition.hooks) {
      if (!isBatchableInternalHookCommand(hook)) {
        preservedHooks.push(hook);
        continue;
      }

      const metadata = getInternalHookCommandMetadata(hook);
      if (!metadata) {
        preservedHooks.push(hook);
        continue;
      }

      const existing = batchEntries.get(metadata.hookId);
      if (existing) {
        appendMatcher(existing, definition.matcher);
        existing.source = combineSourceKinds(existing.source, definition.source);
        continue;
      }

      const entry: HookBatchCommandEntry = {
        hookId: metadata.hookId,
        matchers: [],
        scope: metadata.scope,
        source: definition.source,
      };
      appendMatcher(entry, definition.matcher);
      batchEntries.set(metadata.hookId, entry);
    }

    if (preservedHooks.length > 0) {
      preservedDefinitions.push(
        definition.matcher ?
          { matcher: definition.matcher, hooks: preservedHooks }
        : { hooks: preservedHooks },
      );
    }
  }

  if (batchEntries.size === 0) {
    return definitions.map(toHookDefinition);
  }

  return [{ hooks: [createHookBatchCommand(Array.from(batchEntries.values()))] }, ...preservedDefinitions];
};

export const doesHookBatchEntryMatchInput = (entry: HookBatchCommandEntry, input: ClaudeHookInput) => {
  const query = getHookMatcherQuery(input);

  if (
    entry.scope === "main" &&
    input.agent_id &&
    input.hook_event_name !== "SubagentStart" &&
    input.hook_event_name !== "SubagentStop"
  ) {
    return false;
  }

  if (entry.matchers.length === 0) return true;
  if (query === undefined) return true;

  return entry.matchers.some((matcher) => doesSingleMatcherMatch(query, matcher));
};
