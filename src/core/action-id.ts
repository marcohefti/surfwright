import { randomBytes } from "node:crypto";
import { CliError } from "./errors.js";

const ACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function sanitizeActionId(input: string): string {
  const value = input.trim();
  if (!ACTION_ID_PATTERN.test(value)) {
    throw new CliError(
      "E_QUERY_INVALID",
      "action-id may only contain letters, numbers, dot, underscore, colon, and dash (max 64 chars)",
    );
  }
  return value;
}

export function newActionId(): string {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `a-${stamp}-${rand}`;
}
