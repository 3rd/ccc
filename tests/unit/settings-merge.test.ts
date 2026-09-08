import { describe, expect, test } from "bun:test";
import { mergeSettings } from "@/config/layers";

describe("mergeSettings", () => {
  test("featureFlags accumulate across layers with the later layer winning per key", () => {
    const merged = mergeSettings(
      { featureFlags: { tengu_a: true, tengu_b: true }, env: { A: "1" } },
      { featureFlags: { tengu_b: false, tengu_c: true }, env: { B: "2" } },
      { model: "opus" },
    );

    expect(merged.featureFlags).toEqual({ tengu_a: true, tengu_b: false, tengu_c: true });
    expect(merged.env).toEqual({ A: "1", B: "2" });
    expect(merged.model).toBe("opus");
  });

  test("other object settings are replaced by the later layer", () => {
    const merged = mergeSettings(
      { permissions: { allow: ["Read"], deny: ["Bash"] } },
      { permissions: { allow: ["Edit"] } },
    );

    expect(merged.permissions).toEqual({ allow: ["Edit"] });
  });
});
