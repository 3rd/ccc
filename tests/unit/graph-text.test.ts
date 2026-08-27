import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { linkGraphBindings, readGraphText, splitGraphText } from "@/native/graph-text";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const MODULE_A = ["// @bun @bytecode", "function helper(x){return x+1}", "export{helper as Hx};", ""].join("\n");
const MODULE_B = ["// @bun @bytecode", 'import{Hx as z}from"other";', "function endTurn(){return z(1)}", ""].join("\n");

const writeGraph = (modules: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-graph-text-"));
  tempDirs.push(dir);
  const rels = Object.keys(modules);
  for (const rel of rels) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, modules[rel]!);
  }
  fs.writeFileSync(
    path.join(dir, "__ccc_manifest.json"),
    JSON.stringify({ version: 1, entry: rels[0], modules: rels, substituted: rels }),
  );
  return dir;
};

describe("readGraphText / splitGraphText", () => {
  test("joins modules in manifest order and splits an unpatched text back to the originals", () => {
    const dir = writeGraph({ "root/a.js": MODULE_A, "root/b.js": MODULE_B });
    const graph = readGraphText(dir);

    expect(graph.modules).toEqual(["root/a.js", "root/b.js"]);
    expect(graph.originals).toEqual([MODULE_A, MODULE_B]);
    expect(graph.combined.indexOf(MODULE_A)).toBeLessThan(graph.combined.indexOf(MODULE_B));

    expect(splitGraphText(graph, graph.combined)).toEqual([MODULE_A, MODULE_B]);
  });

  test("a patch inside one module changes only that module's split output", () => {
    const dir = writeGraph({ "root/a.js": MODULE_A, "root/b.js": MODULE_B });
    const graph = readGraphText(dir);

    const patched = graph.combined.replace("return x+1", "return x+2");
    const parts = splitGraphText(graph, patched);

    expect(parts[0]).toBe(MODULE_A.replace("return x+1", "return x+2"));
    expect(parts[1]).toBe(MODULE_B);
  });

  test("throws when a replacement consumed a module boundary", () => {
    const dir = writeGraph({ "root/a.js": MODULE_A, "root/b.js": MODULE_B });
    const graph = readGraphText(dir);

    const boundaryStart = graph.combined.indexOf("/*__ccc_module_boundary_0");
    const mangled = graph.combined.slice(0, boundaryStart) + graph.combined.slice(boundaryStart + 10);

    expect(() => splitGraphText(graph, mangled)).toThrow(/module boundary/);
  });
});

describe("linkGraphBindings", () => {
  test("returns single-bundle text unchanged with the original local names", () => {
    const source = "function helper(){}\nhelper();";
    const linked = linkGraphBindings(source, [
      { definitionIndex: 0, localName: "helper", injectionIndex: source.length - 1 },
    ]);
    expect(linked.combined).toBe(source);
    expect(linked.locals).toEqual(["helper"]);
  });

  test("keeps the local name when definition and injection share a module", () => {
    const dir = writeGraph({ "root/a.js": MODULE_A, "root/b.js": MODULE_B });
    const graph = readGraphText(dir);
    const definitionIndex = graph.combined.indexOf("function helper");

    const linked = linkGraphBindings(graph.combined, [
      { definitionIndex, localName: "helper", injectionIndex: definitionIndex + 5 },
    ]);

    expect(linked.combined).toBe(graph.combined);
    expect(linked.locals).toEqual(["helper"]);
  });

  test("bridges a cross-module reference through the existing export alias", () => {
    const dir = writeGraph({ "root/a.js": MODULE_A, "root/b.js": MODULE_B });
    const graph = readGraphText(dir);
    const definitionIndex = graph.combined.indexOf("function helper");
    const injectionIndex = graph.combined.indexOf("function endTurn");

    const linked = linkGraphBindings(graph.combined, [
      { definitionIndex, localName: "helper", injectionIndex },
    ]);
    const parts = splitGraphText(graph, linked.combined);

    expect(linked.locals).toEqual(["__ccc_i0_helper"]);
    // MODULE_A already exports helper as Hx, so no new export is added
    expect(parts[0]).toBe(MODULE_A);
    expect(parts[1]).toContain(`import{Hx as __ccc_i0_helper}from"${path.join(dir, "root/a.js")}";`);
  });

  test("adds an export when the defining module does not export the helper", () => {
    const moduleA = ["// @bun @bytecode", "function helper(x){return x+1}", ""].join("\n");
    const dir = writeGraph({ "root/a.js": moduleA, "root/b.js": MODULE_B });
    const graph = readGraphText(dir);
    const definitionIndex = graph.combined.indexOf("function helper");
    const injectionIndex = graph.combined.indexOf("function endTurn");

    const linked = linkGraphBindings(graph.combined, [
      { definitionIndex, localName: "helper", injectionIndex },
    ]);
    const parts = splitGraphText(graph, linked.combined);

    expect(linked.locals).toEqual(["__ccc_i0_helper"]);
    expect(parts[0]).toContain("export{helper as __ccc_x0_helper};");
    expect(parts[1]).toContain(`import{__ccc_x0_helper as __ccc_i0_helper}from"${path.join(dir, "root/a.js")}";`);
  });
});
