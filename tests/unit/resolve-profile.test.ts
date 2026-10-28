import { afterEach, describe, expect, test } from "bun:test";
import { removeInheritedApiCredentials } from "@/config/builders/resolve-profile";

const savedCredentials = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
};

afterEach(() => {
  for (const [name, value] of Object.entries(savedCredentials)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("removeInheritedApiCredentials", () => {
  test("drops inherited API credentials when a subscription token is available", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "subscription-token";
    process.env.ANTHROPIC_API_KEY = "inherited-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "inherited-token";

    removeInheritedApiCredentials(undefined);

    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  test("keeps API credentials the selected profile sets itself", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "subscription-token";
    process.env.ANTHROPIC_API_KEY = "";
    process.env.ANTHROPIC_AUTH_TOKEN = "provider-token";

    removeInheritedApiCredentials({ env: { ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "provider-token" } });

    expect(process.env.ANTHROPIC_API_KEY).toBe("");
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("provider-token");
  });

  test("keeps the caller's API credentials when no subscription token is available", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "";
    process.env.ANTHROPIC_API_KEY = "caller-key";

    removeInheritedApiCredentials(undefined);

    expect(process.env.ANTHROPIC_API_KEY).toBe("caller-key");
  });
});
