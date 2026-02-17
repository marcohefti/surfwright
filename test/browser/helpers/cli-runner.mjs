import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TIMEOUT_GRACE_MS = 10_000;
const MAX_SPAWN_TIMEOUT_MS = 120_000;

function parseCliTimeoutMs(args) {
  if (!Array.isArray(args)) {
    return null;
  }

  let value = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--timeout-ms") {
      continue;
    }
    const raw = args[i + 1];
    const parsed = raw ? Number.parseInt(String(raw), 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      value = parsed;
    }
  }
  return value;
}

function deriveSpawnTimeoutMs(args, opts = {}) {
  const cliTimeoutMs = parseCliTimeoutMs(args);
  const fallbackMs = Number.isFinite(Number(opts.fallbackMs)) ? Number(opts.fallbackMs) : DEFAULT_SPAWN_TIMEOUT_MS;
  const graceMs = Number.isFinite(Number(opts.graceMs)) ? Number(opts.graceMs) : SPAWN_TIMEOUT_GRACE_MS;
  const raw = cliTimeoutMs !== null ? cliTimeoutMs + graceMs : fallbackMs;
  return Math.max(250, Math.min(MAX_SPAWN_TIMEOUT_MS, raw));
}

function terminatePid(pid, signal) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return;
  }

  // Try group kill first so subprocesses don't outlive the parent.
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
    } catch {
      // ignore and try the pid directly
    }
  }

  try {
    process.kill(pid, signal);
  } catch {
    // ignore already-dead processes
  }
}

export function createCliRunner(opts) {
  if (!opts || typeof opts !== "object") {
    throw new Error("createCliRunner: opts is required");
  }
  if (typeof opts.stateDir !== "string" || opts.stateDir.trim().length === 0) {
    throw new Error("createCliRunner: opts.stateDir is required");
  }

  const baseEnv = {
    ...process.env,
    SURFWRIGHT_STATE_DIR: opts.stateDir,
    SURFWRIGHT_TEST_BROWSER: "1",
    ...(opts.env ?? {}),
  };

  return {
    runCliSync: (args, extra = {}) => {
      const timeoutMs =
        typeof extra.timeoutMs === "number" && Number.isFinite(extra.timeoutMs) && extra.timeoutMs > 0
          ? extra.timeoutMs
          : deriveSpawnTimeoutMs(args);

      return spawnSync(process.execPath, ["dist/cli.js", ...args], {
        encoding: "utf8",
        env: { ...baseEnv, ...(extra.env ?? {}) },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      });
    },

    runCliAsync: (args, extra = {}) =>
      new Promise((resolve, reject) => {
        const timeoutMs =
          typeof extra.timeoutMs === "number" && Number.isFinite(extra.timeoutMs) && extra.timeoutMs > 0
            ? extra.timeoutMs
            : deriveSpawnTimeoutMs(args);

        const child = spawn(process.execPath, ["dist/cli.js", ...args], {
          env: { ...baseEnv, ...(extra.env ?? {}) },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });

        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });

        const timer = setTimeout(() => {
          terminatePid(child.pid, "SIGTERM");
          setTimeout(() => terminatePid(child.pid, "SIGKILL"), 200);
        }, timeoutMs);

        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        child.on("close", (code, signal) => {
          clearTimeout(timer);
          resolve({
            status: typeof code === "number" ? code : 1,
            stdout,
            stderr: signal ? `${stderr}\n[runner] cli exited via signal ${signal}\n` : stderr,
            signal,
          });
        });
      }),

    deriveSpawnTimeoutMs,
  };
}

