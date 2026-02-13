import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-network-contract-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

let hasBrowserCache;

function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }

  const result = runCli(["--json", "doctor"]);
  const payload = parseJson(result.stdout);
  if (payload?.chrome?.found !== true) {
    hasBrowserCache = false;
    return hasBrowserCache;
  }

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]);
  hasBrowserCache = ensureResult.status === 0;
  return hasBrowserCache;
}

function cleanupManagedBrowsers() {
  try {
    const statePath = stateFilePath();
    if (!fs.existsSync(statePath)) {
      return;
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object") {
        continue;
      }
      if (session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore already-dead processes
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

process.on("exit", () => {
  cleanupManagedBrowsers();
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("target network returns deterministic JSON shape", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Contract Page</title><main><h1>network ok</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "open",
    dataUrl,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const networkResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "network",
    openPayload.targetId,
    "--capture-ms",
    "250",
    "--max-requests",
    "20",
    "--max-websockets",
    "10",
    "--max-ws-messages",
    "20",
    "--status",
    "2xx",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(networkResult.status, 0);
  const networkPayload = parseJson(networkResult.stdout);
  assert.deepEqual(Object.keys(networkPayload), [
    "ok",
    "sessionId",
    "targetId",
    "url",
    "title",
    "capture",
    "filters",
    "limits",
    "counts",
    "performance",
    "truncated",
    "requests",
    "webSockets",
  ]);
  assert.equal(networkPayload.ok, true);
  assert.equal(networkPayload.sessionId, ensurePayload.sessionId);
  assert.equal(networkPayload.targetId, openPayload.targetId);
  assert.equal(typeof networkPayload.capture.captureMs, "number");
  assert.equal(typeof networkPayload.capture.durationMs, "number");
  assert.equal(networkPayload.filters.status, "2xx");
  assert.equal(Array.isArray(networkPayload.requests), true);
  assert.equal(Array.isArray(networkPayload.webSockets), true);
  assert.equal(typeof networkPayload.performance, "object");
  assert.equal(typeof networkPayload.counts.requestsSeen, "number");
});

test("target network can write HAR artifact metadata", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>HAR Page</title><main><h1>har ok</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "open",
    dataUrl,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const harPath = path.join(TEST_STATE_DIR, "artifacts", "capture.har");
  const networkResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "network",
    openPayload.targetId,
    "--capture-ms",
    "200",
    "--har-out",
    harPath,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(networkResult.status, 0);
  const networkPayload = parseJson(networkResult.stdout);
  assert.equal(typeof networkPayload.har, "object");
  assert.equal(networkPayload.har.path, path.resolve(harPath));
  assert.equal(typeof networkPayload.har.entries, "number");
  assert.equal(typeof networkPayload.har.bytes, "number");
  assert.equal(fs.existsSync(harPath), true);
  const harRaw = fs.readFileSync(harPath, "utf8");
  const harPayload = JSON.parse(harRaw);
  assert.equal(typeof harPayload.log, "object");
  assert.equal(Array.isArray(harPayload.log.entries), true);
});
