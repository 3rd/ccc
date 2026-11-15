import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { readGraphText } from "@/native/graph-text";
import { resolveCliForLaunch } from "@/native/resolver";
import { applyBuiltInPatches } from "@/patches/cli-patches";

describe("built-in runtime patches", () => {
  test("every built-in patch applies to the pinned Claude Code bundle", () => {
    const wrapperDir = dirname(createRequire(import.meta.url).resolve("@anthropic-ai/claude-code/package.json"));
    const { graphDir } = resolveCliForLaunch(wrapperDir);
    const result = applyBuiltInPatches(readGraphText(graphDir).combined);

    expect(result.missed).toEqual([]);
  }, 120_000);
});
