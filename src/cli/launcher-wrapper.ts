#!/usr/bin/env bun
import { spawn } from "child_process";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const launcherPath = join(projectRoot, "src", "cli", "launcher.ts");
const tsconfigPath = join(projectRoot, "tsconfig.json");

const child = spawn("tsx", [launcherPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    TSX_TSCONFIG_PATH: tsconfigPath,
  },
  cwd: process.cwd(),
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

child.on("error", (err) => {
  console.error("Failed to start CCC:", err);
  process.exit(1);
});
