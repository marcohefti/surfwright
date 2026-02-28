import { providers } from "../../providers/index.js";

const MAX_FRAME_BYTES = 1024 * 1024 * 4;

type DaemonRequest =
  | {
      token: string;
      kind: "ping";
    }
  | {
      token: string;
      kind: "shutdown";
    }
  | {
      token: string;
      kind: "run";
      argv: string[];
    };

type DaemonResponse =
  | {
      ok: true;
      kind: "pong";
    }
  | {
      ok: true;
      kind: "shutdown";
    }
  | {
      ok: true;
      kind: "run";
      code: number;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      retryable?: boolean;
      phase?: string;
      recovery?: {
        strategy: string;
        nextCommand?: string;
        requiredFields?: string[];
        context?: Record<string, string | number | boolean | null>;
      };
      hints?: string[];
      hintContext?: Record<string, string | number | boolean | null>;
    };

type DaemonResponseFrame =
  | DaemonResponse
  | {
      ok: true;
      kind: "run_chunk";
      stream: "stdout" | "stderr";
      data: string;
    }
  | {
      ok: true;
      kind: "run_end";
      code: number;
    };

function parseDaemonResponseFrame(value: unknown): DaemonResponseFrame | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const parsed = value as Partial<DaemonResponseFrame>;
  if (parsed.ok === false && typeof parsed.code === "string" && typeof parsed.message === "string") {
    const hasRecovery =
      typeof parsed.recovery === "object" &&
      parsed.recovery !== null &&
      typeof (parsed.recovery as { strategy?: unknown }).strategy === "string";
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
      ...(typeof parsed.retryable === "boolean" ? { retryable: parsed.retryable } : {}),
      ...(typeof parsed.phase === "string" ? { phase: parsed.phase } : {}),
      ...(hasRecovery
        ? {
            recovery: {
              strategy: String((parsed.recovery as { strategy: unknown }).strategy),
              ...((parsed.recovery as { nextCommand?: unknown }).nextCommand &&
              typeof (parsed.recovery as { nextCommand?: unknown }).nextCommand === "string"
                ? { nextCommand: (parsed.recovery as { nextCommand: string }).nextCommand }
                : {}),
              ...((parsed.recovery as { requiredFields?: unknown }).requiredFields &&
              Array.isArray((parsed.recovery as { requiredFields: unknown[] }).requiredFields)
                ? {
                    requiredFields: (parsed.recovery as { requiredFields: unknown[] }).requiredFields
                      .filter((entry): entry is string => typeof entry === "string")
                      .slice(0, 6),
                  }
                : {}),
              ...((parsed.recovery as { context?: unknown }).context &&
              typeof (parsed.recovery as { context: unknown }).context === "object" &&
              (parsed.recovery as { context: unknown }).context !== null
                ? { context: (parsed.recovery as { context: Record<string, string | number | boolean | null> }).context }
                : {}),
            },
          }
        : {}),
      ...(Array.isArray(parsed.hints)
        ? { hints: parsed.hints.filter((entry): entry is string => typeof entry === "string").slice(0, 3) }
        : {}),
      ...(parsed.hintContext && typeof parsed.hintContext === "object" ? { hintContext: parsed.hintContext } : {}),
    };
  }
  if (parsed.ok !== true || typeof parsed.kind !== "string") {
    return null;
  }
  if (parsed.kind === "pong") {
    return {
      ok: true,
      kind: "pong",
    };
  }
  if (parsed.kind === "shutdown") {
    return {
      ok: true,
      kind: "shutdown",
    };
  }
  if (parsed.kind === "run_chunk" && (parsed.stream === "stdout" || parsed.stream === "stderr") && typeof parsed.data === "string") {
    return {
      ok: true,
      kind: "run_chunk",
      stream: parsed.stream,
      data: parsed.data,
    };
  }
  if (parsed.kind === "run_end" && typeof parsed.code === "number" && Number.isFinite(parsed.code)) {
    return {
      ok: true,
      kind: "run_end",
      code: parsed.code,
    };
  }
  if (
    parsed.kind === "run" &&
    typeof parsed.code === "number" &&
    Number.isFinite(parsed.code) &&
    typeof parsed.stdout === "string" &&
    typeof parsed.stderr === "string"
  ) {
    return {
      ok: true,
      kind: "run",
      code: parsed.code,
      stdout: parsed.stdout,
      stderr: parsed.stderr,
    };
  }
  return null;
}

export async function sendDaemonRequest(opts: {
  host: string;
  port: number;
  request: DaemonRequest;
  timeoutMs: number;
}): Promise<DaemonResponse> {
  return await new Promise<DaemonResponse>((resolve, reject) => {
    const socket = providers().net.createConnection({ host: opts.host, port: opts.port });
    let settled = false;
    let buffer = "";
    const runChunks: { stdout: string[]; stderr: string[] } = {
      stdout: [],
      stderr: [],
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error("daemon request timed out"));
    }, opts.timeoutMs);

    const finish = (error: Error | null, response?: DaemonResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      if (!response) {
        reject(new Error("daemon returned empty response"));
        return;
      }
      resolve(response);
    };

    socket.setEncoding("utf8");
    socket.on("error", (error) => {
      finish(error instanceof Error ? error : new Error("daemon connection error"));
    });

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(opts.request)}\n`);
    });

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const rawLine = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (Buffer.byteLength(rawLine, "utf8") > MAX_FRAME_BYTES) {
          finish(new Error("daemon returned oversized response frame"));
          return;
        }
        if (rawLine.length === 0) {
          finish(new Error("daemon returned blank response"));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          finish(new Error("daemon returned invalid JSON"));
          return;
        }
        const frame = parseDaemonResponseFrame(parsed);
        if (!frame) {
          finish(new Error("daemon returned unsupported payload"));
          return;
        }
        if (frame.ok === false || frame.kind === "pong" || frame.kind === "shutdown") {
          finish(null, frame);
          return;
        }
        if (frame.kind === "run") {
          finish(null, frame);
          return;
        }
        if (frame.kind === "run_chunk") {
          runChunks[frame.stream].push(frame.data);
          continue;
        }
        if (frame.kind === "run_end") {
          finish(null, {
            ok: true,
            kind: "run",
            code: frame.code,
            stdout: runChunks.stdout.join(""),
            stderr: runChunks.stderr.join(""),
          });
          return;
        }
      }
      if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
        finish(new Error("daemon returned oversized response frame"));
      }
    });

    socket.on("end", () => {
      if (!settled) {
        finish(new Error("daemon closed connection before response"));
      }
    });
  });
}

export async function waitForDaemonReady(opts: {
  host: string;
  port: number;
  token: string;
  timeoutMs: number;
  retryDelayMs: number;
  pingTimeoutMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await sendDaemonRequest({
        host: opts.host,
        port: opts.port,
        request: {
          token: opts.token,
          kind: "ping",
        },
        timeoutMs: opts.pingTimeoutMs,
      });
      if (response.ok === true && response.kind === "pong") {
        return true;
      }
    } catch {
      // Keep probing until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs));
  }
  return false;
}
