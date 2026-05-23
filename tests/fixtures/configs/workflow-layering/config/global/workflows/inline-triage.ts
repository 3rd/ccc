import { createWorkflow } from "@/config/helpers";

export default createWorkflow({
  name: "inline-triage",
  description: "Inline-form fixture for layering test",
  handler: async ({ agent, phase }) => {
    phase("scan");
    await agent("hello");
  },
});
