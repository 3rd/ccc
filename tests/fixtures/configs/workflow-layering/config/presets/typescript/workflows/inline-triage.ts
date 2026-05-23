import { createWorkflow } from "@/config/helpers";

export default createWorkflow({
  name: "inline-triage",
  description: "Preset-overridden inline triage",
  handler: async ({ agent, phase }) => {
    phase("scan");
    await agent("from-preset");
  },
});
