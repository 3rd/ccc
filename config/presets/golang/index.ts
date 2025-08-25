import { createPreset } from "@/config/helpers";

export default createPreset({
  name: "golang",
  matcher: ({ project }) => {
    if (project.hasFile("go.mod")) return true;
    if (project.hasFile("main.go")) return true;
    return false;
  },
});
