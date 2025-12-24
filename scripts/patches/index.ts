export interface StringPatch {
  search: string;
  replace: string;
}

export interface RegexPatch {
  pattern: RegExp;
  replace: string;
}

export interface FunctionPatch {
  apply: (content: string) => string;
}

export type Patch = StringPatch | RegexPatch | FunctionPatch;

export interface FilePatch {
  file: string;
  patches: Patch[];
  description?: string;
}

export const isRegexPatch = (patch: Patch): patch is RegexPatch => "pattern" in patch;
export const isFunctionPatch = (patch: Patch): patch is FunctionPatch => "apply" in patch;

export { cliPatches } from "./cli";
