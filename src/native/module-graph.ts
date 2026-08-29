import {
  NATIVE_BUNFS_ROOT_PREFIX,
  NATIVE_GRAPH_OFFSETS_SIZE,
  NATIVE_GRAPH_RECORD_SIZE,
  NATIVE_GRAPH_TRAILER,
} from "./constants";

// bun standalone module-graph layout (StandaloneModuleGraph.rs, bun >= 1.4):
//   [u64 blob-size][graph blob][Offsets (32 bytes)][b"\n---- Bun! ----\n"]
// inside an ELF/Mach-O/PE section. Offsets and the trailer sit at the end of
// the blob region, so `base = offsetsPos - byteCount` self-locates the blob
// without parsing the executable container. All StringPointer offsets in the
// module table are relative to that base.
//
// Offsets (repr(C), little-endian):
//   byte_count: u64, modules_ptr: (u32 off, u32 len), entry_point_id: u32,
//   compile_exec_argv_ptr: (u32, u32), flags: u32
// CompiledModuleGraphFile (52 bytes each):
//   name, contents, sourcemap, bytecode, module_info, bytecode_origin_path
//   as (u32 off, u32 len) pairs, then encoding/loader/module_format/side u8s.

export type GraphModuleFormat = "none" | "esm" | "cjs";

export interface GraphFile {
  /** path relative to the bunfs root, e.g. "_0.js" or "src/plugins/.../hooks-worker.js" */
  name: string;
  contents: Buffer;
  format: GraphModuleFormat;
  loader: number;
}

export interface ModuleGraph {
  files: GraphFile[];
  /** name (relative to root) of the entry module */
  entryName: string;
}

const MODULE_FORMATS: GraphModuleFormat[] = ["none", "esm", "cjs"];

const parseAt = (data: Buffer, trailerPos: number): ModuleGraph | null => {
  const offsetsPos = trailerPos - NATIVE_GRAPH_OFFSETS_SIZE;
  if (offsetsPos < 0) return null;

  const byteCount = Number(data.readBigUInt64LE(offsetsPos));
  if (!Number.isSafeInteger(byteCount) || byteCount <= 0) return null;
  const base = offsetsPos - byteCount;
  if (base < 0) return null;

  const modulesOffset = data.readUInt32LE(offsetsPos + 8);
  const modulesLength = data.readUInt32LE(offsetsPos + 12);
  const entryPointId = data.readUInt32LE(offsetsPos + 16);
  if (modulesLength === 0 || modulesLength % NATIVE_GRAPH_RECORD_SIZE !== 0) return null;
  if (base + modulesOffset + modulesLength > offsetsPos) return null;

  const count = modulesLength / NATIVE_GRAPH_RECORD_SIZE;
  if (entryPointId >= count) return null;

  const files: GraphFile[] = [];
  for (let i = 0; i < count; i++) {
    const record = base + modulesOffset + i * NATIVE_GRAPH_RECORD_SIZE;
    const nameOffset = data.readUInt32LE(record);
    const nameLength = data.readUInt32LE(record + 4);
    const contentsOffset = data.readUInt32LE(record + 8);
    const contentsLength = data.readUInt32LE(record + 12);
    const encoding = data.readUInt8(record + 48);
    const loader = data.readUInt8(record + 49);
    const format = MODULE_FORMATS[data.readUInt8(record + 50)] ?? "none";

    if (base + nameOffset + nameLength > offsetsPos) return null;
    if (base + contentsOffset + contentsLength > offsetsPos) return null;

    const fullName = data.toString("utf8", base + nameOffset, base + nameOffset + nameLength);
    if (!fullName.startsWith(NATIVE_BUNFS_ROOT_PREFIX)) return null;
    const name = fullName.slice(NATIVE_BUNFS_ROOT_PREFIX.length);
    if (name.length === 0 || name.includes("..") || name.startsWith("/")) return null;

    const raw = data.subarray(base + contentsOffset, base + contentsOffset + contentsLength);
    // encoding byte: 0 binary, 1 latin1, 2 utf16. bun's runtime decodes utf16
    // modules through this byte; node serves the materialized file's raw bytes,
    // so utf16 contents must land on disk as utf8 or every reader sees NULs.
    // latin1 module text is ASCII in practice and is written unchanged.
    const contents =
      encoding === 2 ? Buffer.from(Buffer.from(raw).toString("utf16le"), "utf8") : Buffer.from(raw);
    files.push({ name, contents, format, loader });
  }

  return { files, entryName: files[entryPointId]!.name };
};

/**
 * Parses the bun standalone module graph out of a compiled binary. Returns
 * null when the binary does not carry one (pre-2.1.242 single-bundle format).
 */
export const parseModuleGraph = (data: Buffer): ModuleGraph | null => {
  const trailer = Buffer.from(NATIVE_GRAPH_TRAILER, "utf8");
  // the magic can also appear inside embedded JS source; scan candidates from
  // the end and take the first that parses into a consistent module table
  let searchEnd = data.length;
  while (searchEnd > 0) {
    const pos = data.lastIndexOf(trailer, searchEnd - 1);
    if (pos === -1) return null;
    const graph = parseAt(data, pos);
    if (graph) return graph;
    searchEnd = pos;
  }
  return null;
};
