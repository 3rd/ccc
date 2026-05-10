import { createSkill } from "@/config/helpers";

export default createSkill({
  name: "layered-skill",
  description: "Preset layered skill",
  mode: "append",
  content: "Preset layered body",
  files: [
    {
      relativePath: "shared.md",
      content: "preset sidecar\n",
    },
    {
      relativePath: "preset-only.md",
      content: "preset-only sidecar\n",
    },
  ],
});
