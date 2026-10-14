import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { shQuote } from "@/utils/shell-command";
import type { FormResultData, PopupFormDefinition, PopupOptions, PopupResult, SelectOption } from "./types";
import { getTmuxPane, isTmuxAvailable } from "./detect";
import { calculatePopupHeight } from "./form";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RENDERER_PATH = join(__dirname, "renderer.ts");
const DEFAULT_TIMEOUT = 120_000;

interface ExecSyncError {
  killed: boolean;
  status: number | null;
  stderr: Buffer | string;
}

const isExecError = (e: unknown): e is ExecSyncError =>
  typeof e === "object" && e !== null && "status" in e && "killed" in e;

const cleanupFile = (path: string) => {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
};

export const showPopup = <T = FormResultData>(
  form: PopupFormDefinition,
  options?: PopupOptions,
): PopupResult<T> => {
  if (!isTmuxAvailable()) {
    return { status: "error", error: "Not running inside tmux" };
  }

  const pane = options?.targetPane ?? getTmuxPane();
  if (!pane) {
    return { status: "error", error: "TMUX_PANE not set" };
  }

  const encoded = Buffer.from(JSON.stringify(form), "utf8").toString("base64url");
  const resultFile = join(tmpdir(), `ccc-popup-${randomBytes(8).toString("hex")}.json`);
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  const width = form.width ?? "60%";
  const height = form.height ?? String(calculatePopupHeight(form));
  const title = ` ${form.title} `;

  // propagate CCC env vars into the popup subprocess
  const envFlags: string[] = [];
  for (const key of ["CCC_INSTANCE_ID", "CCC_CONFIG_DIR", "DEBUG"] as const) {
    const val = process.env[key];
    if (val) envFlags.push("-e", `${key}=${val}`);
  }

  const tmuxCmd = [
    "tmux",
    "display-popup",
    "-E",
    "-w",
    shQuote(width),
    "-h",
    shQuote(height),
    "-T",
    shQuote(title),
    "-t",
    shQuote(pane),
    ...envFlags,
    "-e",
    `CCC_POPUP_FORM=${encoded}`,
    "-e",
    `CCC_POPUP_RESULT_FILE=${resultFile}`,
    `bun --config=/dev/null ${shQuote(RENDERER_PATH)}`,
  ].join(" ");

  try {
    execSync(tmuxCmd, {
      timeout: timeout > 0 ? timeout : undefined,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error: unknown) {
    cleanupFile(resultFile);

    if (!isExecError(error)) return { status: "error", error: "Unknown popup error" };
    if (error.killed) return { status: "error", error: "Popup timed out" };
    if (error.status === 1) return { status: "cancelled" };
    return {
      status: "error",
      error: `Popup failed (exit ${error.status ?? "?"}): ${String(error.stderr ?? "")}`.trim(),
    };
  }

  try {
    if (!existsSync(resultFile)) return { status: "cancelled" };
    const content = readFileSync(resultFile, "utf8");
    const data = JSON.parse(content) as T;
    return { status: "ok", data };
  } catch (error) {
    return { status: "error", error: `Failed to read popup result: ${String(error)}` };
  } finally {
    cleanupFile(resultFile);
  }
};

export const popupConfirm = (message: string, title = "Confirm") => {
  const result = showPopup({
    title,
    fields: [{ type: "toggle", name: "value", label: message, defaultValue: false }],
  });
  if (result.status !== "ok") return null;
  const val = result.data.value;
  return typeof val === "boolean" ? val : null;
};

export const popupSelect = (message: string, options: SelectOption[], title = "Select") => {
  const result = showPopup({
    title,
    fields: [{ type: "select", name: "value", label: message, options }],
  });
  if (result.status !== "ok") return null;
  const val = result.data.value;
  return typeof val === "string" ? val : null;
};

export const popupText = (message: string, title = "Input") => {
  const result = showPopup({
    title,
    fields: [{ type: "text", name: "value", label: message }],
  });
  if (result.status !== "ok") return null;
  const val = result.data.value;
  return typeof val === "string" ? val : null;
};
