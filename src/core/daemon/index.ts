import { allocateFreePort } from "../browser.js";
import { stateRootDir } from "../state/index.js";
import { providers } from "../providers/index.js";

const DAEMON_META_VERSION = 1;
const DAEMON_HOST = "127.0.0.1";
const DAEMON_STARTUP_TIMEOUT_MS = 4500;
const DAEMON_REQUEST_TIMEOUT_MS = 120000;
const DAEMON_PING_TIMEOUT_MS = 250;
const DAEMON_RETRY_DELAY_MS = 60;
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

function readDaemonMeta(): DaemonMeta | null {
  try {
    const { fs, runtime } = providers();
    if (runtime.platform !== "win32") {
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
      parsed.token.length === 0 ||
      typeof parsed.startedAt !== "string" ||
      parsed.startedAt.length === 0
    ) {
      return null;
    }
    return {
      version: DAEMON_META_VERSION,
      pid: parsePositiveInt(parsed.pid) ?? 0,
      host: parsed.host,
      port: parsePositiveInt(parsed.port) ?? 0,
      token: parsed.token,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function writeDaemonMeta(meta: DaemonMeta): void {
  const { fs, runtime } = providers();
  const root = stateRootDir();
  fs.mkdirSync(root, { recursive: true });
  const metaPath = daemonMetaPath();
  fs.writeFileSync(metaPath, `${JSON.stringify(meta)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (runtime.platform !== "win32") {
    try {
      fs.chmodSync(metaPath, 0o600);
    } catch {
      // best-effort: chmod may fail on some filesystems
    }
  }
}

function removeDaemonMeta(): void {
  try {
    providers().fs.unlinkSync(daemonMetaPath());
  } catch {
    // ignore missing metadata
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    providers().runtime.kill(pid, 0);
    return true;
  } catch {
    return false;
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

async function sendDaemonRequest(meta: DaemonMeta, request: DaemonRequest, timeoutMs: number): Promise<DaemonResponse> {
  return await new Promise<DaemonResponse>((resolve, reject) => {
    const socket = providers().net.createConnection({ host: DAEMON_HOST, port: meta.port });
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
    }, timeoutMs);

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
      socket.write(`${JSON.stringify(request)}\n`);
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

async function tryPing(meta: DaemonMeta): Promise<boolean> {
  try {
    const response = await sendDaemonRequest(
      meta,
      {
        token: meta.token,
        kind: "ping",
      },
      DAEMON_PING_TIMEOUT_MS,
    );
    return response.ok === true && response.kind === "pong";
  } catch {
    return false;
  }
}

async function waitForDaemonReady(meta: DaemonMeta, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryPing(meta)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, DAEMON_RETRY_DELAY_MS));
  }
  return false;
}

async function startDaemon(entryScriptPath: string): Promise<boolean> {
  const existing = readAliveDaemonMeta();
  if (existing) {
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

  const ready = await waitForDaemonReady(meta, DAEMON_STARTUP_TIMEOUT_MS);
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

export async function runViaDaemon(argv: string[], entryScriptPath: string): Promise<DaemonRunResult | null> {
  if (!daemonProxyEnabled()) {
    return null;
  }

  let meta = readAliveDaemonMeta();
  if (!meta) {
    const started = await startDaemon(entryScriptPath);
    if (!started) {
      return null;
    }
    meta = readAliveDaemonMeta();
    if (!meta) {
      return null;
    }
  }

  try {
    const response = await sendDaemonRequest(
      meta,
      {
        token: meta.token,
        kind: "run",
        argv,
      },
      DAEMON_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      return null;
    }
    if (response.kind !== "run") {
      return null;
    }
    return {
      code: response.code,
      stdout: response.stdout,
      stderr: response.stderr,
    };
  } catch {
    removeDaemonMeta();
    return null;
  }
}

export async function stopDaemonIfRunning(): Promise<boolean> {
  const meta = readAliveDaemonMeta();
  if (!meta) {
    removeDaemonMeta();
    return false;
  }

  try {
    await sendDaemonRequest(
      meta,
      {
        token: meta.token,
        kind: "shutdown",
      },
      DAEMON_PING_TIMEOUT_MS,
    );
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
