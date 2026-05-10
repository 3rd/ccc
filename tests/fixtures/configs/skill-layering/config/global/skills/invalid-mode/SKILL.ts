import { createSkill } from "@/config/helpers";

export default createSkill({
  name: "invalid-mode",
  description: "Invalid mode skill",
  mode: "apend" as "append",
  content: "Invalid mode body",
});
