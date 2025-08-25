import { createPreset } from "@/config/helpers";

export default createPreset({
  name: "typescript",
  matcher: ({ project }) => {
    if (project.hasFile("tsconfig.json")) return true;
    if (project.hasFile("node_modules/typescript/package.json")) return true;
    return false;
  },
});
