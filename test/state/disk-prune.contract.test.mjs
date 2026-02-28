import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeCanonicalState } from "../core/state-storage.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-disk-prune-state-"));
const TEST_WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-disk-prune-workspace-"));

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_WORKSPACE_DIR: TEST_WORKSPACE_DIR,
      SURFWRIGHT_GC_ENABLED: "0",
      SURFWRIGHT_DAEMON: "0",
      ...env,
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
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

function resetTestDirs() {
  fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.mkdirSync(TEST_WORKSPACE_DIR, { recursive: true });
}

function writeSizedFile(filePath, sizeBytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, 0x61));
}

function setPathMtime(targetPath, mtimeMs) {
  const stamp = new Date(mtimeMs);
  fs.utimesSync(targetPath, stamp, stamp);
}

function makeProfileDir(dirPath, fileSizeBytes, mtimeMs) {
  fs.mkdirSync(dirPath, { recursive: true });
  writeSizedFile(path.join(dirPath, "cache.bin"), fileSizeBytes);
  setPathMtime(path.join(dirPath, "cache.bin"), mtimeMs);
  setPathMtime(dirPath, mtimeMs);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
  try {
    fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("state disk-prune prunes runs/captures/orphan profiles with deterministic report", () => {
  resetTestDirs();
  const nowMs = Date.now();
  const oldMs = nowMs - 72 * 60 * 60 * 1000;

  const runsDir = path.join(TEST_STATE_DIR, "runs");
  const capturesDir = path.join(TEST_STATE_DIR, "captures");
  const profilesDir = path.join(TEST_STATE_DIR, "profiles");
  const workspaceProfiles = path.join(TEST_WORKSPACE_DIR, "profiles");

  writeSizedFile(path.join(runsDir, "run-old.json"), 512);
  setPathMtime(path.join(runsDir, "run-old.json"), oldMs);
  writeSizedFile(path.join(runsDir, "run-new.json"), 512);

  writeSizedFile(path.join(capturesDir, "cap-old.json"), 512);
  setPathMtime(path.join(capturesDir, "cap-old.json"), oldMs);
  writeSizedFile(path.join(capturesDir, "cap-new.json"), 512);

  makeProfileDir(path.join(profilesDir, "s-keep"), 256, nowMs);
  makeProfileDir(path.join(profilesDir, "s-orphan-old"), 256, oldMs);
  makeProfileDir(path.join(profilesDir, "s-orphan-fresh"), 256, nowMs);

  makeProfileDir(path.join(workspaceProfiles, "auth"), 256, nowMs);
  makeProfileDir(path.join(workspaceProfiles, "workspace-old"), 256, oldMs);

  writeState({
    ...baseState(),
    sessions: {
      "s-keep": {
        sessionId: "s-keep",
        kind: "managed",
        policy: "persistent",
        browserMode: "headless",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9222,
        userDataDir: path.join(profilesDir, "s-keep"),
        profile: null,
        browserPid: null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-01T00:00:00.000Z",
        lastSeenAt: "2026-02-01T00:00:00.000Z",
      },
      "p.auth": {
        sessionId: "p.auth",
        kind: "managed",
        policy: "persistent",
        browserMode: "headless",
        cdpOrigin: "http://127.0.0.1:1",
        debugPort: 9223,
        userDataDir: path.join(workspaceProfiles, "auth"),
        profile: "auth",
        browserPid: null,
        ownerId: "agent.test",
        leaseExpiresAt: null,
        leaseTtlMs: 3600000,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-01T00:00:00.000Z",
        lastSeenAt: "2026-02-01T00:00:00.000Z",
      },
    },
  });

  const result = runCli([
    "state",
    "disk-prune",
    "--runs-max-age-hours",
    "24",
    "--captures-max-age-hours",
    "24",
    "--orphan-profiles-max-age-hours",
    "24",
  ]);

  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.runs.removed, 1);
  assert.equal(payload.captures.removed, 1);
  assert.equal(payload.orphanProfiles.removed, 1);
  assert.equal(payload.workspaceProfiles.enabled, false);
  assert.equal(payload.workspaceProfiles.removed, 0);
  assert.equal(payload.totalBytesFreed > 0, true);

  assert.equal(fs.existsSync(path.join(runsDir, "run-old.json")), false);
  assert.equal(fs.existsSync(path.join(runsDir, "run-new.json")), true);
  assert.equal(fs.existsSync(path.join(capturesDir, "cap-old.json")), false);
  assert.equal(fs.existsSync(path.join(capturesDir, "cap-new.json")), true);
  assert.equal(fs.existsSync(path.join(profilesDir, "s-keep")), true);
  assert.equal(fs.existsSync(path.join(profilesDir, "s-orphan-old")), false);
  assert.equal(fs.existsSync(path.join(profilesDir, "s-orphan-fresh")), true);
  assert.equal(fs.existsSync(path.join(workspaceProfiles, "workspace-old")), true);
});

test("state disk-prune supports dry-run and optional workspace profile pruning", () => {
  resetTestDirs();
  const oldMs = Date.now() - 72 * 60 * 60 * 1000;

  const runsDir = path.join(TEST_STATE_DIR, "runs");
  const workspaceProfiles = path.join(TEST_WORKSPACE_DIR, "profiles");

  writeSizedFile(path.join(runsDir, "run-old.json"), 256);
  setPathMtime(path.join(runsDir, "run-old.json"), oldMs);
  makeProfileDir(path.join(workspaceProfiles, "workspace-old"), 256, oldMs);

  writeState(baseState());

  const dryRun = runCli(["state", "disk-prune", "--runs-max-age-hours", "24", "--dry-run"]);
  assert.equal(dryRun.status, 0);
  const dryPayload = parseJson(dryRun.stdout);
  assert.equal(dryPayload.ok, true);
  assert.equal(dryPayload.dryRun, true);
  assert.equal(dryPayload.runs.removed, 1);
  assert.equal(fs.existsSync(path.join(runsDir, "run-old.json")), true);

  const workspacePrune = runCli([
    "state",
    "disk-prune",
    "--workspace-profiles-max-age-hours",
    "24",
  ]);
  assert.equal(workspacePrune.status, 0);
  const workspacePayload = parseJson(workspacePrune.stdout);
  assert.equal(workspacePayload.ok, true);
  assert.equal(workspacePayload.workspaceProfiles.enabled, true);
  assert.equal(workspacePayload.workspaceProfiles.removed, 1);
  assert.equal(fs.existsSync(path.join(workspaceProfiles, "workspace-old")), false);
});
