import { describe, expect, test } from "bun:test";
import { applyBuiltInPatches, applyUserPatches } from "@/patches/cli-patches";

describe("applyBuiltInPatches", () => {
  test("applies built-in string replacements", () => {
    const content = '["security-review","keep-me"]';
    const next = applyBuiltInPatches(content);

    expect(next.content).toContain("zsecurityreview");
    expect(next.content).toContain("keep-me");
    expect(next.applied).toEqual(['"security-review" => "zsecurityreview"']);
    expect(next.missed).toEqual([
      "growthbook-sync-flag-override",
      "disable-find-grep-shadow",
    ]);
  });

  test("reports misses when built-in replacements do not match", () => {
    const content = '["keep-me"]';
    const next = applyBuiltInPatches(content);

    expect(next.content).toBe(content);
    expect(next.applied).toEqual([]);
    expect(next.missed).toEqual([
      '"security-review" => "zsecurityreview"',
      "growthbook-sync-flag-override",
      "disable-find-grep-shadow",
    ]);
  });
});

describe("applyUserPatches", () => {
  test("applies string and function patches in order", () => {
    const next = applyUserPatches("alpha beta", [
      { find: "alpha", replace: "omega" },
      { fn: (content) => `${content}!`, name: "append punctuation" },
    ]);

    expect(next.content).toBe("omega beta!");
    expect(next.applied).toEqual(['"alpha" => "omega"', "append punctuation"]);
    expect(next.missed).toEqual([]);
  });

  test("tracks misses for user patches that make no change", () => {
    const next = applyUserPatches("alpha beta", [
      { find: "missing", replace: "omega" },
      { fn: (content) => content, name: "noop" },
    ]);

    expect(next.content).toBe("alpha beta");
    expect(next.applied).toEqual([]);
    expect(next.missed).toEqual(['"missing" => "omega"', "noop"]);
  });
});
