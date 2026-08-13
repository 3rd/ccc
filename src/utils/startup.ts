import { performance } from "node:perf_hooks";
import pc from "picocolors";

const STARTUP_T0_ENV = "AGENTS_STARTUP_T0_MS";

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

export interface TimingEntry {
  phase: string;
  durationMs: number;
  status: "done" | "failed" | "skipped";
  note?: string;
}

export interface TimingReport {
  totalMs: number;
  phases: TimingEntry[];
}

export interface StartupLoggerOptions {
  enabled?: boolean;
  write?: (line: string) => void;
}

export class StartupLogger {
  private printedHeader = false;
  private readonly enabled: boolean;
  private instanceId: string | undefined;
  private readonly startTime: bigint;
  private readonly startedAtEpochMs: number;
  private readonly timings: TimingEntry[] = [];
  private readonly write: (line: string) => void;

  constructor(opts: StartupLoggerOptions = {}) {
    const tty = typeof process !== "undefined" && Boolean(process.stdout) && process.stdout.isTTY;
    const debug = Boolean(process.env.DEBUG);
    this.enabled = Boolean(opts.enabled ?? (tty && !debug));
    this.startTime = process.hrtime.bigint();
    const inheritedStart = Number(process.env[STARTUP_T0_ENV]);
    // one-shot: claude runs in-process, so anything the session spawns would inherit the stamp
    // and anchor its own boot figure to this launch's start
    delete process.env[STARTUP_T0_ENV];
    this.startedAtEpochMs =
      Number.isFinite(inheritedStart) && inheritedStart > 0 ? inheritedStart : performance.timeOrigin;
    this.write = opts.write ?? ((line) => process.stdout.write(line));
  }

  private static fmtDuration(startedAt: bigint, endedAt?: bigint): string {
    const end = endedAt ?? process.hrtime.bigint();
    const ms = Number(end - startedAt) / 1_000_000;
    if (ms < 900) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    return `${s.toFixed(s >= 10 ? 0 : 1)}s`;
  }

  private static toMs(startedAt: bigint, endedAt: bigint): number {
    return Number(endedAt - startedAt) / 1_000_000;
  }

  private printHeader() {
    if (!this.enabled || this.printedHeader) return;
    const bootStartedAt = BigInt(Math.round(this.startedAtEpochMs * 1_000_000));
    const now = BigInt(Date.now()) * 1_000_000n;
    this.write(
      `${pc.bold(pc.cyan("ccc"))} ${pc.dim(`— starting up (boot ${StartupLogger.fmtDuration(bootStartedAt, now)})`)}\n`,
    );
    if (this.instanceId) this.write(`  ${pc.dim(`instance id: ${this.instanceId}`)}\n`);
    this.printedHeader = true;
  }

  setInstanceId(instanceId: string): void {
    this.instanceId = instanceId;
  }

  start(label: string): TaskHandle {
    this.printHeader();
    const task: TaskData = {
      label,
      startedAt: process.hrtime.bigint(),
    };
    return {
      done: (note?: string) => {
        task.endedAt = process.hrtime.bigint();
        this.timings.push({
          phase: task.label,
          durationMs: StartupLogger.toMs(task.startedAt, task.endedAt),
          status: "done",
          note,
        });
        if (!this.enabled) return;
        const detail = [
          task.label,
          note ? pc.dim(`(${note})`) : undefined,
          pc.dim(StartupLogger.fmtDuration(task.startedAt, task.endedAt)),
        ]
          .filter(Boolean)
          .join(" ");
        this.write(`${pc.green("✔")} ${detail}\n`);
      },

      skip: (note?: string) => {
        task.endedAt = process.hrtime.bigint();
        this.timings.push({
          phase: task.label,
          durationMs: StartupLogger.toMs(task.startedAt, task.endedAt),
          status: "skipped",
          note,
        });
        if (!this.enabled) return;
        const detail = [task.label, note ? pc.dim(`(${note})`) : undefined].filter(Boolean).join(" ");
        this.write(`${pc.dim("↷")} ${detail}\n`);
      },

      fail: (error: unknown) => {
        task.endedAt = process.hrtime.bigint();
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.timings.push({
          phase: task.label,
          durationMs: StartupLogger.toMs(task.startedAt, task.endedAt),
          status: "failed",
          note: errorMessage,
        });
        if (!this.enabled) return;
        const detail = [task.label, errorMessage ? pc.dim(`- ${errorMessage}`) : undefined]
          .filter(Boolean)
          .join(" ");
        this.write(`${pc.red("✖")} ${detail}\n`);
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

  getTiming(): TimingReport {
    const endTime = process.hrtime.bigint();
    return {
      totalMs: StartupLogger.toMs(this.startTime, endTime),
      phases: [...this.timings],
    };
  }

  printTiming(): void {
    const report = this.getTiming();
    console.log(pc.bold(pc.cyan("\nStartup Timing Report")));
    console.log(pc.dim("─".repeat(50)));

    const getStatusIcon = (status: string) => {
      if (status === "done") return pc.green("✔");
      if (status === "failed") return pc.red("✖");
      return pc.dim("↷");
    };

    for (const entry of report.phases) {
      const statusIcon = getStatusIcon(entry.status);
      const durationStr = pc.yellow(`${entry.durationMs.toFixed(1)}ms`.padStart(10));
      const noteStr = entry.note ? pc.dim(` (${entry.note})`) : "";
      console.log(`${statusIcon} ${durationStr}  ${entry.phase}${noteStr}`);
    }

    console.log(pc.dim("─".repeat(50)));
    const totalStr = pc.yellow(`${report.totalMs.toFixed(1)}ms`);
    console.log(`${pc.bold("Total:")} ${totalStr}`);
  }
}

export const createStartupLogger = (opts?: StartupLoggerOptions) => new StartupLogger(opts);
