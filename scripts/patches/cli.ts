import type { Patch } from ".";

// disable crap
const skillPatches: Patch[] = [
  { search: "pr-comments", replace: "zprcomments" },
  { search: "security-review", replace: "zsecurityreview" },
];

// fix lsp support in v2.0.74+ (https://github.com/anthropics/claude-code/issues/14803)
const lspValidationPatches: Patch[] = [
  {
    pattern:
      /if\([\w$]+\.restartOnCrash!==void 0\)throw Error\(`LSP server '\${[\w$]+}': restartOnCrash is not yet implemented\. Remove this field from the configuration\.`\);/g,
    replace: "",
  },
  {
    pattern:
      /if\([\w$]+\.startupTimeout!==void 0\)throw Error\(`LSP server '\${[\w$]+}': startupTimeout is not yet implemented\. Remove this field from the configuration\.`\);/g,
    replace: "",
  },
  {
    pattern:
      /if\([\w$]+\.shutdownTimeout!==void 0\)throw Error\(`LSP server '\${[\w$]+}': shutdownTimeout is not yet implemented\. Remove this field from the configuration\.`\);/g,
    replace: "",
  },
];

// based on https://github.com/Piebald-AI/tweakcc/blob/main/src/patches/fixLspSupport.ts
const escapeIdent = (ident: string): string => ident.replace(/\$/g, "\\$");

const LANGUAGE_MAP_CODE = `
  const path = await import('path');
  const ext = path.extname(DOC_PATH_VAR).toLowerCase();
  const langMap = {
    '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact',
    '.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript',
    '.py': 'python', '.pyi': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.kt': 'kotlin', '.scala': 'scala', '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.h': 'c',
    '.hpp': 'cpp', '.cs': 'csharp', '.html': 'html', '.css': 'css', '.scss': 'scss',
    '.less': 'less', '.php': 'php', '.rb': 'ruby', '.sh': 'shellscript', '.bash': 'shellscript',
    '.swift': 'swift', '.lua': 'lua', '.pl': 'perl', '.r': 'r', '.R': 'r',
    '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.hs': 'haskell',
    '.ml': 'ocaml', '.clj': 'clojure', '.json': 'json', '.xml': 'xml',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.md': 'markdown',
    '.sql': 'sql', '.graphql': 'graphql', '.dart': 'dart', '.jl': 'julia',
    '.zig': 'zig', '.nim': 'nim', '.vue': 'vue', '.svelte': 'svelte'
  };
  const languageId = langMap[ext] || 'plaintext';
  try {
    const fs = await import('fs/promises');
    const text = await fs.readFile(DOC_PATH_VAR, 'utf8');
    await SERVER_VAR.sendNotification('textDocument/didOpen', {
      textDocument: { uri: "file://" + DOC_PATH_VAR, languageId, version: 1, text }
    });
  } catch (e) {}
`;

const applyLspDidOpenPatch = (content: string): string => {
  // 1. find ensureServerStarted
  const ensureMatch = /ensureServerStarted:([\w$]+)\b/.exec(content);
  if (!ensureMatch || ensureMatch.index === undefined) return content;

  // 2. find sendRequest in window around match
  const windowStart = Math.max(0, ensureMatch.index - 50);
  const windowEnd = Math.min(content.length, ensureMatch.index + 50);
  const window = content.slice(windowStart, windowEnd);

  const sendRequestMatch = /sendRequest:([\w$]+)[,}]/.exec(window);
  if (!sendRequestMatch?.[1]) return content;
  const varName = sendRequestMatch[1];

  // 3. find async function definition
  const searchStart = Math.max(0, ensureMatch.index - 2000);
  const searchChunk = content.slice(searchStart, ensureMatch.index);
  const functionPattern = new RegExp(`async function ${escapeIdent(varName)}\\(([$\\w]+),`, "g");

  let lastMatch = null;
  let match;
  while ((match = functionPattern.exec(searchChunk)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch?.[1]) return content;
  const docPathVar = lastMatch[1];

  // 4. find server variable
  const functionStart = searchStart + lastMatch.index;
  const functionBody = content.slice(functionStart, ensureMatch.index);
  const serverMatch = /let ([\w$]+)=await [\w$]+\([\w$]+\);/.exec(functionBody);
  if (!serverMatch?.[1]) return content;
  const serverVar = serverMatch[1];

  // 5. find injection point after if(!serverVar)return;
  const afterServer = functionStart + (serverMatch.index ?? 0) + serverMatch[0].length;
  const remaining = content.slice(afterServer, ensureMatch.index);
  const ifReturnMatch = new RegExp(`if\\(!${escapeIdent(serverVar)}\\)return;`).exec(remaining);
  if (!ifReturnMatch || ifReturnMatch.index === undefined) return content;

  // inject the code
  const insertPoint = afterServer + ifReturnMatch.index + ifReturnMatch[0].length;
  const injection = LANGUAGE_MAP_CODE.replace(/DOC_PATH_VAR/g, docPathVar).replace(/SERVER_VAR/g, serverVar);
  return content.slice(0, insertPoint) + injection + content.slice(insertPoint);
};

const lspDidOpenPatch: Patch = { apply: applyLspDidOpenPatch };

// fix lsp race condition: i52() (initializeLspServerManager) must run AFTER zQ2() (plugin init)
// see: https://github.com/anthropics/claude-code/issues/14803
const applyLspRaceConditionPatch = (content: string): string => {
  // 1. find the i52() call that appears after Ho() (plugin dir setup)
  const earlyInitPattern = /Ho\(\);i52\(\);/g;
  const hasEarlyInit = earlyInitPattern.test(content);
  if (!hasEarlyInit) return content;

  // 2. remove i52() from its early position
  let result = content.replace(/Ho\(\);i52\(\);/g, "Ho();");

  // 3. add i52() after zQ2() (plugin initialization)
  result = result.replace(
    /await zQ2\(\),x9\("action_after_plugins_init"\)/g,
    'await zQ2(),i52(),x9("action_after_plugins_init")',
  );

  return result;
};

const lspRaceConditionPatch: Patch = { apply: applyLspRaceConditionPatch };

// fix lsp server registration
const applyLspServerRegistrationPatch = (content: string): string => {
  // 1. find the manager return
  const managerReturnPattern =
    /return{initialize:([\w$]+),shutdown:([\w$]+),getServerForFile:([\w$]+),ensureServerStarted:([\w$]+),sendRequest:([\w$]+),getAllServers:([\w$]+),/;
  const returnMatch = managerReturnPattern.exec(content);
  if (!returnMatch || returnMatch.index === undefined) return content;

  const initVar = returnMatch[1];
  if (!initVar) return content;

  // 2. find the empty initialize function
  const searchStart = Math.max(0, returnMatch.index - 10_000);
  const searchChunk = content.slice(searchStart, returnMatch.index);

  const emptyInitPattern = new RegExp(`async function ${escapeIdent(initVar)}\\(\\)\\{return\\}`);
  const initMatch = searchChunk.match(emptyInitPattern);
  if (!initMatch || initMatch.index === undefined) return content;

  // 3. find the map variables by looking for: let A=new Map,Q=new Map,B=new Map
  const mapsPattern = /let ([\w$]+)=new Map,([\w$]+)=new Map,([\w$]+)=new Map/;
  const mapsMatch = mapsPattern.exec(searchChunk);
  if (!mapsMatch?.[1] || !mapsMatch[2]) return content;

  const serversMap = mapsMatch[1]; // A - servers map
  const extensionMap = mapsMatch[2]; // Q - extension to server names map

  // 4. find v52 (loadLspServersFromPlugins)
  const loadServersPattern =
    /async function ([\w$]+)\(\){let [\w$]+={};try{let{enabled:([\w$]+)}=await ([\w$]+)\(\)/;
  const loadMatch = loadServersPattern.exec(content);
  const loadServersFunc = loadMatch?.[1] || "v52"; // fallback to v52

  // 5. find T52 (createLspServer)
  const createServerPattern =
    /function ([\w$]+)\(([\w$]+),([\w$]+)\){let [\w$]+=([\w$]+)\(\2\),[\w$]+="stopped"/;
  const createMatch = createServerPattern.exec(content);
  const createServerFunc = createMatch?.[1] || "T52"; // fallback

  // 6. inject the init code
  const initCode = `async function ${initVar}(){try{const cfg=await ${loadServersFunc}();for(const[n,c]of Object.entries(cfg.servers||{})){const s=${createServerFunc}(n,c);${serversMap}.set(n,s);for(const ext of Object.keys(c.extensionToLanguage||{})){if(!${extensionMap}.has(ext))${extensionMap}.set(ext,[]);${extensionMap}.get(ext).push(n)}}}catch(e){}}`;

  const absoluteInitIndex = searchStart + initMatch.index;
  const initEnd = absoluteInitIndex + initMatch[0].length;

  return content.slice(0, absoluteInitIndex) + initCode + content.slice(initEnd);
};

const lspServerRegistrationPatch: Patch = { apply: applyLspServerRegistrationPatch };

export const cliPatches: Patch[] = [
  ...skillPatches,
  ...lspValidationPatches,
  lspDidOpenPatch,
  lspRaceConditionPatch,
  lspServerRegistrationPatch,
];
