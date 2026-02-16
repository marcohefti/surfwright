import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

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
  if (process.env.SURFWRIGHT_TEST_BROWSER !== "1") {
    return false;
  }
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
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
        // ignore already-dead process
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

test("session new accepts explicit policy and lease ttl", { skip: !hasBrowser() }, () => {
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
