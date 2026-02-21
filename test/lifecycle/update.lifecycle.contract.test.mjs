import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-update-"));

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
  assert.notEqual(text.length, 0, "Expected JSON output");
  return JSON.parse(text);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("update check supports channel/policy combinations with structured payload", () => {
  const result = runCli(["update",
    "check",
    "--package",
    "surfwright",
    "--channel",
    "beta",
    "--policy",
    "safe-patch",
    "--check-on-start",
    "false",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.packageName, "surfwright");
  assert.equal(payload.channel, "beta");
  assert.equal(payload.policy, "safe-patch");
  assert.equal(payload.checkOnStart, false);
  assert.equal(typeof payload.updateAvailable, "boolean");
});

test("update run dry-run returns structured status without mutating install", () => {
  const result = runCli(["update",
    "run",
    "--package",
    "surfwright",
    "--channel",
    "stable",
    "--policy",
    "manual",
    "--dry-run",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(["noop", "blocked", "updated"].includes(payload.status), true);
  assert.equal(payload.dryRun, true);
});

test("update rollback dry-run fails with typed error when history is missing", () => {
  const result = runCli(["update", "rollback", "--package", "surfwright", "--dry-run"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_UPDATE_ROLLBACK_NOT_AVAILABLE");
});
