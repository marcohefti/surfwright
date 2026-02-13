import type { CliFailure } from "./types.js";

export class CliError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function oneLineError(message: string): string {
  const first = message.split("\n")[0]?.trim();
  if (!first) {
    return "Unknown error";
  }
  const maxLen = 220;
  if (first.length <= maxLen) {
    return first;
  }
  return `${first.slice(0, maxLen - 1)}…`;
}

export function toCliFailure(error: unknown): CliFailure {
  if (error instanceof CliError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      code: "E_INTERNAL",
      message: oneLineError(error.message),
    };
  }

  return {
    ok: false,
    code: "E_INTERNAL",
    message: "Unknown error",
  };
}
