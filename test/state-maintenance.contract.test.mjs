import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-state-maint-"));

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

function baseState() {
  return {
    version: 2,
    activeSessionId: null,
    nextSessionOrdinal: 1,
    sessions: {},
    targets: {},
  };
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

test("contract includes state maintenance commands", () => {
  const result = runCli(["--json", "contract"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  const commandIds = new Set(payload.commands.map((entry) => entry.id));
  assert.equal(commandIds.has("session.prune"), true);
  assert.equal(commandIds.has("target.prune"), true);
  assert.equal(commandIds.has("state.reconcile"), true);
});

test("target prune removes orphaned, stale, and overflow metadata", () => {
  const now = new Date("2026-02-13T10:00:00.000Z");
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
  const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

  writeState({
    ...baseState(),
    activeSessionId: "s-main",
    sessions: {
      "s-main": {
        sessionId: "s-main",
        kind: "attached",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: null,
        userDataDir: null,
        browserPid: null,
        createdAt: "2026-02-13T09:50:00.000Z",
        lastSeenAt: "2026-02-13T09:50:00.000Z",
      },
    },
    targets: {
      "t-orphan": {
        targetId: "t-orphan",
        sessionId: "missing",
        url: "https://example.com/orphan",
        title: "orphan",
        status: 200,
        updatedAt: now.toISOString(),
      },
      "t-old": {
        targetId: "t-old",
        sessionId: "s-main",
        url: "https://example.com/old",
        title: "old",
        status: 200,
        updatedAt: thirtyHoursAgo.toISOString(),
      },
      "t-new-1": {
        targetId: "t-new-1",
        sessionId: "s-main",
        url: "https://example.com/new-1",
        title: "new-1",
        status: 200,
        updatedAt: now.toISOString(),
      },
      "t-new-2": {
        targetId: "t-new-2",
        sessionId: "s-main",
        url: "https://example.com/new-2",
        title: "new-2",
        status: 200,
        updatedAt: tenMinutesAgo.toISOString(),
      },
      "t-new-3": {
        targetId: "t-new-3",
        sessionId: "s-main",
        url: "https://example.com/new-3",
        title: "new-3",
        status: 200,
        updatedAt: twentyMinutesAgo.toISOString(),
      },
    },
  });

  const result = runCli(["--json", "target", "prune", "--max-age-hours", "24", "--max-per-session", "2"]);
  assert.equal(result.status, 0);

  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.scanned, 5);
  assert.equal(payload.remaining, 2);
  assert.equal(payload.removed, 3);
  assert.equal(payload.removedOrphaned, 1);
  assert.equal(payload.removedByAge, 1);
  assert.equal(payload.removedByCap, 1);
  assert.equal(payload.maxAgeHours, 24);
  assert.equal(payload.maxPerSession, 2);

  const state = readState();
  const targetIds = Object.keys(state.targets).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(targetIds, ["t-new-1", "t-new-2"]);
});

test("session prune removes unreachable attached sessions and can drop managed sessions", () => {
  writeState({
    ...baseState(),
    activeSessionId: "m-dead",
    sessions: {
      "a-dead": {
        sessionId: "a-dead",
        kind: "attached",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: null,
        userDataDir: null,
        browserPid: null,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
      "m-dead": {
        sessionId: "m-dead",
        kind: "managed",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9222,
        userDataDir: "/tmp/surfwright-m-dead",
        browserPid: 999999,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
    },
    targets: {},
  });

  const firstPrune = runCli(["--json", "session", "prune", "--timeout-ms", "200"]);
  assert.equal(firstPrune.status, 0);
  const firstPayload = parseJson(firstPrune.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.scanned, 2);
  assert.equal(firstPayload.kept, 1);
  assert.equal(firstPayload.removed, 1);
  assert.equal(firstPayload.removedAttachedUnreachable, 1);
  assert.equal(firstPayload.removedManagedUnreachable, 0);
  assert.equal(firstPayload.repairedManagedPid, 1);
  assert.equal(firstPayload.activeSessionId, "m-dead");

  const intermediateState = readState();
  assert.deepEqual(Object.keys(intermediateState.sessions), ["m-dead"]);
  assert.equal(intermediateState.sessions["m-dead"].browserPid, null);

  const secondPrune = runCli(["--json", "session", "prune", "--drop-managed-unreachable", "--timeout-ms", "200"]);
  assert.equal(secondPrune.status, 0);
  const secondPayload = parseJson(secondPrune.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.scanned, 1);
  assert.equal(secondPayload.kept, 0);
  assert.equal(secondPayload.removed, 1);
  assert.equal(secondPayload.removedManagedUnreachable, 1);
  assert.equal(secondPayload.activeSessionId, null);

  const finalState = readState();
  assert.deepEqual(finalState.sessions, {});
  assert.equal(finalState.activeSessionId, null);
});

test("state reconcile combines session and target maintenance", () => {
  const now = new Date("2026-02-13T10:00:00.000Z");
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  writeState({
    ...baseState(),
    activeSessionId: "m-dead",
    sessions: {
      "a-dead": {
        sessionId: "a-dead",
        kind: "attached",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: null,
        userDataDir: null,
        browserPid: null,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
      "m-dead": {
        sessionId: "m-dead",
        kind: "managed",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9222,
        userDataDir: "/tmp/surfwright-m-dead",
        browserPid: 999999,
        createdAt: "2026-02-13T09:00:00.000Z",
        lastSeenAt: "2026-02-13T09:00:00.000Z",
      },
    },
    targets: {
      "t-orphan": {
        targetId: "t-orphan",
        sessionId: "missing",
        url: "https://example.com/orphan",
        title: "orphan",
        status: 200,
        updatedAt: now.toISOString(),
      },
      "t-attached": {
        targetId: "t-attached",
        sessionId: "a-dead",
        url: "https://example.com/attached",
        title: "attached",
        status: 200,
        updatedAt: now.toISOString(),
      },
      "t-managed-new": {
        targetId: "t-managed-new",
        sessionId: "m-dead",
        url: "https://example.com/new",
        title: "new",
        status: 200,
        updatedAt: now.toISOString(),
      },
      "t-managed-second": {
        targetId: "t-managed-second",
        sessionId: "m-dead",
        url: "https://example.com/second",
        title: "second",
        status: 200,
        updatedAt: fifteenMinutesAgo.toISOString(),
      },
      "t-managed-old": {
        targetId: "t-managed-old",
        sessionId: "m-dead",
        url: "https://example.com/old",
        title: "old",
        status: 200,
        updatedAt: fortyEightHoursAgo.toISOString(),
      },
    },
  });

  const reconcileResult = runCli([
    "--json",
    "state",
    "reconcile",
    "--timeout-ms",
    "200",
    "--max-age-hours",
    "24",
    "--max-per-session",
    "1",
  ]);
  assert.equal(reconcileResult.status, 0);

  const payload = parseJson(reconcileResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.activeSessionId, "m-dead");
  assert.equal(payload.sessions.scanned, 2);
  assert.equal(payload.sessions.kept, 1);
  assert.equal(payload.sessions.removed, 1);
  assert.equal(payload.sessions.removedAttachedUnreachable, 1);
  assert.equal(payload.sessions.removedManagedUnreachable, 0);
  assert.equal(payload.sessions.repairedManagedPid, 1);
  assert.equal(payload.targets.scanned, 5);
  assert.equal(payload.targets.remaining, 1);
  assert.equal(payload.targets.removed, 4);
  assert.equal(payload.targets.removedOrphaned, 2);
  assert.equal(payload.targets.removedByAge, 1);
  assert.equal(payload.targets.removedByCap, 1);
  assert.equal(payload.targets.maxAgeHours, 24);
  assert.equal(payload.targets.maxPerSession, 1);

  const state = readState();
  assert.equal(state.activeSessionId, "m-dead");
  assert.deepEqual(Object.keys(state.sessions), ["m-dead"]);
  assert.equal(state.sessions["m-dead"].browserPid, null);
  assert.deepEqual(Object.keys(state.targets), ["t-managed-new"]);
});
