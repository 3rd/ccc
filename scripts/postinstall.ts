#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import p from "picoprint";
import { cliPatches, isFunctionPatch, isRegexPatch, type FilePatch, type Patch } from "./patches";

const ROOT = join(import.meta.dirname, "..");

const FILE_PATCHES: FilePatch[] = [
  {
    file: "node_modules/@anthropic-ai/claude-code/cli.js",
    description: "claude-code cli",
    patches: cliPatches,
  },
];

const applyPatch = (content: string, patch: Patch): { content: string; count: number } => {
  if (isFunctionPatch(patch)) {
    const result = patch.apply(content);
    return { content: result, count: result !== content ? 1 : 0 };
  }
  if (isRegexPatch(patch)) {
    const matches = content.match(patch.pattern);
    const count = matches?.length ?? 0;
    return { content: content.replace(patch.pattern, patch.replace), count };
  }
  const occurrences = (content.match(new RegExp(patch.search, "g")) || []).length;
  return { content: content.replaceAll(patch.search, patch.replace), count: occurrences };
};

const applyFilePatches = (filePatch: FilePatch): void => {
  const { file, patches, description } = filePatch;
  const filePath = join(ROOT, file);
  const label = description ?? file;

  if (!existsSync(filePath)) {
    p.yellow.log("⚠", `${label}: file not found, skipping`);
    return;
  }

  const original = readFileSync(filePath, "utf8");
  let content = original;
  let totalPatched = 0;

  for (const patch of patches) {
    const { content: newContent, count } = applyPatch(content, patch);
    content = newContent;
    totalPatched += count;
  }

  if (content === original) {
    p.dim.log("·", `${label}: already patched or not needed`);
    return;
  }

  writeFileSync(filePath, content, "utf8");
  p.green.log("✓", `${label}: ${totalPatched} patch(es) applied`);
};

const run = (): void => {
  p.dim.log("⚙", "postinstall");

  for (const filePatch of FILE_PATCHES) {
    applyFilePatches(filePatch);
  }
};

run();
