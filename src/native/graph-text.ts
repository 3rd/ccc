import * as fs from "fs";
import * as path from "path";
import { readGraphManifest } from "./cache";

// Runtime patches are written against one continuous bundle text. The module
// graph splits that text across ~1400 files, so patches whose anchors sit in
// two modules would never match if each file were patched alone. The modules
// are joined behind these markers instead, patched as one text, then split
// back on the same markers. The marker carries the module's own import
// specifier so a patch can resolve a reference across modules; nothing else
// in a module's text names the module.
const boundaryFor = (index: number, specifier: string) =>
  `\n/*__ccc_module_boundary_${index}:${specifier}*/\n`;

const BOUNDARY_PREFIX = "/*__ccc_module_boundary_";
const BOUNDARY_RE = /\/\*__ccc_module_boundary_(\d+):([^*]+)\*\//g;

export interface GraphText {
  graphDir: string;
  /** graph-relative module paths, in the order their sources were joined */
  modules: string[];
  combined: string;
  /** the unpatched source of each module, index-aligned with `modules` */
  originals: string[];
}

export const readGraphText = (graphDir: string): GraphText => {
  const manifest = readGraphManifest(graphDir);
  if (!manifest) throw new Error(`graph-text: no graph manifest under ${graphDir}`);

  const originals = manifest.modules.map((rel) => fs.readFileSync(path.join(graphDir, rel), "utf8"));
  const combined = manifest.modules
    .map((rel, index) => originals[index]! + boundaryFor(index, path.join(graphDir, rel)))
    .join("");
  return { graphDir, modules: manifest.modules, combined, originals };
};

/**
 * Splits patched combined text back into per-module sources. Throws when a
 * replacement consumed a boundary marker, since that would silently merge two
 * modules into one file.
 */
export const splitGraphText = (graph: GraphText, patched: string): string[] => {
  const parts: string[] = [];
  let cursor = 0;
  for (const [index, rel] of graph.modules.entries()) {
    const boundary = boundaryFor(index, path.join(graph.graphDir, rel));
    const at = patched.indexOf(boundary, cursor);
    if (at === -1) {
      throw new Error(
        "graph-text: a runtime patch replaced text across a module boundary; " +
          "narrow the patch so its replacement stays inside one module",
      );
    }
    parts.push(patched.slice(cursor, at));
    cursor = at + boundary.length;
  }
  return parts;
};

// ---------------------------------------------------------------------------
// cross-module binding
//
// A patch that matches a helper in one module and injects a call to it in
// another used to work by accident: the single bundle put both in one scope.
// In the graph they are separate ESM modules and minified names collide
// freely (`v` in the module defining the rename helper is a different `v` in
// the module that ends a turn), so an injected bare identifier would silently
// call the wrong function. `linkGraphBindings` turns such references into
// export/import pairs and returns the names to use at the injection site.
// ---------------------------------------------------------------------------

interface ModuleRegion {
  start: number;
  end: number;
  specifier: string;
}

const moduleRegionAt = (combined: string, index: number): ModuleRegion | null => {
  BOUNDARY_RE.lastIndex = 0;
  let start = 0;
  for (let match = BOUNDARY_RE.exec(combined); match !== null; match = BOUNDARY_RE.exec(combined)) {
    if (index < match.index) return { start, end: match.index, specifier: match[2]! };
    start = match.index + match[0].length;
  }
  return null;
};

export interface GraphBindingRequest {
  /** offset of the definition the patch matched */
  definitionIndex: number;
  /** the name the defining module binds it to */
  localName: string;
  /** offset where the patch will inject a reference */
  injectionIndex: number;
}

export interface GraphBindingResult {
  combined: string;
  /** name to reference at the injection site, index-aligned with the requests */
  locals: string[];
}

/**
 * Returns the input unchanged, with the original local names, when the text is
 * a single bundle rather than joined graph modules (every name is already in
 * scope there), and when a definition is already in the module that will
 * reference it.
 */
export const linkGraphBindings = (
  combined: string,
  requests: readonly GraphBindingRequest[],
): GraphBindingResult => {
  if (!combined.includes(BOUNDARY_PREFIX)) {
    return { combined, locals: requests.map((request) => request.localName) };
  }

  const edits: { at: number; text: string }[] = [];
  const locals: string[] = [];

  for (const [order, request] of requests.entries()) {
    const definition = moduleRegionAt(combined, request.definitionIndex);
    const injection = moduleRegionAt(combined, request.injectionIndex);
    if (!definition || !injection || definition.start === injection.start) {
      locals.push(request.localName);
      continue;
    }

    const definitionText = combined.slice(definition.start, definition.end);
    const exportList = /export\{[^}]*\}/.exec(definitionText)?.[0] ?? "";
    const exported = new RegExp(`\\b${request.localName} as ([\\w$]+)[,}]`).exec(exportList)?.[1];

    const alias = exported ?? `__ccc_x${order}_${request.localName}`;
    if (!exported) {
      edits.push({ at: definition.end, text: `\nexport{${request.localName} as ${alias}};\n` });
    }

    const local = `__ccc_i${order}_${request.localName}`;
    locals.push(local);
    // alongside the module's own imports, after its header comment block
    const headerEnd = combined.indexOf("\nimport", injection.start);
    const at = headerEnd === -1 || headerEnd >= injection.end ? injection.start : headerEnd;
    edits.push({ at, text: `\nimport{${alias} as ${local}}from"${definition.specifier}";` });
  }

  // applied back to front so each pending offset stays valid
  edits.sort((left, right) => right.at - left.at);
  let result = combined;
  for (const edit of edits) result = result.slice(0, edit.at) + edit.text + result.slice(edit.at);

  return { combined: result, locals };
};
