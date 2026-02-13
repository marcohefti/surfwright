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
    "captureId",
    "url",
    "title",
    "capture",
    "filters",
    "view",
    "fields",
    "tableRows",
    "limits",
    "counts",
    "performance",
    "truncated",
    "hints",
    "insights",
    "requests",
    "webSockets",
  ]);
  assert.equal(networkPayload.ok, true);
  assert.equal(networkPayload.sessionId, ensurePayload.sessionId);
  assert.equal(networkPayload.targetId, openPayload.targetId);
  assert.equal(typeof networkPayload.capture.captureMs, "number");
  assert.equal(typeof networkPayload.capture.durationMs, "number");
  assert.equal(networkPayload.filters.status, "2xx");
  assert.equal(networkPayload.filters.profile, "custom");
  assert.equal(Array.isArray(networkPayload.requests), true);
  assert.equal(Array.isArray(networkPayload.webSockets), true);
  assert.equal(Array.isArray(networkPayload.tableRows), true);
  assert.equal(typeof networkPayload.hints, "object");
  assert.equal(typeof networkPayload.insights, "object");
  assert.equal(typeof networkPayload.performance, "object");
  assert.equal(typeof networkPayload.counts.requestsSeen, "number");
});

test("target network-export writes HAR artifact metadata", { skip: !hasBrowser() }, () => {
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
    "network-export",
    openPayload.targetId,
    "--out",
    harPath,
    "--capture-ms",
    "200",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(networkResult.status, 0);
  const networkPayload = parseJson(networkResult.stdout);
  assert.deepEqual(Object.keys(networkPayload), ["ok", "sessionId", "targetId", "url", "title", "format", "artifact", "source"]);
  assert.equal(networkPayload.format, "har");
  assert.equal(typeof networkPayload.artifact, "object");
  assert.equal(networkPayload.artifact.path, path.resolve(harPath));
  assert.equal(typeof networkPayload.artifact.entries, "number");
  assert.equal(typeof networkPayload.artifact.bytes, "number");
  assert.equal(fs.existsSync(harPath), true);
  const harRaw = fs.readFileSync(harPath, "utf8");
  const harPayload = JSON.parse(harRaw);
  assert.equal(typeof harPayload.log, "object");
  assert.equal(Array.isArray(harPayload.log.entries), true);
});

test("target network begin/end returns capture handle and projected report", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Handle Page</title><main><h1>handle ok</h1></main>`;
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

  const beginResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "network-begin",
    openPayload.targetId,
    "--profile",
    "api",
    "--max-runtime-ms",
    "10000",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(beginResult.status, 0);
  const beginPayload = parseJson(beginResult.stdout);
  assert.equal(beginPayload.ok, true);
  assert.equal(typeof beginPayload.captureId, "string");
  assert.equal(beginPayload.status, "recording");

  const endResult = runCli([
    "--json",
    "target",
    "network-end",
    beginPayload.captureId,
    "--view",
    "summary",
    "--timeout-ms",
    "8000",
  ]);
  assert.equal(endResult.status, 0);
  const endPayload = parseJson(endResult.stdout);
  assert.equal(endPayload.ok, true);
  assert.equal(endPayload.captureId, beginPayload.captureId);
  assert.equal(typeof endPayload.status, "string");
  assert.equal(endPayload.view, "summary");
});

test("target network-export-list returns indexed artifacts", () => {
  const listResult = runCli(["--json", "target", "network-export-list", "--limit", "5"]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.deepEqual(Object.keys(listPayload), ["ok", "total", "returned", "artifacts"]);
  assert.equal(typeof listPayload.total, "number");
  assert.equal(typeof listPayload.returned, "number");
  assert.equal(Array.isArray(listPayload.artifacts), true);
});
