#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import p from "picoprint";

interface StringPatch {
  search: string;
  replace: string;
}

interface FilePatch {
  file: string;
  patches: StringPatch[];
  description?: string;
}

const ROOT = join(import.meta.dirname, "..");
const FILE_PATCHES: FilePatch[] = [
  {
    file: "node_modules/@anthropic-ai/claude-code/cli.js",
    description: "claude-code cli",
    patches: [
      { search: "pr-comments", replace: "zprcomments" },
      { search: "security-review", replace: "zsecurityreview" },
    ],
  },
];

const applyFilePatches = (filePatch: FilePatch): void => {
  const { file, patches, description } = filePatch;
  const filePath = join(ROOT, file);
  const label = description ?? file;

  if (!existsSync(filePath)) {
    p.yellow.log("⚠", `${label}: file not found, skipping`);
    return;
  }

  let content = readFileSync(filePath, "utf8");
  let totalPatched = 0;

  for (const { search, replace } of patches) {
    const occurrences = (content.match(new RegExp(search, "g")) || []).length;
    if (occurrences > 0) {
      content = content.replaceAll(search, replace);
      totalPatched += occurrences;
    }
  }

  if (totalPatched === 0) {
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
