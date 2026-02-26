import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output");
  return JSON.parse(text);
}

test("state reconcile removes stale daemon metadata and reports hygiene counts", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-state-reconcile-daemon-"));
  try {
    const daemonMetaPath = path.join(stateDir, "daemon.json");
    fs.writeFileSync(
      daemonMetaPath,
      `${JSON.stringify({
        version: 1,
        pid: 2147483647,
        host: "127.0.0.1",
        port: 49997,
        token: "stale-token",
        startedAt: new Date(Date.now() - 60_000).toISOString(),
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    if (process.platform !== "win32") {
      fs.chmodSync(daemonMetaPath, 0o600);
    }

    const reconcileResult = runCli(["state", "reconcile", "--timeout-ms", "200"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "0",
    });
    assert.equal(reconcileResult.status, 0);

    const payload = parseJson(reconcileResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.daemon.scanned, 1);
    assert.equal(payload.daemon.kept, 0);
    assert.equal(payload.daemon.removed, 1);
    assert.equal(payload.daemon.removedDeadPid, 1);
    assert.equal(payload.daemon.removedInvalid, 0);
    assert.equal(payload.daemon.removedPermissionMismatch, 0);
    assert.equal(payload.daemon.removedOwnerMismatch, 0);
    assert.equal(payload.daemon.startLocksScanned, 0);
    assert.equal(payload.daemon.startLocksRemoved, 0);
    assert.equal(payload.daemon.namespacesScanned, 1);
    assert.equal(fs.existsSync(daemonMetaPath), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
