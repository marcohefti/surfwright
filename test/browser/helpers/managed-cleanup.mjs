import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { readRuntimeStateIfExists } from "../../core/state-storage.mjs";

function pidIsAlive(pid) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegexLiteral(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function terminatePid(pid) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return;
  }
  // Managed sessions launch Chrome detached, so the pid is the process group leader on POSIX.
  // Kill the group first to avoid leaking Chrome helper processes.
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // ignore and try the pid directly
    }
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore already-dead processes
  }
}

export function cleanupManagedBrowsers(stateDir) {
  try {
    const state = readRuntimeStateIfExists(stateDir);
    if (!state) {
      return;
    }
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object") {
        continue;
      }
      if (session.kind !== "managed") {
        continue;
      }
      terminatePid(session.browserPid);
    }
  } catch {
    // ignore cleanup failures
  }
}

export async function cleanupStateDir(stateDir, opts = {}) {
  const timeoutMs = Math.max(250, Math.min(5000, Number(opts?.timeoutMs ?? 1500)));
  const pids = new Set();

  try {
    const state = readRuntimeStateIfExists(stateDir);
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object" || session.kind !== "managed") {
        continue;
      }
      const pid = session.browserPid;
      if (typeof pid === "number" && Number.isFinite(pid) && pid > 0) {
        pids.add(pid);
      }
    }
  } catch {
    // ignore state parsing failures and still attempt to remove the directory
  }

  const pidList = [...pids];
  for (const pid of pidList) {
    terminatePid(pid);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stillAlive = pidList.some((pid) => pidIsAlive(pid));
    if (!stillAlive) {
      break;
    }
    await sleep(50);
  }

  const stillAlive = pidList.filter((pid) => pidIsAlive(pid));
  for (const pid of stillAlive) {
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  const killDeadline = Date.now() + Math.min(750, timeoutMs);
  while (stillAlive.length > 0 && Date.now() < killDeadline) {
    if (stillAlive.every((pid) => !pidIsAlive(pid))) {
      break;
    }
    await sleep(50);
  }

  // Fallback: if state storage is missing/corrupt we may not have pids. On POSIX, pkill on the unique
  // stateDir path is a reliable last resort to prevent leaked Chrome helpers from snowballing.
  if (process.platform !== "win32") {
    try {
      const pattern = escapeRegexLiteral(stateDir);
      spawnSync("pkill", ["-TERM", "-f", pattern], { stdio: "ignore" });
      await sleep(150);
      spawnSync("pkill", ["-KILL", "-f", pattern], { stdio: "ignore" });
    } catch {
      // ignore missing pkill or other cleanup failures
    }
  }

  try {
    fs.rmSync(stateDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

export function registerExitCleanup(stateDir, opts = {}) {
  const removeStateDir = opts?.removeStateDir !== false;
  process.on("exit", () => {
    cleanupManagedBrowsers(stateDir);
    if (!removeStateDir) {
      return;
    }
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });
}
