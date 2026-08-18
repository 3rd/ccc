import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./runtime-host.ts", import.meta.url));
const launcherRoot = resolve(dirname(sourcePath), "..", "..");
const outputDirectory = join(launcherRoot, ".cache", "runtime-host");

export const buildRuntimeHost = async () => {
  const result = await Bun.build({
    entrypoints: [sourcePath],
    format: "esm",
    target: "node",
    sourcemap: "none",
  });
  const [output] = result.outputs;
  if (!result.success || !output || result.outputs.length !== 1) {
    const messages = result.logs.map((entry) => entry.message).join("\n");
    throw new Error(`Failed to build CCC runtime host${messages ? `:\n${messages}` : ""}`);
  }

  const source = await output.text();
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 32);
  const outputPath = join(outputDirectory, `runtime-host-${digest}.mjs`);
  if (existsSync(outputPath)) return outputPath;

  mkdirSync(outputDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, source, { flag: "wx" });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (!existsSync(outputPath)) throw error;
  }
  return outputPath;
};
