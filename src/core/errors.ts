import type { CliFailure } from "./types.js";

export class CliError extends Error {
  code: string;
  retryable?: boolean;
  phase?: string;
  recovery?: {
    strategy: string;
    nextCommand?: string;
    requiredFields?: string[];
    context?: Record<string, string | number | boolean | null>;
  };
  diagnostics?: {
    unknownFlags?: string[];
    expectedPositionals?: string[];
    validFlags?: string[];
    canonicalInvocation?: string;
  };
  hints?: string[];
  hintContext?: Record<string, string | number | boolean | null>;

  constructor(
    code: string,
    message: string,
    opts?: {
      retryable?: boolean;
      phase?: string;
      recovery?: {
        strategy: string;
        nextCommand?: string;
        requiredFields?: string[];
        context?: Record<string, string | number | boolean | null>;
      };
      diagnostics?: {
        unknownFlags?: string[];
        expectedPositionals?: string[];
        validFlags?: string[];
        canonicalInvocation?: string;
      };
      hints?: string[];
      hintContext?: Record<string, string | number | boolean | null>;
    },
  ) {
    super(message);
    this.code = code;
    if (typeof opts?.retryable === "boolean") {
      this.retryable = opts.retryable;
    }
    if (typeof opts?.phase === "string" && opts.phase.trim().length > 0) {
      this.phase = opts.phase.trim();
    }
    if (opts?.recovery && typeof opts.recovery === "object") {
      this.recovery = opts.recovery;
    }
    if (opts?.diagnostics && typeof opts.diagnostics === "object") {
      this.diagnostics = opts.diagnostics;
    }
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
    if (typeof error.retryable === "boolean") {
      failure.retryable = error.retryable;
    }
    if (typeof error.phase === "string" && error.phase.length > 0) {
      failure.phase = error.phase;
    }
    if (error.recovery && typeof error.recovery === "object") {
      failure.recovery = error.recovery;
    }
    if (error.diagnostics && typeof error.diagnostics === "object") {
      failure.diagnostics = error.diagnostics;
    }
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
