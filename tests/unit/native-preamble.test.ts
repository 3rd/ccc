import { describe, expect, test } from "bun:test";
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NATIVE_BUN_ENTRY_MARKER } from "@/native/constants";
import { wrapForNode } from "@/native/preamble";

const execFileAsync = promisify(execFile);

describe("wrapForNode", () => {
  test("replaces Bun.stringWidth wrappers in native dumps", () => {
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        "function w8(H){return Bun.stringWidth(H,Ai4)}",
        "})",
      ].join("\n"),
    );

    const wrapped = wrapForNode(raw);

    expect(wrapped).not.toContain("Bun.stringWidth");
    expect(wrapped).toContain("function w8(H){return __cccStringWidth(H)}");
  });

  test("replaces unguarded Bun APIs and exposes the Bun compatibility global", () => {
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        "const frontmatter = Bun.YAML.parse(text);",
        "const id = Bun.hash(frontmatter.name, Bun.hash(path)).toString();",
        "const exe = Bun.which('rg');",
        "const wrapped = Bun.wrapAnsi(title, 80);",
        "const clean = Bun.stripANSI(wrapped);",
        "const newer = Bun.semver.order('2.0.0', '1.0.0');",
        "const ok = Bun.semver.satisfies('2.0.0', '>=1.0.0');",
        "const parser = Bun.JSONL?.parseChunk;",
        "const embedded = Bun.embeddedFiles;",
        "const tx = new Bun.Transpiler({ loader: 'js' });",
        "Bun.gc();",
        "const process = Bun.spawn(['node', '--version'], { stdout: 'pipe' });",
        "const terminal = new Bun.Terminal({ cols: 80, rows: 24 });",
        "const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: {} });",
        "if (typeof globalThis.Bun < \"u\") return globalThis.Bun.which('rg');",
        "if (typeof Bun > \"u\") return null;",
        "})",
      ].join("\n"),
    );

    const wrapped = wrapForNode(raw);

    expect(wrapped).toContain("__cccBun.YAML.parse(text)");
    expect(wrapped).toContain("__cccBun.hash(frontmatter.name, __cccBun.hash(path)).toString()");
    expect(wrapped).toContain("__cccBun.which('rg')");
    expect(wrapped).toContain("new __cccBun.Transpiler");
    expect(wrapped).toContain("__cccBun.spawn");
    expect(wrapped).toContain("new __cccBun.Terminal");
    expect(wrapped).toContain("__cccBun.listen");
    expect(wrapped).toContain("globalThis.__cccBun ??= __cccBun");
    expect(wrapped).toContain("globalThis.Bun ??= globalThis.__cccBun");
    expect(wrapped).toContain("var Bun = globalThis.Bun");
    expect(wrapped).toContain('if (typeof globalThis.__cccBun < "u") return globalThis.__cccBun.which');
    expect(wrapped).toContain('if (typeof Bun > "u") return null;');
    expect(wrapped).not.toMatch(/\bBun\./);
  });

  test("adds Bun spawn terminal and listen compatibility shims", () => {
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        "const terminal = new Bun.Terminal({ cols: 80, rows: 24 });",
        "const child = Bun.spawn(['node', '--version'], { terminal });",
        "const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: {} });",
        "})",
      ].join("\n"),
    );

    const wrapped = wrapForNode(raw);

    expect(wrapped).toContain("terminal?._attach?.(child)");
    expect(wrapped).toContain("write(data) { if (this.closed) return 0");
    expect(wrapped).toContain("resize(cols, rows)");
    expect(wrapped).toContain('this.child?.kill?.("SIGWINCH")');
    expect(wrapped).toContain("setRawMode(enabled)");
    expect(wrapped).toContain("this.options.exit?.(this, 0, null)");
    expect(wrapped).toContain("this.options.drain?.(this)");
    expect(wrapped).toContain('child.once("error", (error)');
    expect(wrapped).toContain("get signalCode()");
    expect(wrapped).toContain("resolve(code ?? (signal ? 1 : 0))");
    expect(wrapped).toContain("stdin: terminal ? null : child.stdin");
    expect(wrapped).toContain("stdout: terminal ? null");
    expect(wrapped).toContain("[Symbol.asyncDispose]()");
    expect(wrapped).toContain("socket.writableNeedDrain");
    expect(wrapped).toContain("options.socket?.close?.(bunSocket, closeError)");
    expect(wrapped).toContain("ref() { server.ref(); }");
    expect(wrapped).toContain("unref() { server.unref(); }");
  });

  test("replaces Bun mentions in strings and comments so minified code cannot escape", () => {
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        'const message = "Bun.Terminal unavailable";',
        "// Bun.spawn documentation",
        "const child = Bun.spawn(['node', '--version']);",
        "})",
      ].join("\n"),
    );

    const wrapped = wrapForNode(raw);

    expect(wrapped).toContain('"__cccBun.Terminal unavailable"');
    expect(wrapped).toContain("// __cccBun.spawn documentation");
    expect(wrapped).toContain("__cccBun.spawn(['node', '--version'])");
  });

  test("continues replacing after regex literals containing slash pairs", () => {
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        "const url = /https?:\\/\\//;",
        "const exe = Bun.which('rg');",
        "})",
      ].join("\n"),
    );

    const wrapped = wrapForNode(raw);

    expect(wrapped).toContain("const url = /https?:\\/\\//;");
    expect(wrapped).toContain("__cccBun.which('rg')");
  });

  test("shims Bun.file spawn stdio targets, deepEquals, isStandaloneExecutable, and stdin", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ccc-native-preamble-"));
    const tempFile = join(tempDir, "wrapped.mjs");
    const logFile = join(tempDir, "breadcrumb.log");
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        `const child = Bun.spawn(['node', '-e', 'console.error("crumb")'], { stdio: ['ignore', 'ignore', Bun.file(${JSON.stringify(logFile)})] });`,
        `child.exited.then(() => Bun.file(${JSON.stringify(logFile)}).text()).then((log) => {`,
        "  console.log(JSON.stringify([log.trim(), Bun.deepEquals({ a: [1] }, { a: [1] }), Bun.deepEquals({ a: 1 }, { a: 2 }), Bun.isStandaloneExecutable, typeof Bun.stdin.stream]));",
        "});",
        "})",
      ].join("\n"),
    );

    try {
      await writeFile(tempFile, wrapForNode(raw));
      const { stdout } = await execFileAsync("node", [tempFile], {
        env: { ...process.env, CCC_CLAUDE_WRAPPER_PKG_JSON: join(process.cwd(), "package.json") },
        timeout: 10000,
      });

      expect(JSON.parse(stdout.trim())).toEqual(["crumb", true, false, false, "function"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns a nonzero listen port synchronously for port zero", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ccc-native-preamble-"));
    const tempFile = join(tempDir, "wrapped.mjs");
    const raw = Buffer.from(
      [
        "// @bun @bytecode @bun-cjs",
        `${NATIVE_BUN_ENTRY_MARKER}`,
        "const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: {} });",
        "console.log(String(server.port));",
        "server.stop(true);",
        "})",
      ].join("\n"),
    );

    try {
      await writeFile(tempFile, wrapForNode(raw));
      const { stdout } = await execFileAsync("node", [tempFile], {
        env: { ...process.env, CCC_CLAUDE_WRAPPER_PKG_JSON: join(process.cwd(), "package.json") },
        timeout: 5000,
      });

      expect(Number(stdout.trim())).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
