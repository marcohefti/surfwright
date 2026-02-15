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

function writeState(state) {
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
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
    "sessionSource",
    "targetId",
    "captureId",
    "actionId",
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
  assert.equal(networkPayload.sessionSource, "explicit");
  assert.equal(networkPayload.targetId, openPayload.targetId);
  assert.equal(typeof networkPayload.actionId, "string");
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
  assert.deepEqual(Object.keys(networkPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "url",
    "title",
    "format",
    "artifact",
    "source",
  ]);
  assert.equal(networkPayload.sessionSource, "explicit");
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
  assert.equal(typeof beginPayload.actionId, "string");
  assert.equal(beginPayload.status, "recording");

  const endResult = runCli([
    "--json",
    "target",
    "network-end",
    beginPayload.captureId,
    "--view",
    "summary",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(endResult.status, 0);
  const endPayload = parseJson(endResult.stdout);
  assert.equal(endPayload.ok, true);
  assert.equal(endPayload.captureId, beginPayload.captureId);
  assert.equal(typeof endPayload.status, "string");
  assert.equal(endPayload.view, "summary");
});

test("target network-end finalizes state and returns typed failure when done status is failed and result is missing", () => {
  cleanupManagedBrowsers();

  const captureId = "c-1";
  const donePath = path.join(TEST_STATE_DIR, "captures", `${captureId}.done.json`);
  const stopPath = path.join(TEST_STATE_DIR, "captures", `${captureId}.stop`);
  const resultPath = path.join(TEST_STATE_DIR, "captures", `${captureId}.result.json`);
  fs.mkdirSync(path.dirname(donePath), { recursive: true });
  fs.writeFileSync(donePath, `${JSON.stringify({ status: "failed", endedAt: "2026-02-15T00:00:00.000Z", message: "boom" })}\n`, "utf8");

  writeState({
    version: 2,
    activeSessionId: null,
    nextSessionOrdinal: 1,
    nextCaptureOrdinal: 2,
    nextArtifactOrdinal: 1,
    sessions: {},
    targets: {},
    networkCaptures: {
      [captureId]: {
        captureId,
        sessionId: "s-1",
        targetId: "t-1",
        startedAt: "2026-02-15T00:00:00.000Z",
        status: "recording",
        profile: "custom",
        maxRuntimeMs: 10000,
        workerPid: 12345,
        stopSignalPath: stopPath,
        donePath,
        resultPath,
        endedAt: null,
        actionId: "a-1",
      },
    },
    networkArtifacts: {},
  });

  const endResult = runCli(["--json", "target", "network-end", captureId, "--timeout-ms", "500"]);
  assert.equal(endResult.status, 1);
  const failure = parseJson(endResult.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "E_INTERNAL");

  const state = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
  assert.equal(state.networkCaptures[captureId].status, "failed");
  assert.equal(typeof state.networkCaptures[captureId].endedAt, "string");
  assert.equal(state.networkCaptures[captureId].endedAt.length > 0, true);
  assert.equal(state.networkCaptures[captureId].workerPid, null);
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

test("target network-query/check/export-prune work on saved sources", () => {
  const capturePath = path.join(TEST_STATE_DIR, "captures", "c-1.result.json");
  const artifactPath = path.join(TEST_STATE_DIR, "artifacts", "a-1.har");
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(
    capturePath,
    JSON.stringify({
      ok: true,
      sessionId: "s-1",
      targetId: "t-1",
      captureId: "c-1",
      actionId: "a-1",
      url: "https://example.com",
      title: "Example",
      capture: { startedAt: "2026-02-13T10:00:00.000Z", endedAt: "2026-02-13T10:00:01.000Z", durationMs: 1000, captureMs: 1000, reload: false },
      filters: { urlContains: null, method: null, resourceType: null, status: null, failedOnly: false, profile: "custom" },
      view: "raw",
      fields: ["id", "method", "status", "durationMs", "url"],
      tableRows: [],
      limits: { maxRequests: 10, maxWebSockets: 5, maxWsMessages: 10 },
      counts: {
        requestsSeen: 1,
        requestsReturned: 1,
        responsesSeen: 1,
        failedSeen: 0,
        webSocketsSeen: 0,
        webSocketsReturned: 0,
        wsMessagesSeen: 0,
        wsMessagesReturned: 0,
        droppedRequests: 0,
        droppedWebSockets: 0,
        droppedWsMessages: 0,
      },
      performance: {
        completedRequests: 1,
        bytesApproxTotal: 120,
        statusBuckets: { "2xx": 1, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
        latencyMs: { min: 24, max: 24, avg: 24, p50: 24, p95: 24 },
        ttfbMs: { min: 8, max: 8, avg: 8, p50: 8, p95: 8 },
        slowest: [{ id: 1, url: "https://example.com/api", resourceType: "xhr", status: 200, durationMs: 24 }],
      },
      truncated: { requests: false, webSockets: false, wsMessages: false },
      hints: { shouldRecapture: false, suggested: { maxRequests: 10, maxWebSockets: 5, maxWsMessages: 10 } },
      insights: { topHosts: [], errorHotspots: [], websocketHotspots: [] },
      requests: [
        {
          id: 1,
          captureKey: "c-1:req:1",
          actionId: "a-1",
          redirectedFromId: null,
          url: "https://example.com/api",
          method: "GET",
          resourceType: "xhr",
          navigation: false,
          startMs: 2,
          endMs: 26,
          durationMs: 24,
          ttfbMs: 8,
          status: 200,
          ok: true,
          failure: null,
          bytesApprox: 120,
        },
      ],
      webSockets: [],
    }),
    "utf8",
  );
  fs.writeFileSync(artifactPath, JSON.stringify({ log: { version: "1.2", creator: { name: "surfwright" }, pages: [], entries: [] } }), "utf8");
  writeState({
    version: 2,
    activeSessionId: null,
    nextSessionOrdinal: 1,
    nextCaptureOrdinal: 2,
    nextArtifactOrdinal: 2,
    sessions: {},
    targets: {},
    networkCaptures: {
      "c-1": {
        captureId: "c-1",
        sessionId: "s-1",
        targetId: "t-1",
        startedAt: "2026-02-13T10:00:00.000Z",
        status: "stopped",
        profile: "custom",
        maxRuntimeMs: 10000,
        workerPid: null,
        stopSignalPath: path.join(TEST_STATE_DIR, "captures", "c-1.stop"),
        donePath: path.join(TEST_STATE_DIR, "captures", "c-1.done.json"),
        resultPath: capturePath,
        endedAt: "2026-02-13T10:00:01.000Z",
        actionId: "a-1",
      },
    },
    networkArtifacts: {
      "na-1": {
        artifactId: "na-1",
        createdAt: "2020-01-01T00:00:00.000Z",
        format: "har",
        path: artifactPath,
        sessionId: "s-1",
        targetId: "t-1",
        captureId: null,
        entries: 0,
        bytes: 42,
      },
    },
  });

  const queryResult = runCli(["--json", "target", "network-query", "--capture-id", "c-1", "--preset", "slowest"]);
  assert.equal(queryResult.status, 0);
  const queryPayload = parseJson(queryResult.stdout);
  assert.equal(queryPayload.ok, true);
  assert.equal(queryPayload.source.id, "c-1");
  assert.equal(queryPayload.preset, "slowest");
  assert.equal(Array.isArray(queryPayload.rows), true);

  const budgetPath = path.join(TEST_STATE_DIR, "budget.json");
  fs.writeFileSync(budgetPath, JSON.stringify({ maxP95LatencyMs: 100, maxErrorRate: 0.2 }), "utf8");
  const checkResult = runCli(["--json", "target", "network-check", "--capture-id", "c-1", "--budget", budgetPath]);
  assert.equal(checkResult.status, 0);
  const checkPayload = parseJson(checkResult.stdout);
  assert.equal(checkPayload.ok, true);
  assert.equal(typeof checkPayload.passed, "boolean");
  assert.equal(Array.isArray(checkPayload.checks), true);

  const pruneResult = runCli(["--json", "target", "network-export-prune", "--max-age-hours", "24"]);
  assert.equal(pruneResult.status, 0);
  const prunePayload = parseJson(pruneResult.stdout);
  assert.equal(prunePayload.ok, true);
  assert.equal(prunePayload.removed >= 1, true);
});
