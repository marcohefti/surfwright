import fs from "node:fs";
import process from "node:process";
import { CliError } from "../../errors.js";

function readLockTimestampMs(lockPath: string): number | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: unknown } | null;
    if (parsed && typeof parsed.createdAt === "string") {
      const t = Date.parse(parsed.createdAt);
      if (Number.isFinite(t)) {
        return t;
      }
    }
  } catch {
    // fall back to file mtime
  }
  try {
    const stat = fs.statSync(lockPath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

function parseLockOwnerPid(lockPath: string): number | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
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

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearStaleLock(lockPath: string, staleMs: number): boolean {
  const createdMs = readLockTimestampMs(lockPath);
  const ownerPid = parseLockOwnerPid(lockPath);
  if (typeof ownerPid === "number" && ownerPid > 0 && isPidAlive(ownerPid)) {
    return false;
  }
  if (createdMs === null) {
    if (typeof ownerPid === "number" && ownerPid > 0) {
      try {
        fs.unlinkSync(lockPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Date.now() - createdMs < staleMs) {
    if (typeof ownerPid === "number" && ownerPid > 0) {
      try {
        fs.unlinkSync(lockPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function tryCreateLock(lockPath: string, nowIso: () => string): boolean {
  try {
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: nowIso() })}\n`, "utf8");
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      return false;
    }
    throw new CliError("E_STATE_LOCK_IO", `Failed to create state lock: ${err.message ?? "unknown error"}`, {
      hints: [
        "Verify SURFWRIGHT_STATE_DIR is writable.",
        "If no SurfWright process is active, remove stale lock and retry.",
      ],
      hintContext: {
        lockPath,
      },
    });
  }
}

function releaseLock(lockPath: string) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore missing lock on release
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withStateFileLock<T>(
  opts: {
    rootDir: string;
    lockPath: string;
    timeoutMs: number;
    retryMs: number;
    staleMs: number;
    nowIso: () => string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  fs.mkdirSync(opts.rootDir, { recursive: true });
  const waitStartedMs = Date.now();
  const deadline = Date.now() + opts.timeoutMs;
  while (true) {
    if (tryCreateLock(opts.lockPath, opts.nowIso)) {
      try {
        return await fn();
      } finally {
        releaseLock(opts.lockPath);
      }
    }
    clearStaleLock(opts.lockPath, opts.staleMs);
    if (Date.now() >= deadline) {
      const ownerPid = parseLockOwnerPid(opts.lockPath);
      const ownerAlive = typeof ownerPid === "number" ? isPidAlive(ownerPid) : null;
      if (ownerAlive === false) {
        clearStaleLock(opts.lockPath, opts.staleMs);
        if (tryCreateLock(opts.lockPath, opts.nowIso)) {
          try {
            return await fn();
          } finally {
            releaseLock(opts.lockPath);
          }
        }
      }
      const lockCreatedMs = readLockTimestampMs(opts.lockPath);
      const lockAgeMs = typeof lockCreatedMs === "number" ? Math.max(0, Date.now() - lockCreatedMs) : null;
      throw new CliError("E_STATE_LOCK_TIMEOUT", "Timed out waiting for state lock", {
        hints: [
          "If no SurfWright command is running, remove stale lock and retry.",
          "For parallel runs, assign a dedicated SURFWRIGHT_STATE_DIR per process.",
          "Run `surfwright doctor` to confirm environment health before retrying.",
        ],
        hintContext: {
          lockPath: opts.lockPath,
          lockAgeMs,
          timeoutMs: opts.timeoutMs,
          waitMs: Math.max(0, Date.now() - waitStartedMs),
          lockOwnerPid: ownerPid ?? null,
          lockOwnerAlive: ownerAlive,
          stateRoot: opts.rootDir,
        },
      });
    }
    await sleep(opts.retryMs);
  }
}
