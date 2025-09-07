import pc from "picocolors";

interface TaskHandle {
  done: (note?: string) => void;
  fail: (error: unknown) => void;
  skip: (note?: string) => void;
}

interface TaskData {
  label: string;
  startedAt: bigint;
  endedAt?: bigint;
}

export interface StartupLoggerOptions {
  enabled?: boolean;
}

export class StartupLogger {
  private printedHeader = false;
  private readonly enabled: boolean;

  constructor(opts: StartupLoggerOptions = {}) {
    const tty = typeof process !== "undefined" && Boolean(process.stdout) && process.stdout.isTTY;
    const debug = Boolean(process.env.DEBUG);
    this.enabled = Boolean(opts.enabled ?? (tty && !debug));
  }

  private static fmtDuration(startedAt: bigint, endedAt?: bigint): string {
    const end = endedAt ?? process.hrtime.bigint();
    const ms = Number(end - startedAt) / 1_000_000;
    if (ms < 900) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    return `${s.toFixed(s >= 10 ? 0 : 1)}s`;
  }

  private printHeader() {
    if (!this.enabled || this.printedHeader) return;
    process.stdout.write(`${pc.bold(pc.cyan("ccc"))} ${pc.dim("— starting up")}\n`);
    this.printedHeader = true;
  }

  start(label: string): TaskHandle {
    const task: TaskData = {
      label,
      startedAt: process.hrtime.bigint(),
    };

    return {
      done: (note?: string) => {
        task.endedAt = process.hrtime.bigint();
        this.printHeader();
        const detail = [
          task.label,
          note ? pc.dim(`(${note})`) : undefined,
          pc.dim(StartupLogger.fmtDuration(task.startedAt, task.endedAt)),
        ]
          .filter(Boolean)
          .join(" ");
        process.stdout.write(`${pc.green("✔")} ${detail}\n`);
      },

      skip: (note?: string) => {
        task.endedAt = process.hrtime.bigint();
        this.printHeader();
        const detail = [task.label, note ? pc.dim(`(${note})`) : undefined].filter(Boolean).join(" ");
        process.stdout.write(`${pc.dim("↷")} ${detail}\n`);
      },

      fail: (error: unknown) => {
        task.endedAt = process.hrtime.bigint();
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.printHeader();
        const detail = [task.label, errorMessage ? pc.dim(`- ${errorMessage}`) : undefined]
          .filter(Boolean)
          .join(" ");
        process.stdout.write(`${pc.red("✖")} ${detail}\n`);
      },
    };
  }

  async run<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
    const task = this.start(label);
    try {
      const result = await fn();
      task.done();
      return result;
    } catch (error) {
      task.fail(error);
      throw error;
    }
  }
}

export const createStartupLogger = (opts?: StartupLoggerOptions) => new StartupLogger(opts);
