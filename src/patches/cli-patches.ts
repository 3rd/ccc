// runtime patches for claude cli

export interface RuntimePatch {
  find: string;
  replace: string;
}

// built-in string replacements
const builtInStringPatches: RuntimePatch[] = [
  // disable unwanted features
  { find: "pr-comments", replace: "zprcomments" },
  { find: "security-review", replace: "zsecurityreview" },
];

// apply all built-in patches to CLI content
export const applyBuiltInPatches = (content: string): { content: string; applied: string[] } => {
  const applied: string[] = [];
  let result = content;

  // apply string replacements
  for (const patch of builtInStringPatches) {
    const before = result;
    result = result.replaceAll(patch.find, patch.replace);
    if (result !== before) {
      applied.push(`"${patch.find}" => "${patch.replace}"`);
    }
  }

  return { content: result, applied };
};

// apply user-defined patches
export const applyUserPatches = (
  content: string,
  patches: RuntimePatch[],
): { content: string; applied: string[] } => {
  const applied: string[] = [];
  let result = content;

  for (const patch of patches) {
    const before = result;
    result = result.replaceAll(patch.find, patch.replace);
    if (result !== before) {
      applied.push(`"${patch.find}" => "${patch.replace}"`);
    }
  }

  return { content: result, applied };
};
