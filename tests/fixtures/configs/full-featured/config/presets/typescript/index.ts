import { createPreset } from "@/config/helpers";

export default createPreset({
  name: "typescript",
  matcher: (context) => context.project.hasFile("tsconfig.json"),
});
