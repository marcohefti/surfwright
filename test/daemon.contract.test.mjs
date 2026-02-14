import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-contract-"));

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      ...env,
    },
  });
}

function daemonMetaPath() {
  return path.join(TEST_STATE_DIR, "daemon.json");
}

function readDaemonMeta() {
  try {
    return JSON.parse(fs.readFileSync(daemonMetaPath(), "utf8"));
  } catch {
    return null;
  }
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function stopDaemonIfRunning() {
  const meta = readDaemonMeta();
  if (!meta || typeof meta.pid !== "number") {
    return;
  }
  try {
    process.kill(meta.pid, "SIGTERM");
  } catch {
    // ignore stale daemon pid
  }
  await waitForProcessExit(meta.pid, 1500);
  try {
    fs.unlinkSync(daemonMetaPath());
  } catch {
    // ignore
  }
}

process.on("exit", () => {
  const meta = readDaemonMeta();
  if (meta && typeof meta.pid === "number") {
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test("daemon default path auto-starts and reuses the same worker", () => {
  const first = runCli(["--json", "contract"]);
  assert.equal(first.status, 0);

  const firstMeta = readDaemonMeta();
  assert.notEqual(firstMeta, null);
  assert.equal(typeof firstMeta.pid, "number");
  assert.equal(firstMeta.pid > 0, true);
  assert.equal(isProcessAlive(firstMeta.pid), true);

  const second = runCli(["--json", "contract"]);
  assert.equal(second.status, 0);

  const secondMeta = readDaemonMeta();
  assert.notEqual(secondMeta, null);
  assert.equal(secondMeta.pid, firstMeta.pid);
  assert.equal(isProcessAlive(secondMeta.pid), true);
});

test("daemon idle timeout exits worker and clears metadata", async () => {
  await stopDaemonIfRunning();

  const result = runCli(["--json", "contract"], {
    SURFWRIGHT_DAEMON_IDLE_MS: "500",
  });
  assert.equal(result.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.pid, "number");

  const exited = await waitForProcessExit(meta.pid, 3000);
  assert.equal(exited, true);

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && fs.existsSync(daemonMetaPath())) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(fs.existsSync(daemonMetaPath()), false);
});
