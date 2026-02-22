import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-opportunistic-maint-"));

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_DAEMON: "0",
      SURFWRIGHT_GC_ENABLED: "1",
      SURFWRIGHT_GC_MIN_INTERVAL_MS: "1",
      ...env,
    },
  });
}

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
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
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readState() {
  return JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
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
