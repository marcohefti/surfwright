import process from "node:process";
import { allocateFreePort } from "../../browser.js";
import { stateRootDir } from "../../state/index.js";
import { providers } from "../../providers/index.js";
import { requestContextEnvGet } from "../../request-context.js";
import { parseGlobalOptionValue } from "../../../cli/options.js";
import { sendDaemonRequest, waitForDaemonReady } from "./daemon-transport.js";
import {
  DAEMON_META_VERSION,
  type DaemonMeta,
  isProcessAlive,
  readDaemonMeta,
  removeDaemonMeta,
  writeDaemonMeta,
} from "./daemon-meta.js";

const DAEMON_HOST = "127.0.0.1";
const DAEMON_STARTUP_TIMEOUT_MS = 4500;
const DAEMON_REQUEST_TIMEOUT_MS = 120000;
const DAEMON_PING_TIMEOUT_MS = 250;
const DAEMON_RETRY_DELAY_MS = 60;
const DAEMON_QUEUE_RETRY_MAX_ATTEMPTS = 2;
const DAEMON_QUEUE_RETRY_DELAY_MS = 60;
const DAEMON_START_LOCK_FILENAME = "daemon.start.lock";
const DAEMON_START_LOCK_TIMEOUT_MS = 5000;
const DAEMON_START_LOCK_STALE_MS = 15000;

export type DaemonRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type DaemonClientOutcome =
  | {
      kind: "success";
      result: DaemonRunResult;
    }
  | {
      kind: "typed_daemon_error";
      code: string;
      message: string;
    }
  | {
      kind: "unreachable";
      message: string;
    };

function daemonStartLockPath(): string {
  return providers().path.join(stateRootDir(), DAEMON_START_LOCK_FILENAME);
}

function normalizedAgentIdFromContext(): string | null {
  const raw = requestContextEnvGet("SURFWRIGHT_AGENT_ID");
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function withRequestAgentIdArgv(argv: string[]): string[] {
  const parsed = parseGlobalOptionValue(argv, "--agent-id");
  if (parsed.found && parsed.valid) {
    return argv;
  }
  const fromContext = normalizedAgentIdFromContext();
  if (!fromContext) {
    return argv;
  }
  return [argv[0] ?? "", argv[1] ?? "", "--agent-id", fromContext, ...argv.slice(2)];
}

function parseDaemonStartLockTimestampMs(lockPath: string): number | null {
  try {
    const raw = providers().fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: unknown } | null;
    if (parsed && typeof parsed.createdAt === "string") {
      const ms = Date.parse(parsed.createdAt);
      if (Number.isFinite(ms)) {
        return ms;
      }
    }
  } catch {
    // fall back to file stat mtime
  }
  try {
    const stat = providers().fs.statSync(lockPath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

function parseDaemonStartLockOwnerPid(lockPath: string): number | null {
  try {
    const raw = providers().fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown } | null;
    if (!parsed) {
      return null;
    }
    const pid = typeof parsed.pid === "number" ? Math.floor(parsed.pid) : Number.NaN;
    if (!Number.isFinite(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function clearStaleDaemonStartLock(lockPath: string): boolean {
  const ownerPid = parseDaemonStartLockOwnerPid(lockPath);
  if (typeof ownerPid === "number" && ownerPid > 0 && isProcessAlive(ownerPid)) {
    return false;
  }
  const createdMs = parseDaemonStartLockTimestampMs(lockPath);
  if (createdMs !== null && Date.now() - createdMs < DAEMON_START_LOCK_STALE_MS) {
    if (typeof ownerPid !== "number" || ownerPid <= 0) {
      return false;
    }
  }
  try {
    providers().fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function tryCreateDaemonStartLock(lockPath: string): boolean {
  try {
    providers().fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      return false;
    }
    return false;
  }
}

function releaseDaemonStartLock(lockPath: string): void {
  try {
    providers().fs.unlinkSync(lockPath);
  } catch {
    // ignore missing lock
  }
}

function readAliveDaemonMeta(): DaemonMeta | null {
  const meta = readDaemonMeta();
  if (!meta) {
    return null;
  }
  if (!isProcessAlive(meta.pid)) {
    removeDaemonMeta();
    return null;
  }
  return meta;
}

async function startDaemon(entryScriptPath: string): Promise<boolean> {
  const existing = readAliveDaemonMeta();
  if (existing) {
    return true;
  }
  const { fs } = providers();
  fs.mkdirSync(stateRootDir(), { recursive: true });
  const startLockPath = daemonStartLockPath();
  const startLockDeadline = Date.now() + DAEMON_START_LOCK_TIMEOUT_MS;
  while (Date.now() < startLockDeadline) {
    const liveMeta = readAliveDaemonMeta();
    if (liveMeta) {
      return true;
    }
    if (!tryCreateDaemonStartLock(startLockPath)) {
      clearStaleDaemonStartLock(startLockPath);
      await new Promise((resolve) => setTimeout(resolve, DAEMON_RETRY_DELAY_MS));
      continue;
    }

    try {
      const recheck = readAliveDaemonMeta();
      if (recheck) {
        return true;
      }

      const { childProcess, crypto, env, runtime } = providers();
      const port = await allocateFreePort();
      const token = crypto.randomBytes(18).toString("hex");
      const child = childProcess.spawn(
        runtime.execPath,
        [entryScriptPath, "__daemon-worker", "--port", String(port), "--token", token],
        {
          detached: true,
          stdio: "ignore",
          env: {
            ...env.snapshot(),
            SURFWRIGHT_DAEMON_CHILD: "1",
          },
        },
      );
      child.unref();

      if (typeof child.pid !== "number" || child.pid <= 0) {
        return false;
      }

      const meta: DaemonMeta = {
        version: DAEMON_META_VERSION,
        pid: child.pid,
        host: DAEMON_HOST,
        port,
        token,
        startedAt: new Date().toISOString(),
      };
      writeDaemonMeta(meta);

      const ready = await waitForDaemonReady({
        host: DAEMON_HOST,
        port: meta.port,
        token: meta.token,
        timeoutMs: DAEMON_STARTUP_TIMEOUT_MS,
        retryDelayMs: DAEMON_RETRY_DELAY_MS,
        pingTimeoutMs: DAEMON_PING_TIMEOUT_MS,
      });
      if (!ready) {
        try {
          runtime.kill(child.pid, "SIGTERM");
        } catch {
          // ignore
        }
        removeDaemonMeta();
        return false;
      }
      return true;
    } finally {
      releaseDaemonStartLock(startLockPath);
    }
  }
  return readAliveDaemonMeta() !== null;
}

export function daemonProxyEnabled(): boolean {
  const fromEnv = providers().env.get("SURFWRIGHT_DAEMON");
  if (typeof fromEnv !== "string") {
    return true;
  }
  const normalized = fromEnv.trim().toLowerCase();
  if (normalized === "" || normalized === "1" || normalized === "true" || normalized === "on" || normalized === "auto") {
    return true;
  }
  return false;
}

export async function runViaDaemon(argv: string[], entryScriptPath: string): Promise<DaemonClientOutcome> {
  if (!daemonProxyEnabled()) {
    return {
      kind: "unreachable",
      message: "daemon proxy disabled",
    };
  }

  let meta = readAliveDaemonMeta();
  if (!meta) {
    const started = await startDaemon(entryScriptPath);
    if (!started) {
      return {
        kind: "unreachable",
        message: "daemon failed to start",
      };
    }
    meta = readAliveDaemonMeta();
    if (!meta) {
      return {
        kind: "unreachable",
        message: "daemon metadata unavailable after start",
      };
    }
  }

  const isQueuePressureCode = (code: string): boolean =>
    code === "E_DAEMON_QUEUE_TIMEOUT" || code === "E_DAEMON_QUEUE_SATURATED";
  const normalizeSurfaceDaemonError = (code: string, message: string): { code: string; message: string } => {
    if (isQueuePressureCode(code)) {
      return { code, message };
    }
    return {
      code: "E_INTERNAL",
      message: message.length > 0 ? message : "daemon request failed",
    };
  };
  const requestArgv = withRequestAgentIdArgv(argv);

  try {
    for (let attempt = 0; attempt <= DAEMON_QUEUE_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const response = await sendDaemonRequest({
        host: DAEMON_HOST,
        port: meta.port,
        request: {
          token: meta.token,
          kind: "run",
          argv: requestArgv,
        },
        timeoutMs: DAEMON_REQUEST_TIMEOUT_MS,
      });
      if (!response.ok) {
        const shouldRetry = isQueuePressureCode(response.code) && attempt < DAEMON_QUEUE_RETRY_MAX_ATTEMPTS;
        if (shouldRetry) {
          await new Promise((resolve) => setTimeout(resolve, DAEMON_QUEUE_RETRY_DELAY_MS));
          continue;
        }
        const normalized = normalizeSurfaceDaemonError(response.code, response.message);
        return {
          kind: "typed_daemon_error",
          code: normalized.code,
          message: normalized.message,
        };
      }
      if (response.kind !== "run") {
        return {
          kind: "unreachable",
          message: "daemon returned non-run response kind",
        };
      }
      return {
        kind: "success",
        result: {
          code: response.code,
          stdout: response.stdout,
          stderr: response.stderr,
        },
      };
    }
    return {
      kind: "unreachable",
      message: "daemon queue retry loop exhausted",
    };
  } catch {
    removeDaemonMeta();
    return {
      kind: "unreachable",
      message: "daemon request failed",
    };
  }
}

export async function stopDaemonIfRunning(): Promise<boolean> {
  const meta = readAliveDaemonMeta();
  if (!meta) {
    removeDaemonMeta();
    return false;
  }

  try {
    await sendDaemonRequest({
      host: DAEMON_HOST,
      port: meta.port,
      request: {
        token: meta.token,
        kind: "shutdown",
      },
      timeoutMs: DAEMON_PING_TIMEOUT_MS,
    });
  } catch {
    // Fall back to process kill if daemon cannot be reached.
    try {
      providers().runtime.kill(meta.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }

  removeDaemonMeta();
  return true;
}
export { cleanupOwnedDaemonMeta, daemonIdleTimeoutMs, parseDaemonWorkerArgv, runDaemonWorker } from "./worker.js";
