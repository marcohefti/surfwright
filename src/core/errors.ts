import type { CliFailure } from "./types.js";

export class CliError extends Error {
  code: string;
  hints?: string[];
  hintContext?: Record<string, string | number | boolean | null>;

  constructor(
    code: string,
    message: string,
    opts?: {
      hints?: string[];
      hintContext?: Record<string, string | number | boolean | null>;
    },
  ) {
    super(message);
    this.code = code;
    if (Array.isArray(opts?.hints) && opts.hints.length > 0) {
      this.hints = opts.hints.slice(0, 3);
    }
    if (opts?.hintContext) {
      this.hintContext = opts.hintContext;
    }
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
    const failure: CliFailure = {
      ok: false,
      code: error.code,
      message: error.message,
    };
    if (Array.isArray(error.hints) && error.hints.length > 0) {
      failure.hints = error.hints;
    }
    if (error.hintContext && typeof error.hintContext === "object") {
      failure.hintContext = error.hintContext;
    }
    return failure;
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
