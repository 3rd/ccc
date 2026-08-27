import { describe, expect, test } from "bun:test";
import {
  GRAPH_NODE_FETCH_SHIM_NAME,
  GRAPH_PREAMBLE_MODULE_NAME,
  GRAPH_WS_SHIM_NAME,
  rewriteGraphModuleForNode,
} from "@/native/preamble";

const MODULE_HEADER = "// @bun @bytecode";
const PREAMBLE_IMPORT = `import "/$bunfs/root/${GRAPH_PREAMBLE_MODULE_NAME}";`;

const rewrite = (...lines: string[]) => rewriteGraphModuleForNode([MODULE_HEADER, ...lines].join("\n"));

describe("rewriteGraphModuleForNode", () => {
  test("injects the preamble import after the module's first line", () => {
    const rewritten = rewrite("const x = 1;");
    expect(rewritten.split("\n").slice(0, 3)).toEqual([MODULE_HEADER, PREAMBLE_IMPORT, "const x = 1;"]);
  });

  test("prepends the preamble import when the module has a single line", () => {
    expect(rewriteGraphModuleForNode("const x = 1;")).toBe(`${PREAMBLE_IMPORT}\nconst x = 1;`);
  });

  test("routes the Bun.stringWidth wrapper through the global shim", () => {
    const rewritten = rewrite("function w8(H){return Bun.stringWidth(H,Ai4)}");
    expect(rewritten).toContain("function w8(H){return globalThis.__cccBun.stringWidth(H)}");
    expect(rewritten).not.toContain("Bun.stringWidth(H,Ai4)");
  });

  test("replaces unguarded Bun APIs and preserves typeof guards", () => {
    const rewritten = rewrite(
      "const exe = Bun.which('rg');",
      "const id = Bun.hash(name, Bun.hash(path)).toString();",
      'if (typeof globalThis.Bun < "u") return globalThis.Bun.which("rg");',
      'if (typeof Bun > "u") return null;',
    );
    expect(rewritten).toContain("__cccBun.which('rg')");
    expect(rewritten).toContain("__cccBun.hash(name, __cccBun.hash(path)).toString()");
    expect(rewritten).toContain('if (typeof globalThis.__cccBun < "u") return globalThis.__cccBun.which("rg");');
    expect(rewritten).toContain('if (typeof Bun > "u") return null;');
    expect(rewritten.slice(MODULE_HEADER.length)).not.toMatch(/\bBun\./);
  });

  test("rewrites Bun references inside strings and comments too", () => {
    const rewritten = rewrite('const message = "Bun.Terminal unavailable";', "// Bun.spawn documentation");
    expect(rewritten).toContain('"__cccBun.Terminal unavailable"');
    expect(rewritten).toContain("// __cccBun.spawn documentation");
  });

  test("routes import.meta.require through the shim", () => {
    const rewritten = rewrite('const addon = import.meta.require("/$bunfs/root/thing.node");');
    expect(rewritten).toContain('globalThis.__cccBun.__importMetaRequire("/$bunfs/root/thing.node")');
    expect(rewritten).not.toContain("import.meta.require");
  });

  test("redirects static and dynamic ws and node-fetch imports to the shim modules", () => {
    const rewritten = rewrite(
      'import ws from "ws";',
      'const lazyWs = await import("ws");',
      'import fetch from"node-fetch";',
      'const lazyFetch = await import( "node-fetch" );',
    );
    expect(rewritten).toContain(`import ws from "/$bunfs/root/${GRAPH_WS_SHIM_NAME}";`);
    expect(rewritten).toContain(`const lazyWs = await import("/$bunfs/root/${GRAPH_WS_SHIM_NAME}");`);
    expect(rewritten).toContain(`import fetch from"/$bunfs/root/${GRAPH_NODE_FETCH_SHIM_NAME}";`);
    expect(rewritten).toContain(`const lazyFetch = await import("/$bunfs/root/${GRAPH_NODE_FETCH_SHIM_NAME}");`);
    expect(rewritten).not.toContain('"ws"');
    expect(rewritten).not.toContain('"node-fetch"');
  });
});
