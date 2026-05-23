import { createWorkflow } from "@/config/helpers";

export default createWorkflow({
  name: "raw-hello",
  description: "JS workflow fixture for layering test",
  handler: async ({ agent, log }) => {
    const greeting = await agent("Say hello");
    log(greeting);
    return greeting;
  },
});
