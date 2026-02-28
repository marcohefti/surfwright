import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { readRuntimeState, writeCanonicalState } from "../core/state-storage.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-opportunistic-maint-"));

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_DAEMON: "0",
      SURFWRIGHT_GC_ENABLED: "1",
      SURFWRIGHT_GC_MIN_INTERVAL_MS: "1000",
      ...env,
    },
  });
}

function baseState() {
  return {
    version: 4,
    activeSessionId: null,
    nextSessionOrdinal: 1,
    nextCaptureOrdinal: 1,
    nextArtifactOrdinal: 1,
    sessions: {},
    targets: {},
    networkCaptures: {},
    networkArtifacts: {},
  };
}

function writeState(state) {
  writeCanonicalState(TEST_STATE_DIR, state);
}

function readState() {
  return readRuntimeState(TEST_STATE_DIR);
}

async function waitForBrowserPidCleared(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readState();
    const session = state.sessions[sessionId];
    if (session && session.browserPid === null) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return readState();
}

function isProcessAlive(pid) {
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

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

async function waitForPathMissing(targetPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(targetPath)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return !fs.existsSync(targetPath);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("opportunistic maintenance parks idle managed browser processes without deleting sessions", async () => {
  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  sleeper.unref();

  const pid = sleeper.pid;
  assert.equal(typeof pid, "number");
  assert.equal(isProcessAlive(pid), true);

  try {
    writeState({
      ...baseState(),
      activeSessionId: "m-idle",
      sessions: {
        "m-idle": {
          sessionId: "m-idle",
          kind: "managed",
          policy: "persistent",
          browserMode: "headless",
          cdpOrigin: "http://127.0.0.1:1",
          debugPort: 9222,
          userDataDir: "/tmp/surfwright-m-idle",
          profile: null,
          browserPid: pid,
          ownerId: "agent.test",
          leaseExpiresAt: null,
          leaseTtlMs: 3600000,
          managedUnreachableSince: null,
          managedUnreachableCount: 0,
          createdAt: "2026-02-13T09:00:00.000Z",
          lastSeenAt: "2026-02-13T09:00:00.000Z",
        },
      },
      targets: {},
    });

    const result = runCli(["contract"], {
      SURFWRIGHT_IDLE_PROCESS_TTL_MS: "60000",
    });
    assert.equal(result.status, 0);

    const exited = await waitForProcessExit(pid, 5000);
    assert.equal(exited, true);

    const state = await waitForBrowserPidCleared("m-idle", 3000);
    assert.equal(state.sessions["m-idle"].sessionId, "m-idle");
    assert.equal(state.sessions["m-idle"].browserPid, null);
    assert.equal(state.activeSessionId, "m-idle");
  } finally {
    if (isProcessAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }
});

test("opportunistic maintenance scales idle parking under managed-session pressure without hard limits", async () => {
  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  sleeper.unref();

  const pid = sleeper.pid;
  assert.equal(typeof pid, "number");
  assert.equal(isProcessAlive(pid), true);

  try {
    fs.rmSync(path.join(TEST_STATE_DIR, "opportunistic-gc.stamp"), { force: true });
    fs.rmSync(path.join(TEST_STATE_DIR, "opportunistic-gc.lock"), { force: true });

    const staleSeenAt = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const sessions = {};
    for (let i = 1; i <= 25; i += 1) {
      const sessionId = `m-load-${i}`;
      sessions[sessionId] = {
        sessionId,
        kind: "managed",
        policy: "persistent",
        browserMode: "headless",
        cdpOrigin: `http://127.0.0.1:${9000 + i}`,
        debugPort: 9000 + i,
        userDataDir: `/tmp/surfwright-${sessionId}`,
        profile: null,
        browserPid: i === 1 ? pid : null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: staleSeenAt,
        lastSeenAt: staleSeenAt,
      };
    }

    writeState({
      ...baseState(),
      activeSessionId: "m-load-1",
      sessions,
      targets: {},
    });

    const result = runCli(["contract"]);
    assert.equal(result.status, 0);

    const exited = await waitForProcessExit(pid, 5000);
    assert.equal(exited, true);

    const state = await waitForBrowserPidCleared("m-load-1", 3000);
    assert.equal(state.sessions["m-load-1"].sessionId, "m-load-1");
    assert.equal(state.sessions["m-load-1"].browserPid, null);
    assert.equal(state.sessions["m-load-1"].kind, "managed");
    assert.equal(Object.keys(state.sessions).length, 25);
  } finally {
    if (isProcessAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }
});

test("opportunistic maintenance prunes stale run artifacts in detached worker", async () => {
  writeState(baseState());
  fs.rmSync(path.join(TEST_STATE_DIR, "opportunistic-gc.stamp"), { force: true });
  fs.rmSync(path.join(TEST_STATE_DIR, "opportunistic-gc.lock"), { force: true });
  const runsDir = path.join(TEST_STATE_DIR, "runs");
  const staleRun = path.join(runsDir, "stale-run.json");
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(staleRun, JSON.stringify({ ok: true }), "utf8");
  const oldStamp = new Date(Date.now() - 3 * 60 * 60 * 1000);
  fs.utimesSync(staleRun, oldStamp, oldStamp);

  const result = runCli(["contract"], {
    SURFWRIGHT_GC_RUNS_MAX_AGE_HOURS: "1",
    SURFWRIGHT_GC_DISK_PRUNE_ENABLED: "1",
  });
  assert.equal(result.status, 0);

  const removed = await waitForPathMissing(staleRun, 4000);
  assert.equal(removed, true);
});

test("opportunistic maintenance cleans stale daemon metadata in detached worker", async () => {
  writeState(baseState());
  fs.rmSync(path.join(TEST_STATE_DIR, "opportunistic-gc.stamp"), { force: true });
  fs.rmSync(path.join(TEST_STATE_DIR, "opportunistic-gc.lock"), { force: true });
  const daemonMetaPath = path.join(TEST_STATE_DIR, "daemon.json");
  fs.writeFileSync(
    daemonMetaPath,
    `${JSON.stringify({
      version: 1,
      pid: 2147483647,
      host: "127.0.0.1",
      port: 49997,
      token: "stale-token",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  if (process.platform !== "win32") {
    fs.chmodSync(daemonMetaPath, 0o600);
  }

  const result = runCli(["contract"], {
    SURFWRIGHT_GC_DISK_PRUNE_ENABLED: "0",
  });
  assert.equal(result.status, 0);

  const removed = await waitForPathMissing(daemonMetaPath, 4000);
  assert.equal(removed, true);
});
