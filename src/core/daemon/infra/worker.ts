import process from "node:process";
import { stateRootDir } from "../../state/index.js";
import { providers } from "../../providers/index.js";
import { parseCommandPath } from "../../../cli/options.js";
import { orchestrateDaemonWorkerRequest, type DaemonWorkerResponse } from "../app/index.js";
import type { DaemonLaneResolution } from "../domain/index.js";
import { DAEMON_QUEUE_WAIT_MS_DEFAULT, createDaemonLaneScheduler, resolveDaemonLaneKey } from "../domain/index.js";
import { createLocalDaemonDiagnostics } from "./diagnostics.js";

const DAEMON_META_VERSION = 1;
const DAEMON_HOST = "127.0.0.1";
const DAEMON_IDLE_TIMEOUT_MS = 15000;
const MAX_FRAME_BYTES = 1024 * 1024 * 4;

export type DaemonRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type DaemonMeta = {
  version: number;
  pid: number;
  host: string;
  port: number;
  token: string;
  startedAt: string;
};

function daemonMetaPath(): string {
  return providers().path.join(stateRootDir(), "daemon.json");
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : null;
}

function currentProcessUid(): number | null {
  if (typeof process.getuid !== "function") {
    return null;
  }
  try {
    const uid = process.getuid();
    return Number.isFinite(uid) ? uid : null;
  } catch {
    return null;
  }
}

function readDaemonMeta(): DaemonMeta | null {
  try {
    const { fs, runtime } = providers();
    if (runtime.platform !== "win32") {
      const stat = fs.statSync(daemonMetaPath());
      const expectedUid = currentProcessUid();
      if ((stat.mode & 0o077) !== 0 || (expectedUid !== null && typeof stat.uid === "number" && stat.uid !== expectedUid)) {
        removeDaemonMeta();
        return null;
      }
    }
    const raw = fs.readFileSync(daemonMetaPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DaemonMeta>;
    if (
      parsed.version !== DAEMON_META_VERSION ||
      parsePositiveInt(parsed.pid) === null ||
      typeof parsed.host !== "string" ||
      parsed.host.length === 0 ||
      parsePositiveInt(parsed.port) === null ||
      typeof parsed.token !== "string" ||
      parsed.token.length === 0
    ) {
      return null;
    }
    return {
      version: DAEMON_META_VERSION,
      pid: parsePositiveInt(parsed.pid) ?? 0,
      host: parsed.host,
      port: parsePositiveInt(parsed.port) ?? 0,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch {
    return null;
  }
}

function removeDaemonMeta(): void {
  try {
    providers().fs.unlinkSync(daemonMetaPath());
  } catch {
    // ignore missing metadata
  }
}

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

  const scheduleIdleShutdown = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      server.close();
    }, idleMs);
  };

  const writeResponse = (
    socket: { end: (data: string, callback?: () => void) => void },
    response: DaemonWorkerResponse,
    shutdownAfterWrite: boolean,
  ) => {
    socket.end(`${JSON.stringify(response)}\n`, () => {
      if (shutdownAfterWrite) {
        server.close();
      }
    });
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
      const [first, second] = parseCommandPath(argv);
      const command =
        typeof first === "string" && first.length > 0
          ? [first, second].filter((token): token is string => typeof token === "string" && token.length > 0).join(".")
          : "unknown";
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
    scheduleIdleShutdown();
    socket.setEncoding("utf8");
    let buffer = "";
    let bufferBytes = 0;

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
        writeResponse(
          socket,
          {
            ok: false,
            code: "E_DAEMON_REQUEST_INVALID",
            message: "blank request",
          },
          false,
        );
        return;
      }
      // Only one request per connection; ignore any extra bytes.
      buffer = "";
      bufferBytes = 0;

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
          writeResponse(socket, orchestrated.response, orchestrated.shutdownAfterWrite);
          if (orchestrated.scheduleIdleAfterWrite) {
            scheduleIdleShutdown();
          }
        } catch {
          writeResponse(
            socket,
            {
              ok: false,
              code: "E_DAEMON_RUN_FAILED",
              message: "daemon request processing failed",
            },
            false,
          );
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
      resolve();
    });
    server.once("error", reject);
  });
}
