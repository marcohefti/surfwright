import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-session-clear-"));

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

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function writeState(state) {
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readState() {
  return JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("session clear resets state and supports explicit keep-processes mode", () => {
  writeState({
    version: 4,
    activeSessionId: "m-main",
    nextSessionOrdinal: 1,
    nextCaptureOrdinal: 1,
    nextArtifactOrdinal: 1,
    sessions: {
      "a-main": {
        sessionId: "a-main",
        kind: "attached",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9222,
        userDataDir: null,
        browserPid: null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
      "m-main": {
        sessionId: "m-main",
        kind: "managed",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9223,
        userDataDir: "/tmp/surfwright-m-main",
        browserPid: null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
    },
    targets: {
      "t-main": {
        targetId: "t-main",
        sessionId: "m-main",
        url: "https://example.com",
        title: "example",
        status: 200,
        updatedAt: "2026-02-13T09:10:00.000Z",
      },
    },
    networkCaptures: {
      "cap-1": {
        captureId: "cap-1",
        sessionId: "m-main",
        targetId: "t-main",
        startedAt: "2026-02-13T09:00:00.000Z",
        status: "running",
        profile: "custom",
        maxRuntimeMs: 1000,
        workerPid: null,
        stopSignalPath: "/tmp/stop",
        donePath: "/tmp/done",
        resultPath: "/tmp/result",
        endedAt: null,
        actionId: "a-1",
      },
    },
    networkArtifacts: {
      "art-1": {
        artifactId: "art-1",
        createdAt: "2026-02-13T09:00:00.000Z",
        format: "har",
        path: "/tmp/a.har",
        sessionId: "m-main",
        targetId: "t-main",
        captureId: "cap-1",
        entries: 1,
        bytes: 100,
      },
    },
  });

  const clearResult = runCli(["session", "clear", "--keep-processes", "--timeout-ms", "200"]);
  assert.equal(clearResult.status, 0);
  const payload = parseJson(clearResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.activeSessionId, null);
  assert.equal(payload.scanned, 2);
  assert.equal(payload.cleared, 2);
  assert.equal(payload.clearedManaged, 1);
  assert.equal(payload.clearedAttached, 1);
  assert.equal(payload.keepProcesses, true);
  assert.equal(payload.processShutdown.requested, 0);
  assert.equal(payload.processShutdown.succeeded, 0);
  assert.equal(payload.processShutdown.failed, 0);
  assert.equal(payload.targetsRemoved, 1);
  assert.equal(payload.networkCapturesRemoved, 1);
  assert.equal(payload.networkArtifactsRemoved, 1);

  const finalState = readState();
  assert.equal(finalState.activeSessionId, null);
  assert.deepEqual(finalState.sessions, {});
  assert.deepEqual(finalState.targets, {});
  assert.deepEqual(finalState.networkCaptures, {});
  assert.deepEqual(finalState.networkArtifacts, {});
});

test("session clear can scope cleanup to one session", () => {
  writeState({
    version: 4,
    activeSessionId: "m-main",
    nextSessionOrdinal: 3,
    nextCaptureOrdinal: 3,
    nextArtifactOrdinal: 3,
    sessions: {
      "a-main": {
        sessionId: "a-main",
        kind: "attached",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9222,
        userDataDir: null,
        browserPid: null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
      "m-main": {
        sessionId: "m-main",
        kind: "managed",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9223,
        userDataDir: "/tmp/surfwright-m-main",
        browserPid: null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
    },
    targets: {
      "t-a": {
        targetId: "t-a",
        sessionId: "a-main",
        url: "https://example.com/a",
        title: "A",
        status: 200,
        updatedAt: "2026-02-13T09:10:00.000Z",
      },
      "t-m": {
        targetId: "t-m",
        sessionId: "m-main",
        url: "https://example.com/m",
        title: "M",
        status: 200,
        updatedAt: "2026-02-13T09:10:00.000Z",
      },
    },
    networkCaptures: {
      "cap-a": {
        captureId: "cap-a",
        sessionId: "a-main",
        targetId: "t-a",
        startedAt: "2026-02-13T09:00:00.000Z",
        status: "recording",
        profile: "custom",
        maxRuntimeMs: 1000,
        workerPid: null,
        stopSignalPath: "/tmp/stop-a",
        donePath: "/tmp/done-a",
        resultPath: "/tmp/result-a",
        endedAt: null,
        actionId: "a-1",
      },
      "cap-m": {
        captureId: "cap-m",
        sessionId: "m-main",
        targetId: "t-m",
        startedAt: "2026-02-13T09:00:00.000Z",
        status: "recording",
        profile: "custom",
        maxRuntimeMs: 1000,
        workerPid: null,
        stopSignalPath: "/tmp/stop-m",
        donePath: "/tmp/done-m",
        resultPath: "/tmp/result-m",
        endedAt: null,
        actionId: "a-2",
      },
    },
    networkArtifacts: {
      "art-a": {
        artifactId: "art-a",
        createdAt: "2026-02-13T09:00:00.000Z",
        format: "har",
        path: "/tmp/a.har",
        sessionId: "a-main",
        targetId: "t-a",
        captureId: "cap-a",
        entries: 1,
        bytes: 100,
      },
      "art-m": {
        artifactId: "art-m",
        createdAt: "2026-02-13T09:00:00.000Z",
        format: "har",
        path: "/tmp/m.har",
        sessionId: "m-main",
        targetId: "t-m",
        captureId: "cap-m",
        entries: 1,
        bytes: 100,
      },
    },
  });

  const clearResult = runCli(["session", "clear", "--session", "a-main", "--keep-processes", "--timeout-ms", "200"]);
  assert.equal(clearResult.status, 0);
  const payload = parseJson(clearResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.scope, "session");
  assert.equal(payload.requestedSessionId, "a-main");
  assert.equal(payload.activeSessionId, "m-main");
  assert.equal(payload.scanned, 1);
  assert.equal(payload.cleared, 1);
  assert.deepEqual(payload.clearedSessionIds, ["a-main"]);
  assert.equal(payload.targetsRemoved, 1);
  assert.equal(payload.networkCapturesRemoved, 1);
  assert.equal(payload.networkArtifactsRemoved, 1);

  const finalState = readState();
  assert.equal(finalState.activeSessionId, "m-main");
  assert.deepEqual(Object.keys(finalState.sessions), ["m-main"]);
  assert.deepEqual(Object.keys(finalState.targets), ["t-m"]);
  assert.deepEqual(Object.keys(finalState.networkCaptures), ["cap-m"]);
  assert.deepEqual(Object.keys(finalState.networkArtifacts), ["art-m"]);
});

test("session clear normalizes positional scope and keep-processes assignment forms", () => {
  writeState({
    version: 4,
    activeSessionId: "a-main",
    nextSessionOrdinal: 2,
    nextCaptureOrdinal: 1,
    nextArtifactOrdinal: 1,
    sessions: {
      "a-main": {
        sessionId: "a-main",
        kind: "attached",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9222,
        userDataDir: null,
        browserPid: null,
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
    networkCaptures: {},
    networkArtifacts: {},
  });

  const clearResult = runCli(["session", "clear", "a-main", "--keep-processes=false", "--no-prompt", "--timeout-ms", "200"]);
  assert.equal(clearResult.status, 0);
  const payload = parseJson(clearResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.scope, "session");
  assert.equal(payload.requestedSessionId, "a-main");
  assert.equal(payload.keepProcesses, false);
  assert.equal(payload.scanned, 1);
  assert.equal(payload.cleared, 1);
  assert.equal(payload.processShutdown.requested, 1);

  const finalState = readState();
  assert.equal(finalState.activeSessionId, null);
  assert.deepEqual(finalState.sessions, {});
});
