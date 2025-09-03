#!/usr/bin/env bun
import { existsSync } from "fs";
import { join } from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import type { StatusLineInput } from "@/types/statusline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const readStdin = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
};

(async () => {
  const input = await readStdin();
  const data: StatusLineInput = JSON.parse(input);

  const launcherRoot = join(__dirname, "../..");

  // check for dev-config first, fall back to config
  const configDir = existsSync(join(launcherRoot, "dev-config")) ? "dev-config" : "config";
  const statuslineConfigPath = join(launcherRoot, configDir, "global/statusline.ts");

  if (existsSync(statuslineConfigPath)) {
    const module = await import(statuslineConfigPath);
    const statuslineFunction = module.default;
    if (typeof statuslineFunction === "function") {
      await statuslineFunction(data);
    } else {
      console.log(`${configDir}/global/statusline.ts must export default createStatusline(..)`);
    }
  } else {
    console.log(`${configDir}/global/statusline.ts not found`);
  }
})();
