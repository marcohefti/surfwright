import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-session-policy-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_TEST_BROWSER: "1",
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
  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("session new accepts explicit policy and lease ttl", () => {
  requireBrowser();
  const sessionId = `s-policy-${Date.now()}`;
  const createResult = runCli([
    "--json",
    "session",
    "new",
    "--session-id",
    sessionId,
    "--policy",
    "ephemeral",
    "--lease-ttl-ms",
    "900000",
    "--timeout-ms",
    "6000",
  ]);
  assert.equal(createResult.status, 0);
  const createPayload = parseJson(createResult.stdout);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.sessionId, sessionId);

  const state = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
  const session = state.sessions[sessionId];
  assert.equal(session.policy, "ephemeral");
  assert.equal(session.leaseTtlMs, 900000);
});
