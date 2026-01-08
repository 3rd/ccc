import pc from "picocolors";

export type ConfigLayer = "global" | "preset" | "project";

export interface ConfigErrorOptions {
  layer: ConfigLayer;
  layerName?: string;
  filePath: string;
  cause?: Error;
}

export class ConfigError extends Error {
  readonly layer: ConfigLayer;
  readonly layerName?: string;
  readonly filePath: string;
  override readonly cause?: Error;

  constructor(message: string, options: ConfigErrorOptions) {
    super(message);
    this.name = "ConfigError";
    this.layer = options.layer;
    this.layerName = options.layerName;
    this.filePath = options.filePath;
    this.cause = options.cause;
  }

  get location(): string {
    const layerStr = this.layerName ? `${this.layer}:${this.layerName}` : this.layer;
    return `[${layerStr}] ${this.filePath}`;
  }

  toFormattedString(): string {
    const lines = [pc.red(`Config Error: ${this.message}`), pc.dim(`  Location: ${this.location}`)];

    if (this.cause) {
      const causeMsg = this.cause.message || String(this.cause);
      lines.push(pc.dim(`  Cause: ${causeMsg}`));

      // include trace
      if (this.cause.stack) {
        const stackLines = this.cause.stack.split("\n").slice(1, 4);
        for (const line of stackLines) {
          lines.push(pc.dim(`    ${line.trim()}`));
        }
      }
    }

    return lines.join("\n");
  }
}

export const formatConfigError = (
  error: unknown,
  layer: ConfigLayer,
  layerName: string | undefined,
  filePath: string,
): string => {
  const layerStr = layerName ? `${layer}:${layerName}` : layer;
  const errorMsg = error instanceof Error ? error.message : String(error);
  return `[${layerStr}] ${filePath}: ${errorMsg}`;
};

export const wrapConfigError = (
  error: unknown,
  message: string,
  options: Omit<ConfigErrorOptions, "cause">,
): ConfigError => {
  const cause = error instanceof Error ? error : new Error(String(error));
  return new ConfigError(message, { ...options, cause });
};
