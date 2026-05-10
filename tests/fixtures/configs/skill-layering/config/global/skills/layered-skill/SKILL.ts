import { createSkill } from "@/config/helpers";

export default createSkill({
  name: "layered-skill",
  description: "Base layered skill",
  content: "Base layered body",
  files: [
    {
      relativePath: "shared.md",
      content: "global sidecar\n",
    },
  ],
});
