import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
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
      "builtin-plugin-hooks-in-memory",
    ]);
  });

  test("built-in plugin hooks load in memory without a folder", () => {
    const content = `function du(){return!1}var Ht=(e,o,r)=>({module:e,scan:o,folder:r});var kB=(e,o,r)=>du()?Ht(o,r(),e):{module:o,folder:e};kB(void 0,"hooks",()=>"scan")`;
    const next = applyBuiltInPatches(content);

    expect(next.applied).toContain("builtin-plugin-hooks-in-memory");
    expect(runInNewContext(next.content)).toEqual({ module: "hooks", scan: "scan", folder: undefined });
  });

  test("featureFlags win over every class-based GrowthBook reader", async () => {
    const content = `class GB{getEnvironmentOverrides(){return null}
getFeatureValueWithSource(e,n){let r=this.getEnvironmentOverrides();if(r&&e in r)return{value:r[e],source:"override"};return{value:n,source:"default"}}
async checkGateCachedOrBlocking(e){let r=this.getEnvironmentOverrides();if(r&&e in r)return Boolean(r[e]);return!1}
async getFeatureValueBlocking(e,n){let r=this.getEnvironmentOverrides();if(r&&e in r)return r[e];return n}}
const gb=new GB();Promise.all([gb.getFeatureValueWithSource("flag",0).value,gb.checkGateCachedOrBlocking("gate"),gb.getFeatureValueBlocking("flag",0)])`;
    const next = applyBuiltInPatches(content);

    const values = await runInNewContext(next.content, {
      globalThis: { __cccFeatureFlags: { flag: 7, gate: true } },
      process: { env: {} },
      Promise,
    });

    expect(next.applied).toContain("growthbook-sync-flag-override");
    expect(values).toEqual([7, true, 7]);
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
      "builtin-plugin-hooks-in-memory",
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
