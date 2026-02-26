import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("daemon diagnostics verbose events are default-off", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-diag-off-"));
  const eventsPath = path.join(stateDir, "diagnostics", "daemon.ndjson");
  const metricsPath = path.join(stateDir, "diagnostics", "daemon.metrics.ndjson");

  try {
    const result = runCli(["contract"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "1",
    });
    assert.equal(result.status, 0);

    const metrics = readNdjson(metricsPath);
    assert.equal(metrics.length > 0, true);
    assert.equal(metrics.some((entry) => entry.metric === "daemon_request_duration_ms"), true);
    assert.equal(metrics.some((entry) => entry.metric === "daemon_queue_wait_ms"), true);
    assert.equal(metrics.some((entry) => entry.metric === "daemon_worker_rss_mb"), true);

    const events = readNdjson(eventsPath);
    assert.equal(events.length, 0);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("daemon diagnostics verbose events are emitted when debug is enabled", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-diag-on-"));
  const eventsPath = path.join(stateDir, "diagnostics", "daemon.ndjson");

  try {
    const result = runCli(["contract", "--session", "diag-session"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "1",
      SURFWRIGHT_DEBUG_LOGS: "1",
    });
    assert.equal(result.status, 0);

    const events = readNdjson(eventsPath);
    assert.equal(events.length > 0, true);
    const first = events[0];
    assert.equal(typeof first.requestId, "string");
    assert.equal(typeof first.sessionId, "string");
    assert.equal(typeof first.command, "string");
    assert.equal(typeof first.durationMs, "number");
    assert.equal(typeof first.queueWaitMs, "number");
    assert.equal(typeof first.queueScope, "string");
    assert.equal(["success", "typed_error", "timeout", "unreachable", "cancelled"].includes(first.result), true);
    assert.equal("errorCode" in first, true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("daemon diagnostics redact session and token material", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-diag-redact-"));
  const eventsPath = path.join(stateDir, "diagnostics", "daemon.ndjson");
  const rawSessionId = "session-secret-value-123";

  try {
    const result = runCli(["contract", "--session", rawSessionId], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "1",
      SURFWRIGHT_DEBUG_LOGS: "1",
    });
    assert.equal(result.status, 0);

    const eventText = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf8") : "";
    const metaPath = path.join(stateDir, "daemon.json");
    const daemonToken = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")).token : "";

    assert.equal(eventText.includes(rawSessionId), false);
    if (typeof daemonToken === "string" && daemonToken.length > 0) {
      assert.equal(eventText.includes(daemonToken), false);
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
