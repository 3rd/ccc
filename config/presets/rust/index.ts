import { createPreset } from "@/config/helpers";

export default createPreset({
  name: "rust",
  matcher: ({ project }) => {
    if (project.hasFile("Cargo.toml")) return true;
    return false;
  },
});
