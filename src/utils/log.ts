/* eslint-disable @typescript-eslint/class-methods-use-this */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

export type LogLevel = "debug" | "error" | "info" | "warn";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUFFER_CONFIG = {
  MAX_SIZE: 100,
  FLUSH_INTERVAL_MS: 100,
} as const;

class Logger {
  private static instance: Logger;
  private logPath: string | null = null;
  private isEnabled = false;
  private sessionStartTime: string;
  private logBuffer: string[] = [];
  private asyncBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isWriting = false;
  private writeStream: fs.WriteStream | null = null;

  private constructor() {
    this.sessionStartTime = new Date().toISOString();
    this.isEnabled = Boolean(process.env.DEBUG);
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  init(projectPath: string, instanceId: string) {
    if (!this.isEnabled) return;

    // get log path
    const cacheDir = path.join(path.dirname(path.dirname(__dirname)), ".cache", instanceId);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    this.logPath = path.join(cacheDir, "log");

    // log header
    const header = [
      "=".repeat(70),
      `CCC Debug Log - Session Started: ${this.sessionStartTime}`,
      `Project: ${projectPath}`,
      `Instance ID: ${instanceId}`,
      `Cache Dir: ${cacheDir}`,
      `Node: ${process.version}`,
      `Platform: ${os.platform()} ${os.release()}`,
      "=".repeat(70),
      "",
    ].join("\n");

    // overwrite log file
    fs.writeFileSync(this.logPath, header);

    // create write stream for async writes
    this.writeStream = fs.createWriteStream(this.logPath, { flags: "a" });

    // start flush
    this.startFlushTimer();
    if (this.logBuffer.length > 0) {
      this.asyncBuffer.push(...this.logBuffer);
      this.logBuffer = [];
      this.flushAsync();
    }

    // flush on exit
    process.on("beforeExit", () => this.flushSync());
    process.on("exit", () => this.flushSync());
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.asyncBuffer.length > 0) {
        this.flushAsync();
      }
    }, BUFFER_CONFIG.FLUSH_INTERVAL_MS);
    // TBD: block/don't block exit
    this.flushTimer.unref();
  }

  private flushAsync(): void {
    if (!this.writeStream || this.isWriting || this.asyncBuffer.length === 0) return;

    this.isWriting = true;
    const data = this.asyncBuffer.join("");
    this.asyncBuffer = [];

    this.writeStream.write(data, () => {
      this.isWriting = false;
    });
  }

  private flushSync(): void {
    if (!this.logPath) return;

    if (this.asyncBuffer.length > 0) {
      fs.appendFileSync(this.logPath, this.asyncBuffer.join(""));
      this.asyncBuffer = [];
    }

    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private formatEntry(level: LogLevel, category: string, message: string, data?: unknown) {
    const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const levelStr = level.toUpperCase().padEnd(5);
    const categoryStr = `[${category}]`.padEnd(15);

    let output = `${timestamp} ${levelStr} ${categoryStr} ${message}`;

    if (data !== undefined) {
      if (typeof data === "object") {
        try {
          const json = JSON.stringify(data, null, 2);
          output += `\n${json
            .split("\n")
            .map((line) => ` ${line}`)
            .join("\n")}`;
        } catch {
          output += ` ${data}`;
        }
      } else {
        output += ` ${data}`;
      }
    }

    return `${output}\n`;
  }

  private log(level: LogLevel, category: string, message: string, data?: unknown) {
    if (!this.isEnabled) return;
    const entry = this.formatEntry(level, category, message, data);

    if (process.env.DEBUG === "stdout") {
      const colorMap: Record<LogLevel, string> = {
        debug: "\u001b[90m", // gray
        info: "\u001b[36m", // cyan
        warn: "\u001b[33m", // yellow
        error: "\u001b[31m", // red
      };
      const color = colorMap[level];
      const reset = "\u001b[0m";
      process.stdout.write(`${color}${entry}${reset}`);
    }

    if (this.writeStream) {
      this.asyncBuffer.push(entry);
      if (this.asyncBuffer.length >= BUFFER_CONFIG.MAX_SIZE) {
        this.flushAsync();
      }
    } else if (this.logPath) {
      fs.appendFileSync(this.logPath, entry);
    } else {
      this.logBuffer.push(entry);
    }
  }

  getLogPath(): string | null {
    return this.logPath;
  }

  getCacheDir(): string | null {
    if (!this.logPath) return null;
    return path.dirname(this.logPath);
  }

  debug(category: string, message: string, data?: unknown) {
    this.log("debug", category, message, data);
  }

  info(category: string, message: string, data?: unknown) {
    this.log("info", category, message, data);
  }

  warn(category: string, message: string, data?: unknown) {
    this.log("warn", category, message, data);
  }

  error(category: string, message: string, data?: unknown) {
    console.error(`${category}: ${message}`, data);
    this.log("error", category, message, data);
  }

  vfs(message: string, data?: unknown) {
    this.debug("VFS", message, data);
  }

  shell(command: string, args?: string[]) {
    this.debug("SHELL", command, args);
  }
}

export const log = Logger.getInstance();
