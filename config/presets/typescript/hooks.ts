// import { $ } from "zx";
// import { createHook } from "@/hooks/hook-generator";
import { createConfigHooks } from "@/config/helpers";

export default createConfigHooks({
  Stop: [
    {
      hooks: [
        // createHook("Stop", async () => {
        //   const result = await $`tsc --noEmit`;
        //   if (result.exitCode !== 0) {
        //     return {
        //       continue: true,
        //       decision: "block",
        //       reason: `Failed tsc --noEmit:\n${result.text()}`,
        //     };
        //   }
        //   return {
        //     suppressOutput: true,
        //   };
        // }),
      ],
    },
  ],
});
