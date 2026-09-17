import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGraphPreambleModule,
  GRAPH_NODE_FETCH_SHIM_NAME,
  GRAPH_PREAMBLE_MODULE_NAME,
  GRAPH_WS_SHIM_NAME,
  rewriteGraphModuleForNode,
} from "@/native/preamble";

const MODULE_HEADER = "// @bun @bytecode";
const PREAMBLE_IMPORT = `import "/$bunfs/root/${GRAPH_PREAMBLE_MODULE_NAME}";`;
const MODULE_SPECIFIER = "/$bunfs/root/module.js";
const SELF_REGISTRATION =
  `import * as __cccSelfNamespace from ${JSON.stringify(MODULE_SPECIFIER)};` +
  `globalThis.__cccBun.__graphNamespaces.set(${JSON.stringify(MODULE_SPECIFIER)}, __cccSelfNamespace);`;

const rewrite = (...lines: string[]) =>
  rewriteGraphModuleForNode([MODULE_HEADER, ...lines].join("\n"), MODULE_SPECIFIER);

describe("rewriteGraphModuleForNode", () => {
  test("injects the preamble import and namespace registration after the module's first line", () => {
    const rewritten = rewrite("const x = 1;");
    expect(rewritten.split("\n").slice(0, 4)).toEqual([
      MODULE_HEADER,
      PREAMBLE_IMPORT,
      SELF_REGISTRATION,
      "const x = 1;",
    ]);
  });

  test("prepends the preamble import when the module has a single line", () => {
    expect(rewriteGraphModuleForNode("const x = 1;", MODULE_SPECIFIER)).toBe(
      `${PREAMBLE_IMPORT}\n${SELF_REGISTRATION}\nconst x = 1;`,
    );
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

describe("buildGraphPreambleModule", () => {
  test("resizes oversized clipboard PNGs under Node", () => {
    const directory = mkdtempSync(join(tmpdir(), "ccc-image-preamble-"));
    try {
      const scriptPath = join(directory, "image.mjs");
      writeFileSync(scriptPath, `${buildGraphPreambleModule([])}
const sharp = __baseRequire("sharp");
const input = await sharp({
  create: { width: 2400, height: 1200, channels: 3, background: "red" },
}).png().toBuffer();
const image = new globalThis.__cccBun.Image(input);
const original = await image.metadata();
const output = await image.resize(2000, 1000, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
const resized = await sharp(output).metadata();
console.log(JSON.stringify({
  original: [original.format, original.width, original.height],
  resized: [resized.format, resized.width, resized.height],
  signature: output.subarray(0, 8).toString("hex"),
}));
`);
      const result = spawnSync("node", [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          CCC_CLAUDE_WRAPPER_PKG_JSON: fileURLToPath(new URL("../../package.json", import.meta.url)),
        },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        original: ["png", 2400, 1200],
        resized: ["png", 2000, 1000],
        signature: "89504e470d0a1a0a",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("slices by visible columns with ANSI styles preserved and sleeps synchronously", () => {
    const directory = mkdtempSync(join(tmpdir(), "ccc-preamble-slice-ansi-"));
    try {
      const scriptPath = join(directory, "preamble.mjs");
      writeFileSync(scriptPath, `${buildGraphPreambleModule([])}
const styled = "ab\\x1B[31mcd\\x1B[0mef";
const wrapped = [];
let column = 0;
while (column < __cccBun.stringWidth(styled)) { wrapped.push(__cccBun.sliceAnsi(styled, column, column + 3)); column += 3; }
const wide = "x\\u4F60\\u597Dy";
const before = Date.now();
__cccBun.sleepSync(20);
console.log(JSON.stringify({
  wrapped,
  middle: __cccBun.sliceAnsi(styled, 3, 5),
  wide: [__cccBun.sliceAnsi(wide, 0, 2), __cccBun.sliceAnsi(wide, 1, 3), __cccBun.sliceAnsi(wide, 1, 5)],
  slept: Date.now() - before >= 15,
}));
`);
      const result = spawnSync("node", [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          CCC_CLAUDE_WRAPPER_PKG_JSON: fileURLToPath(new URL("../../package.json", import.meta.url)),
        },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        wrapped: ["ab\x1B[31mc\x1B[0m", "\x1B[31md\x1B[0mef"],
        middle: "\x1B[31md\x1B[0me",
        wide: ["x", "\u4F60", "\u4F60\u597D"],
        slept: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("segments and paints terminal cells through Bun.ant.CellSegmenter under Node", () => {
    const directory = mkdtempSync(join(tmpdir(), "ccc-preamble-cell-segmenter-"));
    try {
      const scriptPath = join(directory, "preamble.mjs");
      // the renderer's screen word layout: style << 17 | link << 2 | width
      writeFileSync(scriptPath, `${buildGraphPreambleModule([])}
const pack = (style, link, width) => style << 17 | link << 2 | width;
const native = new __cccBun.ant.CellSegmenter({ ambiguousIsNarrow: true, substitute: [[8234, 8238]], screen: {
  widthMask: 3, narrow: 0, wide: 1, spacerTail: 2, spacerHead: 3, emptyCharIndex: 0, spacerCharIndex: 1, emptyWord: pack(0, 0, 0), tabWidth: 8,
} });
const cells = new Int32Array(64), runs = new Int32Array(64);
const count = native.segment("a\\x1B[31mb\\u4F60\\x1B[0m\\t\\x1B]8;;https://x\\x07c\\x1B]8;;\\x07\\u202Ad", cells, runs, false);
const segmented = [];
for (let i = 0; i < count; i++) segmented.push([native.graphemes[cells[2 * i]], cells[2 * i + 1] & 255, (cells[2 * i + 1] & 256) !== 0, cells[2 * i + 1] >>> 10]);
const runTable = [];
for (let r = 0; r <= Math.max(...segmented.map((c) => c[3])); r++) runTable.push([native.sgrKeys[runs[2 * r]], native.sgrCloseKeys[runs[2 * r]], native.uris[runs[2 * r + 1]]]);
const tooSmall = native.segment("abc", new Int32Array(4), new Int32Array(4), false);
const screen = new Int32Array(2 * 12);
const charIndices = native.graphemes.map((_, i) => 100 + i);
const runWords = runTable.map((_, r) => pack(r + 1, 0, 0));
const painted = native.paint(screen, 12, 1, 0, cells, count, undefined, charIndices, runWords);
const row = [];
for (let x = 0; x < 12; x++) row.push([screen[2 * x], screen[2 * x + 1] >>> 17, screen[2 * x + 1] & 3]);
const set = native.setCell(screen, 12, 10, 0, 7, pack(9, 0, 1));
console.log(JSON.stringify({ count, segmented, runTable, tooSmall, paint: [painted % 1048576, Math.floor(painted / 1048576) % 65536, Math.floor(painted / 68719476736)], row, set: [set % 1048576, Math.floor(set / 1048576) % 65536], tail: [screen[20], screen[21] & 3, screen[22], screen[23] & 3] }));
`);
      const result = spawnSync("node", [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          CCC_CLAUDE_WRAPPER_PKG_JSON: fileURLToPath(new URL("../../package.json", import.meta.url)),
        },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        count: 7,
        segmented: [
          ["a", 1, false, 0],
          ["b", 1, false, 1],
          ["\u4F60", 2, false, 1],
          ["\t", 0, true, 2],
          ["c", 1, false, 3],
          ["\uFFFD", 1, false, 4],
          ["d", 1, false, 4],
        ],
        runTable: [
          ["", "", ""],
          ["\x1B[31m", "\x1B[39m", ""],
          ["", "", ""],
          ["", "", "https://x"],
          ["", "", ""],
        ],
        tooSmall: -3,
        // columns 1..10 painted: a b 你(wide+spacer) tab→8 c ￼ d
        paint: [11, 1, 11],
        row: [
          [0, 0, 0],
          [101, 1, 0],
          [102, 2, 0],
          [103, 2, 1],
          [1, 2, 2],
          [0, 3, 0],
          [0, 3, 0],
          [0, 3, 0],
          [105, 4, 0],
          [106, 5, 0],
          [107, 5, 0],
          [0, 0, 0],
        ],
        set: [12, 10],
        tail: [7, 1, 1, 2],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("folds SGR close codes back into the runs they close like the ink renderer", () => {
    const directory = mkdtempSync(join(tmpdir(), "ccc-preamble-sgr-runs-"));
    try {
      const scriptPath = join(directory, "preamble.mjs");
      writeFileSync(scriptPath, `${buildGraphPreambleModule([])}
const native = new __cccBun.ant.CellSegmenter({ ambiguousIsNarrow: true, substitute: [], screen: {
  widthMask: 3, narrow: 0, wide: 1, spacerTail: 2, spacerHead: 3, emptyCharIndex: 0, spacerCharIndex: 1, emptyWord: 0, tabWidth: 8,
} });
const segmentRuns = (text) => {
  const cells = new Int32Array(64), runs = new Int32Array(64);
  const count = native.segment(text, cells, runs, false);
  const out = [];
  for (let i = 0; i < count; i++) {
    const run = cells[2 * i + 1] >>> 10;
    out.push([native.graphemes[cells[2 * i]], native.sgrKeys[runs[2 * run]], native.sgrCloseKeys[runs[2 * run]]]);
  }
  return out;
};
console.log(JSON.stringify({
  dim: segmentRuns("\\x1B[2m4\\x1B[22m 0"),
  boldDim: segmentRuns("\\x1B[1m\\x1B[2ma\\x1B[22mb"),
  recolor: segmentRuns("\\x1B[31m\\x1B[32ma\\x1B[39mb"),
  multi: segmentRuns("\\x1B[1;38;5;12ma\\x1B[22;39mb"),
  truecolor: segmentRuns("\\x1B[48;2;1;2;3ma\\x1B[49mb"),
  closeOnly: segmentRuns("\\x1B[39ma"),
}));
`);
      const result = spawnSync("node", [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          CCC_CLAUDE_WRAPPER_PKG_JSON: fileURLToPath(new URL("../../package.json", import.meta.url)),
        },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        dim: [["4", "\x1B[2m", "\x1B[22m"], [" ", "", ""], ["0", "", ""]],
        boldDim: [["a", "\x1B[1m\0\x1B[2m", "\x1B[22m\0\x1B[22m"], ["b", "", ""]],
        recolor: [["a", "\x1B[32m", "\x1B[39m"], ["b", "", ""]],
        multi: [["a", "\x1B[1m\0\x1B[38;5;12m", "\x1B[22m\0\x1B[39m"], ["b", "", ""]],
        truecolor: [["a", "\x1B[48;2;1;2;3m", "\x1B[49m"], ["b", "", ""]],
        closeOnly: [["a", "", ""]],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("tolerates the startup Bun.unsafe.setJITPolicy call under Node", () => {
    const directory = mkdtempSync(join(tmpdir(), "ccc-preamble-unsafe-"));
    try {
      const scriptPath = join(directory, "preamble.mjs");
      writeFileSync(scriptPath, `${buildGraphPreambleModule([])}
if(typeof Bun<"u")__cccBun.unsafe.setJITPolicy?.(1);
console.log("ok");
`);
      const result = spawnSync("node", [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          CCC_CLAUDE_WRAPPER_PKG_JSON: fileURLToPath(new URL("../../package.json", import.meta.url)),
        },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("ok");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
