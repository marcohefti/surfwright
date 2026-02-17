import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-workspace-locks-"));
const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: TEST_DIR,
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: path.join(TEST_DIR, "state"),
    },
    ...opts,
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test("workspace profile-locks lists locks and profile-lock-clear clears stale locks", () => {
  const init = runCli(["--json", "workspace", "init"]);
  assert.equal(init.status, 0, init.stdout || init.stderr);
  const initPayload = parseJson(init.stdout);
  assert.equal(initPayload.ok, true);
  assert.equal(typeof initPayload.profileSessionsDir, "string");

  const profile = "auth";
  const lockPath = path.join(initPayload.profileSessionsDir, `${profile}.lock`);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `999999 ${Date.now() - 60000}\n`, { encoding: "utf8", mode: 0o600 });

  const list = runCli(["--json", "workspace", "profile-locks"]);
  assert.equal(list.status, 0, list.stdout || list.stderr);
  const listPayload = parseJson(list.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.found, true);
  assert.equal(Array.isArray(listPayload.locks), true);
  assert.equal(listPayload.locks.some((entry) => entry.profile === profile), true);

  const clear = runCli(["--json", "workspace", "profile-lock-clear", profile]);
  assert.equal(clear.status, 0, clear.stdout || clear.stderr);
  const clearPayload = parseJson(clear.stdout);
  assert.equal(clearPayload.ok, true);
  assert.equal(clearPayload.cleared, true);
  assert.equal(fs.existsSync(lockPath), false);
});
