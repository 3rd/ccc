import { createConfigSettings } from "@/config/helpers";

export default createConfigSettings({
  env: {
    TEST_GLOBAL: "true",
    FEATURE_FLAG: "enabled",
  },
});
