import { expect } from "bun:test";

export const assertExitCode = (actual: number, expected: number): void => {
  expect(actual).toBe(expected);
};

export const assertStdoutContains = (stdout: string, content: string): void => {
  expect(stdout).toContain(content);
};

export const assertStdoutNotContains = (stdout: string, content: string): void => {
  expect(stdout).not.toContain(content);
};

export const assertStderrEmpty = (stderr: string): void => {
  // allow empty or only whitespace
  expect(stderr.trim()).toBe("");
};

export const assertStderrContains = (stderr: string, content: string): void => {
  expect(stderr).toContain(content);
};

export const assertConfigContains = (stdout: string, key: string, value: unknown): void => {
  // parse the settings JSON from --print-config output
  const settingsMatch = /Settings:\s*\n([\S\s]*?)(?=\n.*?:|\n\n|$)/.exec(stdout);
  if (!settingsMatch) {
    throw new Error("Could not find Settings section in output");
  }

  // find the JSON block after "Settings:"
  const jsonStart = stdout.indexOf("{", stdout.indexOf("Settings:"));
  if (jsonStart === -1) {
    throw new Error("Could not find JSON in Settings section");
  }

  // find matching closing brace
  let braceCount = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < stdout.length; i++) {
    if (stdout[i] === "{") braceCount++;
    if (stdout[i] === "}") braceCount--;
    if (braceCount === 0) {
      jsonEnd = i + 1;
      break;
    }
  }

  const jsonStr = stdout.slice(jsonStart, jsonEnd);
  const settings = JSON.parse(jsonStr);

  // navigate to the key (supports dot notation like "env.TEST_VAR")
  const keys = key.split(".");
  let current: unknown = settings;
  for (const k of keys) {
    if (current === null || typeof current !== "object") {
      throw new Error(`Key "${key}" not found in settings`);
    }
    current = (current as Record<string, unknown>)[k];
  }

  expect(current).toEqual(value);
};

export const assertSystemPromptContains = (stdout: string, content: string): void => {
  expect(stdout).toContain(content);
};

export const assertUserPromptContains = (stdout: string, content: string): void => {
  expect(stdout).toContain(content);
};

export const assertCommandsInclude = (stdout: string, commandName: string): void => {
  // look for commands array in --print-config output
  const commandsMatch = /Commands:\s*\n\s*\[([\S\s]*?)]/.exec(stdout);
  if (!commandsMatch) {
    throw new Error("Could not find Commands section in output");
  }
  expect(commandsMatch[1]).toContain(commandName);
};

export const assertAgentsInclude = (stdout: string, agentName: string): void => {
  // look for agents array in --print-config output
  const agentsMatch = /Agents:\s*\n\s*\[([\S\s]*?)]/.exec(stdout);
  if (!agentsMatch) {
    throw new Error("Could not find Agents section in output");
  }
  expect(agentsMatch[1]).toContain(agentName);
};

export const assertPresetMatched = (stdout: string, presetName: string): void => {
  // look for preset in context output
  expect(stdout).toContain(presetName);
};
