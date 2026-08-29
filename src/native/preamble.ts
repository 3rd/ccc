import { parse } from "acorn";
import { createHash } from "crypto";
import { NATIVE_BUNFS_ROOT_PREFIX } from "./constants";

const PREAMBLE = [
  'import { createRequire } from "module";',
  'import { fileURLToPath } from "url";',
  'import { dirname } from "path";',
  "",
  "// node-populated when running as ESM; __filename/__dirname fall back in case the bundle wrapper is invoked as CJS.",
  'const __filename__ = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);',
  'const __dirname__ = typeof __dirname !== "undefined" ? __dirname : dirname(__filename__);',
  "",
  "// The cached cli.mjs lives under ~/.cache/ccc/... which has NO node_modules chain to the",
  "// launcher's deps (yaml, undici, ajv, etc.). Anchor require() on the wrapper's",
  "// package.json so fallback paths find their modules.",
  "const __requireAnchor = process.env.CCC_CLAUDE_WRAPPER_PKG_JSON || import.meta.url;",
  "const __baseRequire = createRequire(__requireAnchor);",
  "",
  "// bun ships node-fetch + ws as builtins; node does not. shim at require-time only.",
  "function __require(specifier) {",
  '  if (specifier === "node-fetch") {',
  "    const fetchFn = globalThis.fetch;",
  '    if (typeof fetchFn !== "function") {',
  '      throw new Error("node-fetch shim: global fetch is not available; upgrade to node 18+ or install node-fetch");',
  "    }",
  "    return Object.assign(fetchFn, {",
  "      default: fetchFn,",
  "      Headers: globalThis.Headers,",
  "      Request: globalThis.Request,",
  "      Response: globalThis.Response,",
  "      FormData: globalThis.FormData,",
  "      Blob: globalThis.Blob,",
  "      File: globalThis.File,",
  "    });",
  "  }",
  '  if (specifier === "ws") {',
  '    try { return __baseRequire("ws"); } catch {}',
  "    const WSImpl = globalThis.WebSocket;",
  '    if (typeof WSImpl === "function") {',
  "      WSImpl.CONNECTING ??= 0;",
  "      WSImpl.OPEN ??= 1;",
  "      WSImpl.CLOSING ??= 2;",
  "      WSImpl.CLOSED ??= 3;",
  "      return WSImpl;",
  "    }",
  '    const { EventEmitter } = __baseRequire("events");',
  "    class StubWebSocket extends EventEmitter {",
  "      static CONNECTING = 0;",
  "      static OPEN = 1;",
  "      static CLOSING = 2;",
  "      static CLOSED = 3;",
  "      readyState = StubWebSocket.CONNECTING;",
  "      constructor(url) {",
  "        super();",
  "        this.url = url;",
  '        queueMicrotask(() => { this.readyState = StubWebSocket.OPEN; this.emit("open"); });',
  "      }",
  "      send() {}",
  "      ping() {}",
  '      close() { if (this.readyState !== StubWebSocket.CLOSED) { this.readyState = StubWebSocket.CLOSED; this.emit("close"); } }',
  "      terminate() { this.close(); }",
  "    }",
  "    return StubWebSocket;",
  "  }",
  "  // bun embeds native assets (napi addons, ripgrep.node) and requires them via",
  "  // bunfs paths, substituted to the materialized graph dir at cache-write time.",
  "  // the addons exist on disk but are not loaded under node: their node-ABI",
  "  // compatibility is unverified, and every bundle call site falls back on a",
  "  // throw (vendor-path probing; CCC sets USE_BUILTIN_RIPGREP=0 for system",
  "  // ripgrep). the thrown error names the asset; a bare require failure would not.",
  `  if (typeof specifier === "string" && specifier.startsWith("${NATIVE_BUNFS_ROOT_PREFIX}")) {`,
  "    // 2.1.248+ chunks require sibling ESM chunks synchronously at module top",
  "    // level (import.meta.require of a chunk-*.js); bun resolves those from the",
  "    // graph, and node >= 22.12 does the same via require(esm). when the target's",
  "    // static closure reaches into the import cycle being evaluated, node refuses",
  "    // (ERR_REQUIRE_CYCLE_MODULE) where bun would evaluate through the cycle with",
  "    // partial namespaces; a lazy namespace defers resolution to first property",
  "    // access, which for these interop requires happens after the cycle completes.",
  '    if (specifier.endsWith(".js") || specifier.endsWith(".mjs")) {',
  "      try {",
  "        return __baseRequire(specifier);",
  "      } catch (error) {",
  '        if (error?.code !== "ERR_REQUIRE_CYCLE_MODULE") throw error;',
  "        return __cccLazyNamespace(specifier);",
  "      }",
  "    }",
  "    throw new Error(",
  '      "native-preamble: refusing to load bun-embedded asset: " + specifier + ". " +',
  '      "Materialized graph assets are not loaded under node. " +',
  '      "If claude-code needs this asset, extend __require in src/native/preamble.ts."',
  "    );",
  "  }",
  "  return __baseRequire(specifier);",
  "}",
  "",
  "const __cccLazyNamespaceCache = new Map();",
  "function __cccLazyNamespace(specifier) {",
  "  let cached = __cccLazyNamespaceCache.get(specifier);",
  "  if (cached) return cached;",
  "  let resolved;",
  "  const resolve = () => (resolved ??= __baseRequire(specifier));",
  "  cached = new Proxy({}, {",
  "    get: (_target, property) => resolve()[property],",
  "    has: (_target, property) => property in resolve(),",
  "    ownKeys: () => Reflect.ownKeys(resolve()),",
  "    // namespace properties are non-configurable, which a plain-object proxy",
  "    // target must not report; force configurable to satisfy proxy invariants",
  "    getOwnPropertyDescriptor: (_target, property) => {",
  "      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);",
  "      if (descriptor) descriptor.configurable = true;",
  "      return descriptor;",
  "    },",
  "  });",
  "  __cccLazyNamespaceCache.set(specifier, cached);",
  "  return cached;",
  "}",
  "",
  "function __cccRequireDefault(specifier) {",
  "  try {",
  "    const mod = __baseRequire(specifier);",
  "    return mod?.default ?? mod;",
  "  } catch {",
  "    return null;",
  "  }",
  "}",
  'const __cccStringWidthPackage = __cccRequireDefault("string-width");',
  'const __cccStripAnsiPackage = __cccRequireDefault("strip-ansi");',
  'const __cccWrapAnsiPackage = __cccRequireDefault("wrap-ansi");',
  "function __cccStringWidth(value) {",
  '  if (typeof __cccStringWidthPackage === "function") return __cccStringWidthPackage(String(value));',
  "  let width = 0;",
  "  for (const char of String(value)) {",
  "    const code = char.codePointAt(0) ?? 0;",
  "    if (code === 0 || code < 32 || (code >= 127 && code < 160)) continue;",
  "    width += code >= 4352 && code <= 4447 || code >= 9001 && code <= 9002 || code >= 11904 && code <= 42191 || code >= 44032 && code <= 55203 || code >= 63744 && code <= 64255 || code >= 65040 && code <= 65049 || code >= 65072 && code <= 65131 || code >= 65281 && code <= 65376 || code >= 65504 && code <= 65510 || code >= 127744 && code <= 129791 || code >= 131072 && code <= 196607 ? 2 : 1;",
  "  }",
  "  return width;",
  "}",
  "function __cccBunHash(value, seed) {",
  '  const hash = __baseRequire("crypto").createHash("sha256");',
  "  if (seed !== undefined) hash.update(String(seed));",
  '  hash.update(typeof value === "string" ? value : String(value));',
  '  return Number.parseInt(hash.digest("hex").slice(0, 13), 16);',
  "}",
  "function __cccToBuffer(data) {",
  "  if (Buffer.isBuffer(data)) return data;",
  "  if (data instanceof Uint8Array) return Buffer.from(data);",
  "  return Buffer.from(String(data));",
  "}",
  "function __cccStripAnsi(value) {",
  '  if (typeof __cccStripAnsiPackage === "function") return __cccStripAnsiPackage(String(value));',
  '  return String(value).replace(/\\x1B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|\\x1B\\\\))/g, "");',
  "}",
  "function __cccWrapAnsi(value, columns, options) {",
  "  const text = String(value);",
  "  if (!Number.isFinite(columns) || columns <= 0) return text;",
  '  if (typeof __cccWrapAnsiPackage === "function") return __cccWrapAnsiPackage(text, columns, options);',
  "  const lines = [];",
  '  for (const line of text.split("\\n")) {',
  '    let current = "";',
  "    let width = 0;",
  "    for (const char of line) {",
  "      const charWidth = __cccStringWidth(char);",
  "      if (width > 0 && width + charWidth > columns) {",
  "        lines.push(current);",
  "        current = char;",
  "        width = charWidth;",
  "      } else {",
  "        current += char;",
  "        width += charWidth;",
  "      }",
  "    }",
  "    lines.push(current);",
  "  }",
  '  return lines.join("\\n");',
  "}",
  "function __cccParseVersion(version) {",
  "  const match = String(version).trim().match(/^(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:[-+].*)?$/);",
  "  return match ? [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)] : [0, 0, 0];",
  "}",
  "function __cccCompareVersions(left, right) {",
  "  const a = __cccParseVersion(left);",
  "  const b = __cccParseVersion(right);",
  "  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;",
  "  return 0;",
  "}",
  "function __cccSemverSatisfies(version, range) {",
  "  const text = String(range).trim();",
  '  if (!text || text === "*") return true;',
  '  if (text.startsWith(">=")) return __cccCompareVersions(version, text.slice(2)) >= 0;',
  '  if (text.startsWith(">")) return __cccCompareVersions(version, text.slice(1)) > 0;',
  '  if (text.startsWith("<=")) return __cccCompareVersions(version, text.slice(2)) <= 0;',
  '  if (text.startsWith("<")) return __cccCompareVersions(version, text.slice(1)) < 0;',
  '  if (text.startsWith("=")) return __cccCompareVersions(version, text.slice(1)) === 0;',
  "  return __cccCompareVersions(version, text) === 0;",
  "}",
  "function __cccWhich(command) {",
  '  const fs = __baseRequire("fs");',
  '  const path = __baseRequire("path");',
  '  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);',
  '  const extensions = process.platform === "win32" ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";") : [""];',
  "  for (const dir of pathEntries) {",
  "    for (const ext of extensions) {",
  '      const candidate = path.join(dir, process.platform === "win32" && path.extname(command) ? command : command + ext);',
  "      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}",
  "    }",
  "  }",
  "  return null;",
  "}",
  "function __cccJsonlParseChunk(chunk) {",
  '  const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");',
  "  const values = [];",
  "  let read = 0;",
  "  for (const part of text.split(/(?<=\\n)/)) {",
  '    if (!part.endsWith("\\n")) break;',
  "    read += part.length;",
  "    const line = part.trim();",
  "    if (!line) continue;",
  "    try { values.push(JSON.parse(line)); } catch (error) { return { values, read, error, done: false }; }",
  "  }",
  "  return { values, read, done: read >= text.length };",
  "}",
  "// bun file shim (path- or fd-backed); read surface is the commonly used subset.",
  "// _openForWriteSync exists for bun spawn stdio redirection (the ptyHost stderr",
  "// breadcrumb passes a bun file handle as a stdio target); append mode so respawn",
  "// loops do not clobber earlier breadcrumbs. Open errors keep fs error codes so",
  "// callers that inspect error.code (ENOSPC/EACCES/EROFS at the breadcrumb site)",
  "// behave as they would under bun.",
  "// (no literal 'Bun-dot' may appear in preamble text: the preamble is injected",
  "// after the bundle rewrite, and tests assert the wrapped output is Bun-dot-free.)",
  "class __cccBunFile {",
  "  constructor(pathOrFd) {",
  '    if (typeof pathOrFd === "number") { this.fd = pathOrFd; this.name = undefined; }',
  "    else { this.path = String(pathOrFd); this.name = this.path; }",
  "  }",
  '  _target() { return this.fd ?? this.path; }',
  '  _openForWriteSync() { if (this.fd !== undefined) return this.fd; return __baseRequire("fs").openSync(this.path, "a"); }',
  '  async text() { return __baseRequire("fs").readFileSync(this._target(), "utf8"); }',
  "  async json() { return JSON.parse(await this.text()); }",
  '  async bytes() { const buffer = __baseRequire("fs").readFileSync(this._target()); return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength); }',
  "  async arrayBuffer() { const bytes = await this.bytes(); return bytes.slice().buffer; }",
  '  stream() { const fs = __baseRequire("fs"); const { Readable } = __baseRequire("stream"); return Readable.toWeb(this.fd !== undefined ? fs.createReadStream(null, { fd: this.fd, autoClose: false }) : fs.createReadStream(this.path)); }',
  '  async exists() { try { __baseRequire("fs").accessSync(this._target()); return true; } catch { return false; } }',
  '  get size() { try { const fs = __baseRequire("fs"); return (this.fd !== undefined ? fs.fstatSync(this.fd) : fs.statSync(this.path)).size; } catch { return 0; } }',
  '  get lastModified() { try { const fs = __baseRequire("fs"); return (this.fd !== undefined ? fs.fstatSync(this.fd) : fs.statSync(this.path)).mtimeMs; } catch { return 0; } }',
  "}",
  "// bun stdin shim: file-ish view of process.stdin; the bundle consumes it via",
  "// `new Response(stdin.stream()).text()`.",
  "const __cccBunStdin = {",
  '  stream() { return __baseRequire("stream").Readable.toWeb(process.stdin); },',
  "  async text() {",
  "    const chunks = [];",
  "    for await (const chunk of process.stdin) chunks.push(__cccToBuffer(chunk));",
  '    return Buffer.concat(chunks).toString("utf8");',
  "  },",
  "  async json() { return JSON.parse(await this.text()); },",
  "  async bytes() { const chunks = []; for await (const chunk of process.stdin) chunks.push(__cccToBuffer(chunk)); const buffer = Buffer.concat(chunks); return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength); },",
  "};",
  "class __cccTranspiler {",
  "  transformSync(code) {",
  '    const source = typeof code === "string" ? code : String(code);',
  "    let esbuild;",
  '    try { esbuild = __baseRequire("esbuild"); } catch { return source; }',
  '    const options = { loader: "js", target: "esnext", supported: { "top-level-await": false } };',
  "    try {",
  "      return esbuild.transformSync(source, options).code;",
  "    } catch (error) {",
  "      // top-level await is a syntax error in claude's repl (code runs via new vm.Script,",
  "      // not as a module), so wrap it in an async IIFE. a multi-statement wrap resolves to",
  "      // undefined and the repl falls back to resolving the `o` global.",
  '      const isTopLevelAwait = error && Array.isArray(error.errors) && error.errors.some((e) => /top-level await/i.test((e && e.text) || ""));',
  "      if (!isTopLevelAwait) return source;",
  '      const trimmed = source.trim().replace(/;$/, "").trim();',
  '      const startsStatement = /^(?:let|const|var|function|class|return|throw|if|for|while|switch|try|do|import|export|debugger)\\b/.test(trimmed);',
  '      const single = trimmed.length > 0 && !startsStatement && !trimmed.includes("\\n") && !trimmed.includes(";");',
  '      const wrapped = single ? "(async()=>(" + trimmed + "\\n))()" : "(async()=>{" + source + "\\n})()";',
  "      try { return esbuild.transformSync(wrapped, options).code; } catch { return wrapped; }",
  "    }",
  "  }",
  "  transform(code) { return Promise.resolve(this.transformSync(code)); }",
  "  scan() { return { imports: [], exports: [] }; }",
  "  scanImports() { return []; }",
  "}",
  "class __cccTerminal {",
  '  constructor(options = {}) { this.options = options; this.child = null; this.cols = options.cols ?? 80; this.rows = options.rows ?? 24; this.name = options.name ?? "xterm-256color"; this.closed = false; this.rawMode = false; this.pending = []; this.stdin = 0; this.stdout = 1; }',
  "  _attach(child) {",
  '    if (this.closed) throw new Error("bun terminal shim: terminal is closed");',
  "    this.child = child;",
  '    child.stdout?.on("data", (chunk) => this.options.data?.(this, chunk));',
  '    child.stderr?.on("data", (chunk) => this.options.data?.(this, chunk));',
  '    child.stdin?.on("drain", () => this.options.drain?.(this));',
  '    child.once("close", () => { if (this.child === child) this.child = null; });',
  "    while (this.pending.length && child.stdin && !child.stdin.destroyed) child.stdin.write(this.pending.shift());",
  "  }",
  '  write(data) { if (this.closed) return 0; const buffer = __cccToBuffer(data); if (!this.child?.stdin || this.child.stdin.destroyed) { this.pending.push(buffer); return buffer.length; } const ok = this.child.stdin.write(buffer); if (!ok) this.child.stdin.once("drain", () => this.options.drain?.(this)); return buffer.length; }',
  '  resize(cols, rows) { this.cols = cols; this.rows = rows; try { this.child?.kill?.("SIGWINCH"); } catch {} }',
  "  setRawMode(enabled) { this.rawMode = !!enabled; }",
  "  close() { if (this.closed) return; this.closed = true; this.pending = []; try { this.child?.kill(); } catch {} this.options.exit?.(this, 0, null); }",
  "  ref() { this.child?.ref?.(); }",
  "  unref() { this.child?.unref?.(); }",
  "  [Symbol.dispose]() { this.close(); }",
  "  [Symbol.asyncDispose]() { this.close(); return Promise.resolve(); }",
  "}",
  "function __cccSpawnStdio(options) {",
  '  if (options.terminal) return ["pipe", "pipe", "pipe"];',
  "  if (options.stdio) return options.stdio;",
  "  return [",
  '    options.stdin === "pipe" ? "pipe" : options.stdin === "inherit" ? "inherit" : "ignore",',
  '    options.stdout === "inherit" ? "inherit" : options.stdout === "ignore" || options.stdout === null ? "ignore" : "pipe",',
  '    options.stderr === "pipe" ? "pipe" : options.stderr === "ignore" || options.stderr === null ? "ignore" : "inherit",',
  "  ];",
  "}",
  "function __cccResolveSpawnFile(file) {",
  '  const fs = __baseRequire("fs");',
  '  const path = __baseRequire("path");',
  '  if (!file) throw new Error("bun spawn shim: missing command");',
  '  if (path.isAbsolute(file) || file.includes("/") || file.includes("\\\\")) {',
  "    fs.accessSync(file, fs.constants.X_OK);",
  "    return file;",
  "  }",
  "  const resolved = __cccWhich(file);",
  "  if (resolved) return resolved;",
  "  const error = new Error(`bun spawn shim: command not found: ${file}`);",
  '  error.code = "ENOENT";',
  "  throw error;",
  "}",
  "function __cccSpawn(command, options = {}) {",
  '  const childProcess = __baseRequire("child_process");',
  "  const commandArray = Array.isArray(command) ? command : [String(command)];",
  "  const [file, ...args] = commandArray;",
  "  // translate bun-file stdio targets (e.g. stdio:['ignore','ignore',file(logPath)])",
  "  // into fds. node dups fds into the child during spawn(), so the parent copies are",
  "  // closed immediately after; on open/spawn failure they are closed in the catch.",
  "  const openedFds = [];",
  "  const stdio = __cccSpawnStdio(options).map((entry) => {",
  "    if (entry instanceof __cccBunFile) { const fd = entry._openForWriteSync(); if (entry.fd === undefined) openedFds.push(fd); return fd; }",
  "    return entry;",
  "  });",
  "  let child;",
  "  try {",
  "    child = childProcess.spawn(__cccResolveSpawnFile(file), args, { cwd: options.cwd, env: options.env, stdio, detached: options.detached, windowsHide: options.windowsHide, argv0: options.argv0 });",
  "  } finally {",
  '    const fsMod = __baseRequire("fs");',
  "    for (const fd of openedFds) { try { fsMod.closeSync(fd); } catch {} }",
  "  }",
  "  const terminal = options.terminal;",
  "  terminal?._attach?.(child);",
  "  const streamText = (stream) => () => new Promise((resolve, reject) => {",
  '    if (!stream) { resolve(""); return; }',
  "    const chunks = [];",
  '    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));',
  '    stream.once("error", reject);',
  '    stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));',
  "  });",
  "  let exitCode = null;",
  "  let signalCode = null;",
  "  const exited = new Promise((resolve, reject) => {",
  '    child.once("error", (error) => { options.onExit?.(result, null, null, error); reject(error); });',
  '    child.once("exit", (code, signal) => { exitCode = code; signalCode = signal; options.onExit?.(result, code, signal); resolve(code ?? (signal ? 1 : 0)); });',
  "  });",
  "  const result = {",
  "    pid: child.pid ?? 0,",
  "    stdin: terminal ? null : child.stdin,",
  "    stdout: terminal ? null : { text: streamText(child.stdout) },",
  "    stderr: terminal ? null : { text: streamText(child.stderr) },",
  "    readable: terminal ? null : { text: streamText(child.stdout) },",
  "    terminal,",
  "    exited,",
  "    get exitCode() { return exitCode; },",
  "    get signalCode() { return signalCode; },",
  "    get killed() { return child.killed; },",
  "    kill: (signal) => child.kill(signal),",
  "    ref: () => child.ref(),",
  "    unref: () => child.unref(),",
  "    send: (message) => child.send?.(message),",
  "    disconnect: () => child.disconnect?.(),",
  "    resourceUsage: () => child.resourceUsage?.(),",
  "    [Symbol.dispose]() { child.kill(); },",
  "    [Symbol.asyncDispose]() { child.kill(); return Promise.resolve(); },",
  "  };",
  "  return result;",
  "}",
  "function __cccListenPort(port) {",
  "  const value = Number(port ?? 0);",
  "  if (value > 0) return value;",
  "  return 49152 + Math.floor(Math.random() * 16384);",
  "}",
  "function __cccListen(options) {",
  '  const net = __baseRequire("net");',
  "  const sockets = new Set();",
  "  const listenPort = __cccListenPort(options.port);",
  "  const server = net.createServer((socket) => {",
  "    sockets.add(socket);",
  "    socket.data = {};",
  "    const bunSocket = {",
  "      get data() { return socket.data; },",
  "      set data(value) { socket.data = value; },",
  "      write: (data) => { if (socket.destroyed || socket.writableEnded || socket.writableNeedDrain) return 0; const buffer = __cccToBuffer(data); socket.write(buffer); return buffer.length; },",
  "      end: () => socket.end(),",
  "    };",
  "    let closeError = null;",
  "    options.socket?.open?.(bunSocket);",
  '    socket.on("data", (data) => options.socket?.data?.(bunSocket, data));',
  '    socket.on("drain", () => options.socket?.drain?.(bunSocket));',
  '    socket.on("close", () => { sockets.delete(socket); options.socket?.close?.(bunSocket, closeError); });',
  '    socket.on("error", (error) => { closeError = error; options.socket?.error?.(bunSocket, error); });',
  "  });",
  "  if (options.unix || options.path) server.listen(options.unix ?? options.path);",
  '  else server.listen(listenPort, options.hostname ?? "127.0.0.1");',
  "  const address = server.address();",
  "  return {",
  '    get port() { const current = server.address(); return typeof current === "object" && current ? current.port : (typeof address === "object" && address ? address.port : listenPort); },',
  "    stop(force) { for (const socket of sockets) force ? socket.destroy() : socket.end(); server.close(); },",
  "    ref() { server.ref(); },",
  "    unref() { server.unref(); },",
  "  };",
  "}",
  "// NOTE: WebView is deliberately NOT shimmed. The bundle guards it with",
  '// `typeof Bun<"u"&&"WebView"in Bun` before calling WebView.closeAll(); absence is',
  "// the correct answer (no native webview under node) and a stub would get called.",
  "const __cccBun = {",
  '  YAML: __require("yaml"),',
  "  JSONL: { parseChunk: __cccJsonlParseChunk },",
  "  embeddedFiles: [],",
  '  version: "0.0.0-ccc-node-shim",',
  "  isStandaloneExecutable: false,",
  "  semver: { order: __cccCompareVersions, satisfies: __cccSemverSatisfies },",
  "  which: __cccWhich,",
  "  stringWidth: __cccStringWidth,",
  "  hash: __cccBunHash,",
  "  wrapAnsi: __cccWrapAnsi,",
  "  stripANSI: __cccStripAnsi,",
  "  Transpiler: __cccTranspiler,",
  "  // Real snapshot via node v8: writeHeapSnapshot to a temp file, read it back.",
  "  // Bun returns an ArrayBuffer for output=arraybuffer, but we return a Buffer:",
  "  // node fs.writeFileSync accepts TypedArrays (Buffer) and REJECTS plain",
  "  // ArrayBuffers, and the bundle passes the result straight to writeFileSync.",
  "  generateHeapSnapshot: (format, output) => {",
  '    if (format === "jsc") {',
  '      throw new Error("ccc bun shim: jsc heap snapshot format is not supported under node; use the v8 format");',
  "    }",
  '    const fs = __baseRequire("fs");',
  '    const os = __baseRequire("os");',
  '    const path = __baseRequire("path");',
  '    const v8 = __baseRequire("v8");',
  '    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-heapsnapshot-"));',
  "    try {",
  '      const written = v8.writeHeapSnapshot(path.join(dir, "snapshot.heapsnapshot"));',
  "      const buf = fs.readFileSync(written);",
  '      return output === "arraybuffer" ? buf : buf.toString("utf8");',
  "    } finally {",
  "      fs.rmSync(dir, { recursive: true, force: true });",
  "    }",
  "  },",
  '  gc: () => { if (typeof globalThis.gc === "function") globalThis.gc(); },',
  "  spawn: __cccSpawn,",
  "  Terminal: __cccTerminal,",
  "  listen: __cccListen,",
  "  file: (pathOrFd) => new __cccBunFile(pathOrFd),",
  "  stdin: __cccBunStdin,",
  '  deepEquals: (a, b) => __baseRequire("util").isDeepStrictEqual(a, b),',
  "  // 2.1.251+ ships embedded text assets zstd-compressed (.md.zst) and reads",
  "  // them via Bun.zstdDecompress(Sync). node's zlib has both since 22.15/23.8;",
  "  // the async node form is callback-style, bun's returns a promise.",
  '  zstdDecompressSync: (data) => __baseRequire("zlib").zstdDecompressSync(data),',
  "  zstdDecompress: (data) =>",
  "    new Promise((resolvePromise, rejectPromise) =>",
  '      __baseRequire("zlib").zstdDecompress(data, (error, result) => (error ? rejectPromise(error) : resolvePromise(result))),',
  "    ),",
  "  // claude gateway features require the native bun binary; the bundle's own",
  '  // `typeof Bun>"u"` branch says as much. Clear errors beat "not a function".',
  '  serve: () => { throw new Error("ccc bun shim: serve() is not supported (claude gateway requires the native bun binary)"); },',
  '  SQL: class { constructor() { throw new Error("ccc bun shim: SQL is not supported (claude gateway requires the native bun binary)"); } },',
  "};",
  "globalThis.__cccBun ??= __cccBun;",
  "globalThis.Bun ??= globalThis.__cccBun;",
  "var Bun = globalThis.Bun;",
  "",
].join("\n");

// Bun.Transpiler fallback for the `typeof Bun === "undefined"` branch only — dead
// under CCC since the PREAMBLE always defines Bun. The live REPL transpiler is
// `__cccTranspiler` above; keep top-level-await handling in sync across both.
const TRANSPILER_BAIL = 'if(typeof Bun>"u")throw Error("unreachable: Bun required")';
const TRANSPILER_POLYFILL = [
  'if(typeof Bun>"u")return ui$??=(()=>{',
  'const __esb=require("esbuild");',
  "const __tx=(c)=>{",
  'if(typeof c!=="string"||!c)return c;',
  "try{",
  '__esb.transformSync(c,{loader:"js",target:"esnext",supported:{"top-level-await":false}});',
  "return c;",
  "}catch(e){",
  'const tla=e&&e.errors&&e.errors.some((er)=>/top-level await/i.test(er.text||""));',
  "if(!tla)return c;",
  'const t=c.trim().replace(/;$/,"").trim();',
  'const single=(t.indexOf("\\n")<0&&t.indexOf(";")<0&&t.length>0);',
  'return single?"(async()=>("+t+"\\n))()":"(async()=>{"+c+"\\n})()";',
  "}",
  "};",
  "return{transformSync:__tx,transform:(c)=>Promise.resolve(__tx(c)),scan:()=>({imports:[],exports:[]})};",
  "})()",
].join("");

const BUN_STRING_WIDTH_RE = /function ([\w$]+)\(([\w$]+)\){return Bun\.stringWidth\(\2,[\w$]+\)}/;
const BUN_DOT_RE = /\bBun\./g;
const GLOBAL_THIS_BUN_RE = /\bglobalThis\.Bun\b/g;

// ---------------------------------------------------------------------------
// bun standalone module-graph support (claude-code >= 2.1.242)
//
// The bundle is no longer one CJS blob but ~1400 separate ESM modules that
// import each other via "/$bunfs/root/<name>" specifiers. Each module gets the
// same Bun-API rewrites as the old bundle plus an injected import of the
// preamble module below, so the shims are installed before any module body
// runs, in the main thread and in worker_threads entries alike.
// ---------------------------------------------------------------------------

// Identity of the materialized layout itself: which files are emitted and
// which of them the patch pipeline may rewrite. It feeds PREAMBLE_VERSION, so
// changing the layout invalidates every cached graph.
export const GRAPH_LAYOUT_VERSION = "graph-layout-4:utf16-assets-transcoded";

export const GRAPH_PREAMBLE_MODULE_NAME = "__ccc_preamble.mjs";
export const GRAPH_WS_SHIM_NAME = "__ccc_ws.mjs";
export const GRAPH_NODE_FETCH_SHIM_NAME = "__ccc_node_fetch.mjs";

// appended to the shared PREAMBLE text to form the graph preamble module.
// `__cccBun` and `__require` are in scope from the PREAMBLE body above it.
const GRAPH_PREAMBLE_EXTRAS = [
  "",
  "// bun.ant is an anthropic-custom native extension (peer credentials, memory",
  "// pressure, prctl). every bundle call site catches and falls back, so a",
  "// throwing stub selects those fallbacks under node.",
  "const __cccAntUnavailable = () => { throw new Error(\"ccc bun shim: Bun.ant is unavailable under node\"); };",
  "__cccBun.ant = {",
  "  getPeerUid: __cccAntUnavailable,",
  "  getPeerPid: __cccAntUnavailable,",
  "  memoryPressureLevel: __cccAntUnavailable,",
  "  setDumpable: __cccAntUnavailable,",
  "};",
  "__cccBun.TOML = {",
  "  parse(text) {",
  '    for (const pkg of ["smol-toml", "@iarna/toml", "toml"]) {',
  "      try {",
  "        const mod = __baseRequire(pkg);",
  "        const parse = mod.parse ?? mod.default?.parse;",
  '        if (typeof parse === "function") return parse(String(text));',
  "      } catch {}",
  "    }",
  '    throw new Error("ccc bun shim: TOML.parse needs a toml package (smol-toml) on the require path");',
  "  },",
  "};",
  "__cccBun.connect = (options) => new Promise((resolvePromise, rejectPromise) => {",
  '  const net = __baseRequire("net");',
  "  const socket = options.unix ? __baseRequire(\"net\").connect(options.unix) : net.connect({ host: options.hostname, port: options.port });",
  "  const handlers = options.socket ?? {};",
  "  let connected = false;",
  "  let closeError = null;",
  "  const bunSocket = {",
  "    data: undefined,",
  "    get remoteAddress() { return socket.remoteAddress; },",
  "    get localPort() { return socket.localPort; },",
  "    write: (chunk) => { if (socket.destroyed || socket.writableEnded) return 0; const buffer = __cccToBuffer(chunk); socket.write(buffer); return buffer.length; },",
  "    end: () => socket.end(),",
  "    terminate: () => socket.destroy(),",
  "    ref: () => socket.ref(),",
  "    unref: () => socket.unref(),",
  "  };",
  '  socket.once("connect", () => { connected = true; resolvePromise(bunSocket); handlers.open?.(bunSocket); });',
  '  socket.on("data", (chunk) => handlers.data?.(bunSocket, chunk));',
  '  socket.on("drain", () => handlers.drain?.(bunSocket));',
  '  socket.on("close", () => { if (connected) handlers.close?.(bunSocket, closeError); });',
  '  socket.on("error", (error) => { closeError = error; if (connected) handlers.error?.(bunSocket, error); else { handlers.connectError?.(bunSocket, error); rejectPromise(error); } });',
  "});",
  "// bun's import.meta.require: a CJS require scoped to the module. bun's text",
  "// loader makes require of a text-loaded embedded file return its contents;",
  "// __cccTextFiles is filled from the graph's own loader metadata at",
  "// materialization time. everything else goes through the shimmed __require",
  "// (ws/node-fetch); graph-root asset requires (the materialized napi addons)",
  "// hit __require's bunfs guard and throw, and the bundle's call sites fall",
  "// back to vendor-path probing.",
  "__cccBun.__textFiles = new Set();",
  "// graph modules register their own namespace as their first body statement, so",
  "// a require of a module that is mid-evaluation in the current import cycle —",
  "// which node's require(esm) refuses — resolves to the (possibly partial)",
  "// namespace, matching bun's in-cycle require semantics.",
  "__cccBun.__graphNamespaces = new Map();",
  "__cccBun.__importMetaRequire = (specifier) => {",
  "  if (__cccBun.__textFiles.has(specifier)) {",
  '    return __baseRequire("fs").readFileSync(specifier, "utf8");',
  "  }",
  "  const graphNamespace = __cccBun.__graphNamespaces.get(specifier);",
  "  if (graphNamespace !== undefined) return graphNamespace;",
  "  return __require(specifier);",
  "};",
  '__cccBun.__wsImpl = () => __require("ws");',
  '__cccBun.__nodeFetchImpl = () => __require("node-fetch");',
  "",
].join("\n");

/**
 * `textFileNames` are the bunfs paths of embedded files the graph marks with
 * bun's text loader; `import.meta.require` of one returns its contents rather
 * than loading it as a module.
 */
export const buildGraphPreambleModule = (textFileNames: readonly string[]) =>
  PREAMBLE +
  GRAPH_PREAMBLE_EXTRAS +
  `__cccBun.__textFiles = new Set(${JSON.stringify(textFileNames)});\n`;

const GRAPH_PREAMBLE_IMPORT = `import "${NATIVE_BUNFS_ROOT_PREFIX}${GRAPH_PREAMBLE_MODULE_NAME}";`;
const GRAPH_WS_SHIM_SPECIFIER = `${NATIVE_BUNFS_ROOT_PREFIX}${GRAPH_WS_SHIM_NAME}`;
const GRAPH_NODE_FETCH_SHIM_SPECIFIER = `${NATIVE_BUNFS_ROOT_PREFIX}${GRAPH_NODE_FETCH_SHIM_NAME}`;

export const buildGraphWsShimModule = () =>
  [
    GRAPH_PREAMBLE_IMPORT,
    "const impl = globalThis.__cccBun.__wsImpl();",
    "export default impl;",
    "",
  ].join("\n");

export const buildGraphNodeFetchShimModule = () =>
  [
    GRAPH_PREAMBLE_IMPORT,
    "const impl = globalThis.__cccBun.__nodeFetchImpl();",
    "export default impl;",
    "export const Headers = globalThis.Headers;",
    "export const Request = globalThis.Request;",
    "export const Response = globalThis.Response;",
    "",
  ].join("\n");

const IMPORT_META_REQUIRE_RE = /\bimport\.meta\.require\b/g;
const WS_IMPORT_RE = /(\bfrom\s*)"ws"/g;
const WS_DYNAMIC_IMPORT_RE = /\bimport\(\s*"ws"\s*\)/g;
const NODE_FETCH_IMPORT_RE = /(\bfrom\s*)"node-fetch"/g;
const NODE_FETCH_DYNAMIC_IMPORT_RE = /\bimport\(\s*"node-fetch"\s*\)/g;

const buildStringWidthReplacement = (fn: string, value: string) =>
  `function ${fn}(${value}){return globalThis.__cccBun.stringWidth(${value})}`;

const CHUNK_REQUIRE_PRECHECK_RE = new RegExp(
  `import\\.meta\\.require\\("${NATIVE_BUNFS_ROOT_PREFIX.replace(/\$/g, "\\$")}[^"]+\\.m?js"\\)`,
);
const CHUNK_SPECIFIER_RE = new RegExp(`^${NATIVE_BUNFS_ROOT_PREFIX.replace(/\$/g, "\\$")}.+\\.m?js$`);

interface TopLevelChunkRequire {
  start: number;
  end: number;
  specifier: string;
}

// a top-level import.meta.require of a sibling graph module blocks that
// module's evaluation in bun, so it is a real evaluation edge; requires inside
// functions run after the graph settles and stay on the runtime shim.
const findTopLevelChunkRequires = (src: string): TopLevelChunkRequire[] => {
  let ast: unknown;
  try {
    ast = parse(src, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    // unparseable module: leave every require on the runtime shim
    return [];
  }

  const requires: TopLevelChunkRequire[] = [];
  const isFunctionType = (type: string) =>
    type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression";

  const visit = (node: Record<string, unknown>, isTopLevel: boolean, isIifeCallee = false) => {
    const type = node.type as string;
    // a sync IIFE body runs during module evaluation, so it stays top-level
    const childTopLevel = isTopLevel && (!isFunctionType(type) || (isIifeCallee && node.async !== true));

    if (type === "CallExpression" && isTopLevel) {
      const callee = node.callee as Record<string, unknown>;
      const args = node.arguments as Array<Record<string, unknown>>;
      if (
        callee.type === "MemberExpression" &&
        (callee.object as Record<string, unknown>).type === "MetaProperty" &&
        ((callee.property as Record<string, unknown>).name as string) === "require" &&
        args.length === 1 &&
        args[0]?.type === "Literal" &&
        typeof args[0].value === "string" &&
        CHUNK_SPECIFIER_RE.test(args[0].value)
      ) {
        requires.push({ start: node.start as number, end: node.end as number, specifier: args[0].value });
        return;
      }
      if (isFunctionType(callee.type as string)) {
        visit(callee, isTopLevel, true);
        for (const argument of args) visit(argument, childTopLevel);
        return;
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as Record<string, unknown>, childTopLevel);
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        visit(value as Record<string, unknown>, childTopLevel);
      }
    }
  };
  visit(ast as Record<string, unknown>, true);
  return requires;
};

// rewrites top-level requires of sibling graph modules into hoisted namespace
// imports, so node links them as the evaluation edges bun treats them as and
// orders import cycles the way bun does; an in-cycle require under node throws
// ERR_REQUIRE_CYCLE_MODULE instead.
const linkTopLevelChunkRequires = (src: string): string => {
  if (!CHUNK_REQUIRE_PRECHECK_RE.test(src)) return src;
  const requires = findTopLevelChunkRequires(src);
  if (requires.length === 0) return src;

  const namesBySpecifier = new Map<string, string>();
  let out = src;
  for (const { start, end, specifier } of [...requires].sort((a, b) => b.start - a.start)) {
    let name = namesBySpecifier.get(specifier);
    if (!name) {
      name = `__cccGraphChunk${namesBySpecifier.size}`;
      namesBySpecifier.set(specifier, name);
    }
    out = out.slice(0, start) + name + out.slice(end);
  }
  for (const [specifier, name] of namesBySpecifier) {
    out += `\nimport * as ${name} from ${JSON.stringify(specifier)};`;
  }
  return out;
};

export const rewriteGraphModuleForNode = (raw: string, bunfsSpecifier: string): string => {
  // must run first: it locates call sites by position in the raw source
  let src = linkTopLevelChunkRequires(raw);

  if (src.includes(TRANSPILER_BAIL)) {
    src = src.replace(TRANSPILER_BAIL, TRANSPILER_POLYFILL);
  }
  // each module has its own scope and only imports the preamble for its side
  // effects, so the replacement reaches the shim through the global
  src = src.replace(BUN_STRING_WIDTH_RE, (_match, fn: string, value: string) =>
    buildStringWidthReplacement(fn, value),
  );
  src = src.replace(IMPORT_META_REQUIRE_RE, "globalThis.__cccBun.__importMetaRequire");
  // function replacers so the shim specifiers need no $-escaping
  src = src.replace(WS_IMPORT_RE, (_match, from: string) => `${from}"${GRAPH_WS_SHIM_SPECIFIER}"`);
  src = src.replace(WS_DYNAMIC_IMPORT_RE, () => `import("${GRAPH_WS_SHIM_SPECIFIER}")`);
  src = src.replace(NODE_FETCH_IMPORT_RE, (_match, from: string) => `${from}"${GRAPH_NODE_FETCH_SHIM_SPECIFIER}"`);
  src = src.replace(NODE_FETCH_DYNAMIC_IMPORT_RE, () => `import("${GRAPH_NODE_FETCH_SHIM_SPECIFIER}")`);
  src = src.replace(BUN_DOT_RE, "__cccBun.");
  src = src.replace(GLOBAL_THIS_BUN_RE, "globalThis.__cccBun");

  // first statement of every module, so shims exist before any body runs
  // (workers start their own module graph at an arbitrary module). the module
  // then registers its own namespace under its bunfs specifier as its first
  // body action, so __importMetaRequire can serve a require of a module that is
  // mid-evaluation in the current import cycle — which node's require(esm)
  // refuses — with the (possibly partial) namespace, matching bun's in-cycle
  // require semantics. the self-import adds no cross-module evaluation edge.
  const selfRegistration =
    `import * as __cccSelfNamespace from ${JSON.stringify(bunfsSpecifier)};` +
    `globalThis.__cccBun.__graphNamespaces.set(${JSON.stringify(bunfsSpecifier)}, __cccSelfNamespace);`;
  const firstNl = src.indexOf("\n");
  const insertAt = firstNl === -1 ? 0 : firstNl + 1;
  return src.slice(0, insertAt) + GRAPH_PREAMBLE_IMPORT + "\n" + selfRegistration + "\n" + src.slice(insertAt);
};

export const PREAMBLE_VERSION = createHash("sha256")
  .update(PREAMBLE)
  .update(TRANSPILER_BAIL)
  .update(TRANSPILER_POLYFILL)
  .update(String(BUN_STRING_WIDTH_RE))
  .update(String(BUN_DOT_RE))
  .update(String(GLOBAL_THIS_BUN_RE))
  .update(GRAPH_PREAMBLE_EXTRAS)
  .update(buildGraphPreambleModule([]))
  .update(buildGraphWsShimModule())
  .update(buildGraphNodeFetchShimModule())
  .update(String(IMPORT_META_REQUIRE_RE))
  .update(String(WS_IMPORT_RE))
  .update(String(WS_DYNAMIC_IMPORT_RE))
  .update(String(NODE_FETCH_IMPORT_RE))
  .update(String(NODE_FETCH_DYNAMIC_IMPORT_RE))
  .update(GRAPH_PREAMBLE_IMPORT)
  .update(GRAPH_WS_SHIM_SPECIFIER)
  .update(GRAPH_NODE_FETCH_SHIM_SPECIFIER)
  .update(GRAPH_LAYOUT_VERSION)
  .update(buildStringWidthReplacement("$", "_"))
  .digest("hex")
  .slice(0, 16);
