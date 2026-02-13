import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-agent-home-"));
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-agent-state-"));

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

process.on("exit", () => {
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
