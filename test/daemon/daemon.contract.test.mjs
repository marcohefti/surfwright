import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-contract-"));
const MAX_FRAME_BYTES = 1024 * 1024 * 4;

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      // Keep daemon expectations deterministic even if a developer shell disables proxying.
      SURFWRIGHT_DAEMON: "1",
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

async function sendRawDaemonLine(port, line) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setEncoding("utf8");
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for daemon raw response"));
    }, 2000);

    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(`${line}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      clearTimeout(timer);
      socket.end();
      resolve(buffer.slice(0, newlineIndex));
    });
  });
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
  const first = runCli(["session", "list"]);
  assert.equal(first.status, 0);

  const firstMeta = readDaemonMeta();
  assert.notEqual(firstMeta, null);
  assert.equal(typeof firstMeta.pid, "number");
  assert.equal(firstMeta.pid > 0, true);
  assert.equal(isProcessAlive(firstMeta.pid), true);

  const second = runCli(["session", "list"]);
  assert.equal(second.status, 0);

  const secondMeta = readDaemonMeta();
  assert.notEqual(secondMeta, null);
  assert.equal(secondMeta.pid, firstMeta.pid);
  assert.equal(isProcessAlive(secondMeta.pid), true);
});

test("daemon startup cleans stale metadata and replaces it with a live worker record", async () => {
  await stopDaemonIfRunning();
  const stalePid = 2147483647;
  const staleToken = "stale-token";
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(
    daemonMetaPath(),
    `${JSON.stringify({
      version: 1,
      pid: stalePid,
      host: "127.0.0.1",
      port: 49997,
      token: staleToken,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  if (process.platform !== "win32") {
    fs.chmodSync(daemonMetaPath(), 0o600);
  }

  const result = runCli(["session", "list"]);
  assert.equal(result.status, 0);

  const freshMeta = readDaemonMeta();
  assert.notEqual(freshMeta, null);
  assert.equal(typeof freshMeta.pid, "number");
  assert.equal(freshMeta.pid > 0, true);
  assert.notEqual(freshMeta.pid, stalePid);
  assert.notEqual(freshMeta.token, staleToken);
  assert.equal(isProcessAlive(freshMeta.pid), true);
});

test("daemon idle timeout exits worker and clears metadata", async () => {
  await stopDaemonIfRunning();

  const result = runCli(["session", "list"], {
    // Keep this comfortably above typical process startup jitter so the daemon
    // doesn't exit before we can read metadata under parallel test load.
    SURFWRIGHT_DAEMON_IDLE_MS: "2000",
  });
  assert.equal(result.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.pid, "number");

  const exited = await waitForProcessExit(meta.pid, 8000);
  assert.equal(exited, true);

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && fs.existsSync(daemonMetaPath())) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(fs.existsSync(daemonMetaPath()), false);
});

test("daemon idle shutdown closes half-open sockets so worker exits cleanly", async () => {
  await stopDaemonIfRunning();

  const start = runCli(["session", "list"], {
    SURFWRIGHT_DAEMON_IDLE_MS: "300",
  });
  assert.equal(start.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.pid, "number");
  assert.equal(typeof meta.port, "number");
  assert.equal(typeof meta.token, "string");

  const stuckClient = net.createConnection({ host: "127.0.0.1", port: meta.port });
  await new Promise((resolve, reject) => {
    stuckClient.once("error", reject);
    stuckClient.once("connect", resolve);
  });
  // Deliberately keep the frame incomplete so the connection stays half-open.
  stuckClient.write(`{"token":"${meta.token}"`);

  const exited = await waitForProcessExit(meta.pid, 8000);
  assert.equal(exited, true);

  stuckClient.destroy();

  const removed = await waitForPathMissing(daemonMetaPath(), 2000);
  assert.equal(removed, true);
});

test("daemon rejects oversized request frames without wedging", async () => {
  await stopDaemonIfRunning();

  const first = runCli(["session", "list"]);
  assert.equal(first.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.pid, "number");
  assert.equal(typeof meta.port, "number");
  assert.equal(isProcessAlive(meta.pid), true);

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: meta.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw daemon socket did not close after oversized frame"));
    }, 2000);

    socket.on("error", () => {
      // server may drop connection abruptly; that's expected
    });

    socket.on("connect", () => {
      socket.write(Buffer.alloc(MAX_FRAME_BYTES + 1024, 0x61));
    });

    socket.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  assert.equal(isProcessAlive(meta.pid), true);

  const second = runCli(["session", "list"]);
  assert.equal(second.status, 0);

  const secondMeta = readDaemonMeta();
  assert.notEqual(secondMeta, null);
  assert.equal(secondMeta.pid, meta.pid);
  assert.equal(isProcessAlive(secondMeta.pid), true);
});

test("daemon enforces one-request-per-connection", async () => {
  await stopDaemonIfRunning();
  const start = runCli(["session", "list"]);
  assert.equal(start.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.port, "number");
  assert.equal(typeof meta.token, "string");

  const payload = [
    JSON.stringify({ token: meta.token, kind: "ping" }),
    JSON.stringify({ token: "bad-token", kind: "ping" }),
  ].join("\n");
  const line = await sendRawDaemonLine(meta.port, payload);
  const parsed = JSON.parse(line);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, "pong");

  const followUp = runCli(["session", "list"]);
  assert.equal(followUp.status, 0);
});

test("daemon returns typed token-invalid response for invalid token", async () => {
  await stopDaemonIfRunning();
  const start = runCli(["session", "list"]);
  assert.equal(start.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.port, "number");

  const line = await sendRawDaemonLine(meta.port, JSON.stringify({ token: "invalid-token", kind: "ping" }));
  const parsed = JSON.parse(line);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "E_DAEMON_TOKEN_INVALID");
});

test("daemon returns E_DAEMON_REQUEST_INVALID for malformed request payload", async () => {
  await stopDaemonIfRunning();
  const start = runCli(["session", "list"]);
  assert.equal(start.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.port, "number");

  const line = await sendRawDaemonLine(meta.port, "{not-json");
  const parsed = JSON.parse(line);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "E_DAEMON_REQUEST_INVALID");
});

test("daemon typed failures are deterministic for repeated invalid-token requests", async () => {
  await stopDaemonIfRunning();
  const start = runCli(["session", "list"]);
  assert.equal(start.status, 0);

  const meta = readDaemonMeta();
  assert.notEqual(meta, null);
  assert.equal(typeof meta.port, "number");

  const first = JSON.parse(await sendRawDaemonLine(meta.port, JSON.stringify({ token: "bad-token", kind: "ping" })));
  const second = JSON.parse(await sendRawDaemonLine(meta.port, JSON.stringify({ token: "bad-token", kind: "ping" })));

  assert.deepEqual(Object.keys(first).sort(), ["code", "message", "ok"]);
  assert.deepEqual(second, first);
});

test("json-mode failures do not emit stack traces by default", () => {
  const result = runCli(["open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim().length, 0);
  assert.equal(/\n\s+at\s+/.test(result.stdout), false);
});
