import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-agent-home-"));
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-agent-state-"));
const TEST_TARGET_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-agent-target-"));

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
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
  const doctor = runCli(["--json", "doctor"], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  const payload = parseJson(doctor.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true &&
    runCli(["--json", "session", "ensure", "--timeout-ms", "5000"], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR }).status === 0;
  return hasBrowserCache;
}

function cleanupManagedBrowsers(stateDir) {
  try {
    const statePath = path.join(stateDir, "state.json");
    if (!fs.existsSync(statePath)) {
      return;
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    for (const session of Object.values(state?.sessions ?? {})) {
      if (!session || typeof session !== "object" || session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

process.on("exit", () => {
  cleanupManagedBrowsers(TEST_TARGET_STATE_DIR);
  try {
    fs.rmSync(TEST_HOME_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
  try {
    fs.rmSync(TEST_TARGET_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("agent id scopes default state root under ~/.surfwright/agents/<agentId>", () => {
  const result = runCli(["--json", "target", "prune"], {
    HOME: TEST_HOME_DIR,
    SURFWRIGHT_AGENT_ID: "agent.alpha",
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);

  const expectedStatePath = path.join(TEST_HOME_DIR, ".surfwright", "agents", "agent.alpha", "state.json");
  assert.equal(fs.existsSync(expectedStatePath), true);
});

test("explicit SURFWRIGHT_STATE_DIR overrides agent-id namespacing", () => {
  const result = runCli(["--json", "target", "prune"], {
    HOME: TEST_HOME_DIR,
    SURFWRIGHT_AGENT_ID: "agent.beta",
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);

  const expectedStatePath = path.join(TEST_STATE_DIR, "state.json");
  assert.equal(fs.existsSync(expectedStatePath), true);
});

test("--agent-id CLI option scopes state root without env wiring", () => {
  const result = runCli(["--json", "--agent-id", "agent.flag", "target", "prune"], {
    HOME: TEST_HOME_DIR,
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);

  const expectedStatePath = path.join(TEST_HOME_DIR, ".surfwright", "agents", "agent.flag", "state.json");
  assert.equal(fs.existsSync(expectedStatePath), true);
});

test("malformed --agent-id does not override existing agent scope", () => {
  const result = runCli(["--json", "--agent-id=", "target", "prune"], {
    HOME: TEST_HOME_DIR,
    SURFWRIGHT_AGENT_ID: "agent.fallback",
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);

  const expectedStatePath = path.join(TEST_HOME_DIR, ".surfwright", "agents", "agent.fallback", "state.json");
  assert.equal(fs.existsSync(expectedStatePath), true);
});

test("target spawn close and dialog return deterministic shapes", { skip: !hasBrowser() }, () => {
  const childUrl = "https://example.com";
  const html = `
    <title>Spawn Close Dialog</title>
    <a id="new-tab" target="_blank" href="${childUrl}">Open Child</a>
    <button id="confirm-btn" onclick="confirm('Delete record?')">Delete</button>
  `;
  const open = runCli(["--json", "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const dialog = runCli([
    "--json", "--session", openPayload.sessionId, "target", "dialog", openPayload.targetId,
    "--action", "dismiss", "--trigger-selector", "#confirm-btn", "--timeout-ms", "5000",
  ], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(dialog.status, 0);
  const dialogPayload = parseJson(dialog.stdout);
  assert.equal(dialogPayload.dialog.action, "dismiss");
  assert.equal(dialogPayload.dialog.type, "confirm");

  const spawn = runCli([
    "--json", "--session", openPayload.sessionId, "target", "spawn", openPayload.targetId,
    "--selector", "#new-tab", "--timeout-ms", "5000",
  ], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(spawn.status, 0);
  const spawnPayload = parseJson(spawn.stdout);
  assert.equal(spawnPayload.parentTargetId, openPayload.targetId);
  assert.equal(typeof spawnPayload.childTargetId, "string");

  const close = runCli([
    "--json", "--session", openPayload.sessionId, "target", "close", spawnPayload.childTargetId, "--timeout-ms", "5000",
  ], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(close.status, 0);
  assert.equal(parseJson(close.stdout).closed, true);
});

test("target spawn close and dialog return typed failures", { skip: !hasBrowser() }, () => {
  const open = runCli(["--json", "open", "data:text/html,%3Ctitle%3EFlow%3C%2Ftitle%3E", "--timeout-ms", "5000"], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const spawnMissing = runCli([
    "--json", "--session", openPayload.sessionId, "target", "spawn", openPayload.targetId,
    "--selector", "#missing", "--timeout-ms", "5000",
  ], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(spawnMissing.status, 1);
  assert.equal(parseJson(spawnMissing.stdout).code, "E_QUERY_INVALID");

  const dialogInvalid = runCli([
    "--json", "--session", openPayload.sessionId, "target", "dialog", openPayload.targetId,
    "--action", "invalid", "--timeout-ms", "5000",
  ], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(dialogInvalid.status, 1);
  assert.equal(parseJson(dialogInvalid.stdout).code, "E_QUERY_INVALID");

  const closeMissing = runCli([
    "--json", "--session", openPayload.sessionId, "target", "close", "t-missing-target", "--timeout-ms", "5000",
  ], { SURFWRIGHT_STATE_DIR: TEST_TARGET_STATE_DIR });
  assert.equal(closeMissing.status, 1);
  assert.equal(parseJson(closeMissing.stdout).code, "E_TARGET_SESSION_UNKNOWN");
});
