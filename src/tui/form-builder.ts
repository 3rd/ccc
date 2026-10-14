import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { z } from "zod";
import { shQuote } from "@/utils/shell-command";
import type { FormField, PopupFormDefinition, PopupOptions, PopupResult } from "./types";
import { showPopup } from "./popup";
import { coerceFormData, formFieldsFromSchema } from "./schema";

const RUNNER_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "cli", "runner.ts");

export const createPopupForm = (definition: PopupFormDefinition): PopupFormDefinition => definition;

interface SchemaFormOptions {
  title: string;
  width?: string;
  height?: string;
}

export const createPopupFormFromSchema = (
  schema: z.ZodType,
  options: SchemaFormOptions,
): PopupFormDefinition => {
  return {
    title: options.title,
    width: options.width,
    height: options.height,
    fields: formFieldsFromSchema(schema),
  };
};

export const showPopupFromSchema = <T extends z.ZodType>(
  schema: T,
  options: PopupOptions & SchemaFormOptions,
): PopupResult<z.infer<T>> => {
  const form = createPopupFormFromSchema(schema, options);
  const result = showPopup(form, options);

  if (result.status !== "ok") return result;

  const coerced = coerceFormData(result.data, schema);
  const parsed = schema.safeParse(coerced);

  if (!parsed.success) {
    return { status: "error", error: `Validation failed: ${String(parsed.error)}` };
  }

  return { status: "ok", data: parsed.data as z.infer<T> };
};

const deriveTitle = (fields: FormField[]) => {
  if (fields.length === 1) return fields[0]!.label;
  return "Input";
};

interface PopupInputOptions {
  title?: string;
  width?: string;
  height?: string;
  format?: "json" | "text" | "value";
}

export const popupInput = (schema: z.ZodType, options?: PopupInputOptions) => {
  const fields = formFieldsFromSchema(schema);
  const title = options?.title ?? deriveTitle(fields);
  const format = options?.format ?? (fields.length === 1 ? "value" : "text");

  const config = {
    title,
    fields,
    outputFormat: format,
    width: options?.width,
    height: options?.height,
  };

  const encoded = Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
  const cmd = `bun --config=/dev/null ${shQuote(RUNNER_PATH)} popup-input ${encoded}`;
  return `!` + `\`${cmd}\``;
};
