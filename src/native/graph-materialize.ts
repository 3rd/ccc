import type { GraphManifest, MaterializedGraphFile } from "./cache";
import { NATIVE_BUNFS_ROOT_PREFIX } from "./constants";
import type { ModuleGraph } from "./module-graph";
import {
  GRAPH_NODE_FETCH_SHIM_NAME,
  GRAPH_PREAMBLE_MODULE_NAME,
  GRAPH_WS_SHIM_NAME,
  buildGraphNodeFetchShimModule,
  buildGraphPreambleModule,
  buildGraphWsShimModule,
  rewriteGraphModuleForNode,
} from "./preamble";

export interface MaterializedGraph {
  files: MaterializedGraphFile[];
  manifest: GraphManifest;
}

/**
 * Turns a parsed module graph into the on-disk file set: every ESM module gets
 * the node compatibility rewrites, assets are kept verbatim, and the ccc shim
 * modules are added under root/. Bunfs prefixes stay in place here; the cache
 * writer substitutes them for the final absolute graph path.
 */
// bun assigns one loader per embedded file. Rather than pinning the numeric id
// (it belongs to bun's Loader enum and can shift between bun releases), the text
// loader is identified from a file the graph itself must load as text: an
// embedded `.md`. Every file sharing that loader is then text too, including
// extensions a future release adds.
const findTextFileNames = (graph: ModuleGraph): string[] => {
  const markdown = graph.files.find((file) => file.format !== "esm" && file.name.endsWith(".md"));
  if (!markdown) return [];
  return graph.files
    .filter((file) => file.format !== "esm" && file.loader === markdown.loader)
    .map((file) => file.name);
};

export const materializeGraph = (graph: ModuleGraph): MaterializedGraph => {
  const files: MaterializedGraphFile[] = [];
  const modules: string[] = [];
  let entry: string | null = null;

  for (const file of graph.files) {
    const isEntry = file.name === graph.entryName;
    // the entry ("cli") ships without an extension; .mjs pins ESM for import()
    const diskName = isEntry && !/\.(?:js|mjs)$/.test(file.name) ? `${file.name}.mjs` : file.name;
    const relPath = `root/${diskName}`;

    if (file.format === "esm") {
      files.push({
        relPath,
        contents: rewriteGraphModuleForNode(file.contents.toString("utf8"), `${NATIVE_BUNFS_ROOT_PREFIX}${diskName}`),
        substitutePrefix: true,
      });
      modules.push(relPath);
    } else {
      files.push({ relPath, contents: file.contents, substitutePrefix: false });
    }
    if (isEntry) entry = relPath;
  }

  if (entry === null) {
    throw new Error(`graph-materialize: entry module '${graph.entryName}' missing from graph`);
  }

  const wsShimRelPath = `root/${GRAPH_WS_SHIM_NAME}`;
  const nodeFetchShimRelPath = `root/${GRAPH_NODE_FETCH_SHIM_NAME}`;
  const preambleRelPath = `root/${GRAPH_PREAMBLE_MODULE_NAME}`;
  const textFileNames = findTextFileNames(graph).map((name) => `${NATIVE_BUNFS_ROOT_PREFIX}${name}`);
  files.push(
    // the text-file paths carry the bunfs prefix, so they are substituted like modules
    { relPath: preambleRelPath, contents: buildGraphPreambleModule(textFileNames), substitutePrefix: true },
    { relPath: wsShimRelPath, contents: buildGraphWsShimModule(), substitutePrefix: true },
    { relPath: nodeFetchShimRelPath, contents: buildGraphNodeFetchShimModule(), substitutePrefix: true },
    { relPath: "root/package.json", contents: '{"type":"module"}\n', substitutePrefix: false },
  );

  return {
    files,
    manifest: {
      version: 1,
      entry,
      // `modules` leads with the preamble: it carries the Bun shims every module
      // imports, and patches that install into that shim scope (network
      // interception) anchor on its text, so it has to be patchable too
      modules: [preambleRelPath, ...modules],
      substituted: [preambleRelPath, ...modules, wsShimRelPath, nodeFetchShimRelPath],
    },
  };
};
