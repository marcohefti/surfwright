import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { stateRootDir } from "../state.js";

const DAEMON_META_VERSION = 1;
const DAEMON_HOST = "127.0.0.1";
const DAEMON_IDLE_TIMEOUT_MS = 15000;
const MAX_FRAME_BYTES = 1024 * 1024 * 4;

export type DaemonRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

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

type DaemonMeta = {
  version: number;
  pid: number;
  host: string;
  port: number;
  token: string;
  startedAt: string;
};

function daemonMetaPath(): string {
  return path.join(stateRootDir(), "daemon.json");
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : null;
}

function readDaemonMeta(): DaemonMeta | null {
  try {
    if (process.platform !== "win32") {
      const stat = fs.statSync(daemonMetaPath());
      if ((stat.mode & 0o077) !== 0) {
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
    fs.unlinkSync(daemonMetaPath());
  } catch {
    // ignore missing metadata
  }
}

export function daemonIdleTimeoutMs(): number {
  const raw = process.env.SURFWRIGHT_DAEMON_IDLE_MS;
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
  if (meta.pid !== process.pid || meta.token !== token) {
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
  onRun: (argv: string[]) => Promise<DaemonRunResult>;
}): Promise<void> {
  const idleMs = daemonIdleTimeoutMs();
  const server = net.createServer();
  let queue = Promise.resolve();
  let idleTimer: NodeJS.Timeout | null = null;

  const scheduleIdleShutdown = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      server.close();
    }, idleMs);
  };

  const writeResponse = (socket: net.Socket, response: DaemonResponse, shutdownAfterWrite: boolean) => {
    socket.end(`${JSON.stringify(response)}\n`, () => {
      if (shutdownAfterWrite) {
        server.close();
      }
    });
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

      queue = queue
        .then(async () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(rawLine);
          } catch {
            writeResponse(
              socket,
              {
                ok: false,
                code: "E_DAEMON_REQUEST_INVALID",
                message: "request must be JSON",
              },
              false,
            );
            return;
          }

          if (typeof parsed !== "object" || parsed === null) {
            writeResponse(
              socket,
              {
                ok: false,
                code: "E_DAEMON_REQUEST_INVALID",
                message: "request payload must be object",
              },
              false,
            );
            return;
          }

          const request = parsed as Partial<DaemonRequest>;
          if (request.token !== opts.token) {
            writeResponse(
              socket,
              {
                ok: false,
                code: "E_DAEMON_TOKEN_INVALID",
                message: "token mismatch",
              },
              false,
            );
            return;
          }

          if (request.kind === "ping") {
            writeResponse(
              socket,
              {
                ok: true,
                kind: "pong",
              },
              false,
            );
            scheduleIdleShutdown();
            return;
          }

          if (request.kind === "shutdown") {
            writeResponse(
              socket,
              {
                ok: true,
                kind: "shutdown",
              },
              true,
            );
            return;
          }

          if (request.kind === "run") {
            if (!Array.isArray(request.argv) || request.argv.some((entry) => typeof entry !== "string")) {
              writeResponse(
                socket,
                {
                  ok: false,
                  code: "E_DAEMON_REQUEST_INVALID",
                  message: "run request requires argv string array",
                },
                false,
              );
              return;
            }

            try {
              const result = await opts.onRun(request.argv);
              writeResponse(
                socket,
                {
                  ok: true,
                  kind: "run",
                  code: result.code,
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
                false,
              );
              scheduleIdleShutdown();
              return;
            } catch {
              writeResponse(
                socket,
                {
                  ok: false,
                  code: "E_DAEMON_RUN_FAILED",
                  message: "daemon failed to execute command",
                },
                false,
              );
              scheduleIdleShutdown();
              return;
            }
          }

          writeResponse(
            socket,
            {
              ok: false,
              code: "E_DAEMON_REQUEST_INVALID",
              message: "unsupported request kind",
            },
            false,
          );
        })
        .catch(() => {
          writeResponse(
            socket,
            {
              ok: false,
              code: "E_DAEMON_RUN_FAILED",
              message: "daemon request processing failed",
            },
            false,
          );
        });
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
