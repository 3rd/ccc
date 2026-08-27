import { describe, expect, test } from "bun:test";
import { NATIVE_GRAPH_OFFSETS_SIZE, NATIVE_GRAPH_RECORD_SIZE, NATIVE_GRAPH_TRAILER } from "@/native/constants";
import { parseModuleGraph } from "@/native/module-graph";

interface SyntheticFile {
  name: string;
  contents: string;
  format: number;
  loader: number;
}

// mirrors the documented layout in module-graph.ts:
// [junk][blob: strings + records][Offsets 32B][trailer]
const buildGraphBinary = (files: SyntheticFile[], entryPointId = 0, prefix = "EXECUTABLE-JUNK") => {
  const strings: Buffer[] = [];
  const spans: { nameOffset: number; nameLength: number; contentsOffset: number; contentsLength: number }[] = [];
  let cursor = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const contents = Buffer.from(file.contents, "utf8");
    spans.push({
      nameOffset: cursor,
      nameLength: name.length,
      contentsOffset: cursor + name.length,
      contentsLength: contents.length,
    });
    strings.push(name, contents);
    cursor += name.length + contents.length;
  }

  const records = Buffer.alloc(files.length * NATIVE_GRAPH_RECORD_SIZE);
  for (const [index, span] of spans.entries()) {
    const at = index * NATIVE_GRAPH_RECORD_SIZE;
    records.writeUInt32LE(span.nameOffset, at);
    records.writeUInt32LE(span.nameLength, at + 4);
    records.writeUInt32LE(span.contentsOffset, at + 8);
    records.writeUInt32LE(span.contentsLength, at + 12);
    records.writeUInt8(files[index]!.loader, at + 49);
    records.writeUInt8(files[index]!.format, at + 50);
  }

  const blob = Buffer.concat([...strings, records]);
  const offsets = Buffer.alloc(NATIVE_GRAPH_OFFSETS_SIZE);
  offsets.writeBigUInt64LE(BigInt(blob.length), 0);
  offsets.writeUInt32LE(cursor, 8);
  offsets.writeUInt32LE(records.length, 12);
  offsets.writeUInt32LE(entryPointId, 16);

  return Buffer.concat([Buffer.from(prefix, "utf8"), blob, offsets, Buffer.from(NATIVE_GRAPH_TRAILER, "utf8")]);
};

const ESM = 1;

describe("parseModuleGraph", () => {
  test("parses names, contents, formats, and the entry module", () => {
    const binary = buildGraphBinary(
      [
        { name: "/$bunfs/root/_0.js", contents: "export const a = 1;", format: ESM, loader: 5 },
        { name: "/$bunfs/root/cli", contents: "export const entry = true;", format: ESM, loader: 5 },
        { name: "/$bunfs/root/README.md", contents: "# doc", format: 0, loader: 9 },
      ],
      1,
    );

    const graph = parseModuleGraph(binary);
    expect(graph).not.toBeNull();
    expect(graph!.entryName).toBe("cli");
    expect(graph!.files.map((f) => f.name)).toEqual(["_0.js", "cli", "README.md"]);
    expect(graph!.files[0]).toMatchObject({ format: "esm", loader: 5 });
    expect(graph!.files[2]).toMatchObject({ format: "none", loader: 9 });
    expect(graph!.files[1]!.contents.toString("utf8")).toBe("export const entry = true;");
  });

  test("returns null for a binary without the graph trailer", () => {
    expect(parseModuleGraph(Buffer.from("plain old single-bundle binary"))).toBeNull();
  });

  test("skips trailer bytes that do not head a consistent module table", () => {
    const real = buildGraphBinary([
      { name: "/$bunfs/root/cli", contents: `decoy${NATIVE_GRAPH_TRAILER}decoy`, format: ESM, loader: 5 },
    ]);
    // trailing signature bytes after the real structure: the last trailer match
    // fails to parse, and the scan must fall back to the real one
    const withTrailingJunk = Buffer.concat([real, Buffer.from(`signature${NATIVE_GRAPH_TRAILER}`, "utf8")]);

    expect(parseModuleGraph(real)?.entryName).toBe("cli");
    expect(parseModuleGraph(withTrailingJunk)?.entryName).toBe("cli");
    expect(parseModuleGraph(withTrailingJunk)?.files[0]!.contents.toString("utf8")).toBe(
      `decoy${NATIVE_GRAPH_TRAILER}decoy`,
    );
  });

  test("rejects module names that escape the bunfs root", () => {
    const traversal = buildGraphBinary([
      { name: "/$bunfs/root/../evil.js", contents: "boom", format: ESM, loader: 5 },
    ]);
    const foreign = buildGraphBinary([{ name: "/etc/passwd", contents: "boom", format: ESM, loader: 5 }]);

    expect(parseModuleGraph(traversal)).toBeNull();
    expect(parseModuleGraph(foreign)).toBeNull();
  });
});
