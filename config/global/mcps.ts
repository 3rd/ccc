import { createConfigMCPs } from "@/config/helpers";

export default createConfigMCPs({
  "sequential-thinking": {
    command: "bunx",
    args: ["@modelcontextprotocol/server-sequential-thinking"],
    env: {},
  },
  // browser: {
  //   command: "nix",
  //   args: ["run", "github:benjaminkitt/nix-playwright-mcp"],
  // },
  // deepwiki: {
  //   type: "sse",
  //   url: "https://mcp.deepwiki.com/sse",
  // },
  // context7: {
  //   type: "sse",
  //   url: "https://mcp.context7.com/sse",
  // },
  // fetch: {
  //   command: "uvx",
  //   args: ["mcp-server-fetch"],
  // },
  // serena: {
  //   command: "uvx",
  //   args: ["--from", "git+https://github.com/oraios/serena", "serena-mcp-server"],
  // },
  // notionMCP: {
  //   command: "npx",
  //   args: ["-y", "mcp-remote", "https://mcp.notion.com/sse"],
  // },
});
