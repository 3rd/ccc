// import { $ } from "bun";
import { createStatusline } from "@/config/helpers";

export default createStatusline(async (data) => {
  const components: string[] = [];

  const modelIcon = data.model?.id?.includes("opus") ? "🔋" : "🪫";
  if (data.model) {
    components.push(`${modelIcon} ${data.model.display_name}`);
  }

  if (data.hook_event_name) {
    components.push(`⚡ ${data.hook_event_name}`);
  }

  console.log(components.join(" │ "));
  process.exit(0);
});
