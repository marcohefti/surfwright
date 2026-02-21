import { CliError } from "../../../errors.js";

export type UploadResultVerification = {
  enabled: boolean;
  selector: string | null;
  textContains: string | null;
  filenameRegex: string | null;
  source: "none" | "selector" | "body" | "selector+body";
  matchedTextContains: boolean | null;
  matchedFilenameRegex: boolean | null;
  satisfied: boolean;
};

export function parseOptionalTrimmedString(input: string | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  return value.length > 0 ? value : null;
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseOptionalRegex(input: string | undefined, optionName: string): RegExp | null {
  const pattern = parseOptionalTrimmedString(input);
  if (!pattern) {
    return null;
  }
  try {
    return new RegExp(pattern);
  } catch {
    throw new CliError("E_QUERY_INVALID", `${optionName} must be a valid regular expression`);
  }
}

export function waitTimedOut(error: unknown): boolean {
  if (error instanceof CliError && error.code === "E_WAIT_TIMEOUT") {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

export async function readSelectorTextBestEffort(
  page: import("playwright-core").Page,
  selector: string,
  timeoutMs: number,
): Promise<string | null> {
  const query = selector.trim();
  if (query.length < 1) {
    return null;
  }
  try {
    const text = await page.locator(query).first().innerText({
      timeout: Math.max(1, timeoutMs),
    });
    const normalized = text.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export async function readBodyTextBestEffort(page: import("playwright-core").Page, timeoutMs: number): Promise<string | null> {
  try {
    const raw = await page.locator("body").innerText({
      timeout: Math.max(1, timeoutMs),
    });
    return raw.trim();
  } catch {
    return null;
  }
}

export function resolveUploadedFilenameFromEvidence(opts: {
  fileInputs: Array<{ name: string }>;
  expectedUploadedFilename: string | null;
  selectorText: string | null;
  bodyText: string;
}): string | null {
  const selectorText = opts.selectorText ?? "";
  const bodyText = opts.bodyText;
  for (const entry of opts.fileInputs) {
    if (selectorText.includes(entry.name) || bodyText.includes(entry.name)) {
      return entry.name;
    }
  }
  if (opts.expectedUploadedFilename) {
    if (selectorText.includes(opts.expectedUploadedFilename) || bodyText.includes(opts.expectedUploadedFilename)) {
      return opts.expectedUploadedFilename;
    }
  }
  return null;
}

export function deriveResultSource(selectorText: string | null, bodyText: string): UploadResultVerification["source"] {
  const hasSelector = typeof selectorText === "string" && selectorText.length > 0;
  const hasBody = bodyText.length > 0;
  if (hasSelector && hasBody) {
    return "selector+body";
  }
  if (hasSelector) {
    return "selector";
  }
  if (hasBody) {
    return "body";
  }
  return "none";
}
