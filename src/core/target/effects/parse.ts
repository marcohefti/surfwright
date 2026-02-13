import { CliError } from "../../errors.js";

const MAX_STEP_COUNT = 200;
const MAX_SCROLL_POSITION = 1_000_000;
const MAX_SETTLE_MS = 10_000;
const MAX_INTERVAL_MS = 10_000;
const MAX_DURATION_MS = 120_000;
const MAX_SAMPLE_COUNT = 1000;
const MAX_PROPERTY_NAME_CHARS = 80;
const MAX_PROPERTIES_COUNT = 12;

export function parseStepsCsv(input: string | undefined): number[] {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw.length === 0) {
    throw new CliError("E_QUERY_INVALID", "steps is required and must be a comma-separated list of non-negative integers");
  }

  const parts = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length === 0) {
    throw new CliError("E_QUERY_INVALID", "steps must include at least one position");
  }
  if (parts.length > MAX_STEP_COUNT) {
    throw new CliError("E_QUERY_INVALID", `steps must contain at most ${MAX_STEP_COUNT} values`);
  }

  const values: number[] = [];
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new CliError("E_QUERY_INVALID", `Invalid steps value: ${part}`);
    }
    if (value < 0 || value > MAX_SCROLL_POSITION) {
      throw new CliError("E_QUERY_INVALID", `steps values must be between 0 and ${MAX_SCROLL_POSITION}`);
    }
    values.push(value);
  }
  return values;
}

export function parseSettleMs(input: number | undefined, fallback: number): number {
  if (typeof input === "undefined") {
    return fallback;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0 || input > MAX_SETTLE_MS) {
    throw new CliError("E_QUERY_INVALID", `settle-ms must be an integer between 0 and ${MAX_SETTLE_MS}`);
  }
  return input;
}

export function parseIntervalMs(input: number | undefined, fallback: number): number {
  if (typeof input === "undefined") {
    return fallback;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_INTERVAL_MS) {
    throw new CliError("E_QUERY_INVALID", `interval-ms must be an integer between 1 and ${MAX_INTERVAL_MS}`);
  }
  return input;
}

export function parseDurationMs(input: number | undefined, fallback: number): number {
  if (typeof input === "undefined") {
    return fallback;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_DURATION_MS) {
    throw new CliError("E_QUERY_INVALID", `duration-ms must be an integer between 1 and ${MAX_DURATION_MS}`);
  }
  return input;
}

export function parseMaxSamples(input: number | undefined, fallback: number): number {
  if (typeof input === "undefined") {
    return fallback;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_SAMPLE_COUNT) {
    throw new CliError("E_QUERY_INVALID", `max-samples must be an integer between 1 and ${MAX_SAMPLE_COUNT}`);
  }
  return input;
}

export function parsePropertyName(input: string | undefined, fallback: string): string {
  const raw = typeof input === "string" ? input.trim() : "";
  const value = raw.length > 0 ? raw : fallback;
  if (value.length === 0 || value.length > MAX_PROPERTY_NAME_CHARS) {
    throw new CliError("E_QUERY_INVALID", `property must be 1-${MAX_PROPERTY_NAME_CHARS} characters`);
  }
  return value;
}

export function parsePropertiesCsv(input: string | undefined, fallback: string[]): string[] {
  const raw = typeof input === "string" ? input.trim() : "";
  const parts =
    raw.length === 0
      ? fallback
      : raw
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

  if (parts.length === 0) {
    throw new CliError("E_QUERY_INVALID", "properties must include at least one value");
  }
  if (parts.length > MAX_PROPERTIES_COUNT) {
    throw new CliError("E_QUERY_INVALID", `properties must include at most ${MAX_PROPERTIES_COUNT} values`);
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of parts) {
    if (part.length > MAX_PROPERTY_NAME_CHARS) {
      throw new CliError("E_QUERY_INVALID", `property values must be at most ${MAX_PROPERTY_NAME_CHARS} characters`);
    }
    if (seen.has(part)) {
      continue;
    }
    seen.add(part);
    values.push(part);
  }
  return values;
}
