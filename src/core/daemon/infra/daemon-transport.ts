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
    };

function parseDaemonResponse(value: unknown): DaemonResponse | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const parsed = value as Partial<DaemonResponse>;
  if (parsed.ok === false && typeof parsed.code === "string" && typeof parsed.message === "string") {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
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
    let bufferBytes = 0;

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
      bufferBytes += Buffer.byteLength(chunk, "utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        if (bufferBytes > MAX_FRAME_BYTES) {
          finish(new Error("daemon returned oversized response frame"));
        }
        return;
      }
      const rawLine = buffer.slice(0, newlineIndex).trim();
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
      const response = parseDaemonResponse(parsed);
      if (!response) {
        finish(new Error("daemon returned unsupported payload"));
        return;
      }
      finish(null, response);
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
