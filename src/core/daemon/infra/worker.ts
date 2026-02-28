import process from "node:process";
import { providers } from "../../providers/index.js";
import { resolveArgvCommandId } from "../../../cli/command-path.js";
import { orchestrateDaemonWorkerRequest, type DaemonWorkerResponse } from "../app/index.js";
import type { DaemonLaneResolution } from "../domain/index.js";
import { DAEMON_QUEUE_WAIT_MS_DEFAULT, createDaemonLaneScheduler, resolveDaemonLaneKey } from "../domain/index.js";
import { readDaemonMeta, removeDaemonMeta } from "./daemon-meta.js";
import { createLocalDaemonDiagnostics } from "./diagnostics.js";

const DAEMON_HOST = "127.0.0.1";
const DAEMON_IDLE_TIMEOUT_MS = 15000;
const DAEMON_FORCE_SOCKET_CLOSE_MS = 750;
const MAX_FRAME_BYTES = 1024 * 1024 * 4;
const DAEMON_RUN_CHUNK_BYTES = 64 * 1024;

export type DaemonRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export function daemonIdleTimeoutMs(): number {
  const raw = providers().env.get("SURFWRIGHT_DAEMON_IDLE_MS");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DAEMON_IDLE_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DAEMON_IDLE_TIMEOUT_MS;
  }
  return parsed;
}

export function cleanupOwnedDaemonMeta(token: string): void {
  const meta = readDaemonMeta();
  if (!meta) {
    return;
  }
  if (meta.pid !== providers().runtime.pid || meta.token !== token) {
    return;
  }
  removeDaemonMeta();
}

export function parseDaemonWorkerArgv(argv: string[]): { port: number; token: string } {
  let port: number | null = null;
  let token: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const tokenValue = argv[index];
    if (tokenValue === "--port") {
      const value = argv[index + 1];
      index += 1;
      if (typeof value !== "string") {
        throw new Error("Missing --port value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Invalid --port value");
      }
      port = parsed;
      continue;
    }

    if (tokenValue === "--token") {
      const value = argv[index + 1];
      index += 1;
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("Missing --token value");
      }
      token = value;
      continue;
    }
  }

  if (port === null || token === null) {
    throw new Error("Daemon worker requires --port and --token");
  }

  return { port, token };
}

export async function runDaemonWorker(opts: {
  port: number;
  token: string;
  onRun: (argv: string[], lane: DaemonLaneResolution) => Promise<DaemonRunResult>;
}): Promise<void> {
  const idleMs = daemonIdleTimeoutMs();
  const { net } = providers();
  const server = net.createServer();
  const diagnostics = createLocalDaemonDiagnostics();
  const scheduler = createDaemonLaneScheduler<DaemonRunResult>({
    diagnostics,
  });
  let idleTimer: NodeJS.Timeout | null = null;
  let forceCloseTimer: NodeJS.Timeout | null = null;
  let shuttingDown = false;
  const sockets = new Map<
    {
      setEncoding: (encoding: BufferEncoding) => void;
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      destroy: () => void;
      end: (data: string, callback?: () => void) => void;
      setTimeout: (timeout: number, callback?: () => void) => void;
    },
    {
      inFlight: boolean;
    }
  >();

  const clearForceCloseTimer = () => {
    if (forceCloseTimer) {
      clearTimeout(forceCloseTimer);
      forceCloseTimer = null;
    }
  };

  const destroyIdleSockets = () => {
    for (const [socket, state] of sockets.entries()) {
      if (state.inFlight) {
        continue;
      }
      socket.destroy();
    }
  };

  const beginShutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearForceCloseTimer();
    server.close();
    destroyIdleSockets();
    if (sockets.size > 0) {
      forceCloseTimer = setTimeout(() => {
        destroyIdleSockets();
      }, DAEMON_FORCE_SOCKET_CLOSE_MS);
    }
  };

  const scheduleIdleShutdown = () => {
    if (shuttingDown) {
      return;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      beginShutdown();
    }, idleMs);
  };

  const writeResponse = (input: {
    socket: {
      end: (data: string, callback?: () => void) => void;
    };
    response: DaemonWorkerResponse;
    shutdownAfterWrite: boolean;
    markIdle: () => void;
  }) => {
    input.socket.end(`${JSON.stringify(input.response)}\n`, () => {
      input.markIdle();
      if (input.shutdownAfterWrite) {
        beginShutdown();
      }
    });
  };

  const chunkUtf8Text = (value: string, chunkBytes: number): string[] => {
    if (value.length === 0) {
      return [];
    }
    const encoded = Buffer.from(value, "utf8");
    const out: string[] = [];
    let offset = 0;
    while (offset < encoded.length) {
      let end = Math.min(offset + chunkBytes, encoded.length);
      while (end > offset && end < encoded.length && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
        end -= 1;
      }
      if (end <= offset) {
        end = Math.min(offset + chunkBytes, encoded.length);
      }
      out.push(encoded.subarray(offset, end).toString("utf8"));
      offset = end;
    }
    return out;
  };

  const daemonRunFrames = (response: Extract<DaemonWorkerResponse, { ok: true; kind: "run" }>): string => {
    const lines: string[] = [];
    for (const chunk of chunkUtf8Text(response.stdout, DAEMON_RUN_CHUNK_BYTES)) {
      lines.push(
        `${JSON.stringify({
          ok: true,
          kind: "run_chunk",
          stream: "stdout",
          data: chunk,
        })}\n`,
      );
    }
    for (const chunk of chunkUtf8Text(response.stderr, DAEMON_RUN_CHUNK_BYTES)) {
      lines.push(
        `${JSON.stringify({
          ok: true,
          kind: "run_chunk",
          stream: "stderr",
          data: chunk,
        })}\n`,
      );
    }
    lines.push(
      `${JSON.stringify({
        ok: true,
        kind: "run_end",
        code: response.code,
      })}\n`,
    );
    return lines.join("");
  };

  const writeResponseFrames = (input: {
    socket: {
      end: (data: string, callback?: () => void) => void;
    };
    response: DaemonWorkerResponse;
    shutdownAfterWrite: boolean;
    markIdle: () => void;
  }) => {
    if (input.response.ok && input.response.kind === "run") {
      input.socket.end(daemonRunFrames(input.response), () => {
        input.markIdle();
        if (input.shutdownAfterWrite) {
          beginShutdown();
        }
      });
      return;
    }
    writeResponse(input);
  };

  const metric = (metricName: string, value: number, tags?: Record<string, string>) => {
    diagnostics.emitMetric({
      ts: new Date().toISOString(),
      metric: metricName,
      value,
      ...(tags ? { tags } : {}),
    });
  };

  const deriveRunDiagnostics = (
    rawLine: string,
  ): {
    requestId: string;
    sessionId: string;
    command: string;
    queueScope: string;
  } | null => {
    try {
      const parsed = JSON.parse(rawLine) as { token?: unknown; kind?: unknown; argv?: unknown };
      if (parsed.token !== opts.token || parsed.kind !== "run" || !Array.isArray(parsed.argv)) {
        return null;
      }
      if (parsed.argv.some((entry) => typeof entry !== "string")) {
        return null;
      }
      const argv = parsed.argv as string[];
      const lane = resolveDaemonLaneKey({ argv });
      const command = resolveArgvCommandId(argv) ?? "unknown";
      const sessionId = lane.source === "sessionId" ? lane.laneKey.replace(/^session:/, "") : "none";
      return {
        requestId: providers().crypto.randomBytes(8).toString("hex"),
        sessionId: sessionId.length > 0 ? sessionId : "none",
        command,
        queueScope: lane.laneKey,
      };
    } catch {
      return null;
    }
  };

  server.on("connection", (socket) => {
    if (shuttingDown) {
      socket.destroy();
      return;
    }
    const state = {
      inFlight: false,
    };
    sockets.set(socket, state);
    scheduleIdleShutdown();
    socket.setTimeout(idleMs, () => {
      if (state.inFlight) {
        return;
      }
      socket.destroy();
    });
    socket.setEncoding("utf8");
    let buffer = "";
    let bufferBytes = 0;

    socket.on("close", () => {
      sockets.delete(socket);
      if (shuttingDown) {
        destroyIdleSockets();
        if (sockets.size === 0) {
          clearForceCloseTimer();
        }
      }
    });

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      bufferBytes += Buffer.byteLength(chunk, "utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        if (bufferBytes > MAX_FRAME_BYTES) {
          socket.destroy();
        }
        return;
      }
      const rawLine = buffer.slice(0, newlineIndex).trim();
      if (Buffer.byteLength(rawLine, "utf8") > MAX_FRAME_BYTES) {
        socket.destroy();
        return;
      }
      if (rawLine.length === 0) {
        writeResponseFrames({
          socket,
          response: {
            ok: false,
            code: "E_DAEMON_REQUEST_INVALID",
            message: "blank request",
          },
          shutdownAfterWrite: false,
          markIdle: () => {
            state.inFlight = false;
          },
        });
        return;
      }
      // Only one request per connection; ignore any extra bytes.
      buffer = "";
      bufferBytes = 0;
      state.inFlight = true;

      void (async () => {
        const startedAtMs = Date.now();
        let queueWaitMs = 0;
        const diag = deriveRunDiagnostics(rawLine);
        try {
          const orchestrated = await orchestrateDaemonWorkerRequest({
            rawRequestLine: rawLine,
            expectedToken: opts.token,
            onRun: async (argv, lane) =>
              await scheduler.enqueue({
                laneKey: lane.laneKey,
                execute: async () => {
                  queueWaitMs = Math.max(0, Date.now() - startedAtMs);
                  metric("daemon_queue_wait_ms", queueWaitMs, { scope: lane.laneKey });
                  return await opts.onRun(argv, lane);
                },
              }),
          });
          const durationMs = Math.max(0, Date.now() - startedAtMs);
          metric("daemon_request_duration_ms", durationMs, {
            command: diag?.command ?? "unknown",
          });
          const rssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
          metric("daemon_worker_rss_mb", rssMb);
          if (diag) {
            const errorCode = orchestrated.response.ok ? null : orchestrated.response.code;
            const result: "success" | "typed_error" | "unreachable" | "timeout" | "cancelled" =
              errorCode === "E_DAEMON_QUEUE_TIMEOUT"
                ? "timeout"
                : orchestrated.response.ok
                  ? "success"
                  : "typed_error";
            const queueWaitForEvent =
              errorCode === "E_DAEMON_QUEUE_TIMEOUT" && queueWaitMs === 0 ? DAEMON_QUEUE_WAIT_MS_DEFAULT : queueWaitMs;
            diagnostics.emitEvent({
              ts: new Date().toISOString(),
              event: "daemon.request",
              requestId: diag.requestId,
              sessionId: diag.sessionId,
              command: diag.command,
              result,
              errorCode,
              queueScope: diag.queueScope,
              queueWaitMs: queueWaitForEvent,
              durationMs,
            });
          }
          writeResponseFrames({
            socket,
            response: orchestrated.response,
            shutdownAfterWrite: orchestrated.shutdownAfterWrite,
            markIdle: () => {
              state.inFlight = false;
            },
          });
          if (orchestrated.scheduleIdleAfterWrite) {
            scheduleIdleShutdown();
          }
        } catch {
          writeResponseFrames({
            socket,
            response: {
              ok: false,
              code: "E_DAEMON_RUN_FAILED",
              message: "daemon request processing failed",
            },
            shutdownAfterWrite: false,
            markIdle: () => {
              state.inFlight = false;
            },
          });
        }
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: DAEMON_HOST, port: opts.port }, () => {
      server.off("error", reject);
      resolve();
    });
  });

  scheduleIdleShutdown();

  await new Promise<void>((resolve, reject) => {
    server.once("close", () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      clearForceCloseTimer();
      destroyIdleSockets();
      resolve();
    });
    server.once("error", reject);
  });
}
