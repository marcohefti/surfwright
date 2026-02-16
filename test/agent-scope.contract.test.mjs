import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function createExtensionFixture(rootDir, name) {
  const extensionDir = fs.mkdtempSync(path.join(rootDir, "extension-fixture-"));
  const manifest = {
    manifest_version: 3,
    name,
    version: "0.0.1",
    background: {
      service_worker: "background.js",
    },
  };
  fs.writeFileSync(path.join(extensionDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(extensionDir, "background.js"), "console.log('extension fixture');\n", "utf8");
  return extensionDir;
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

test("extension lifecycle commands return deterministic fallback metadata", () => {
  const extensionName = "SurfWright Parity Minimal Extension";
  const extensionDir = createExtensionFixture(TEST_STATE_DIR, extensionName);

  const loadResult = runCli(["--json", "extension", "load", extensionDir], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(loadResult.status, 0);
  const loadPayload = parseJson(loadResult.stdout);
  assert.equal(loadPayload.ok, true);
  assert.equal(loadPayload.extension.name, extensionName);
  assert.equal(loadPayload.extension.path, extensionDir);
  assert.equal(loadPayload.capability.headlessMode, "headless-new");
  assert.equal(loadPayload.capability.runtimeInstallSupported, false);
  assert.equal(loadPayload.fallback.strategy, "registry-only");
  assert.equal(loadPayload.fallback.applied, false);

  const listResult = runCli(["--json", "extension", "list"], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.count >= 1, true);
  const listed = listPayload.extensions.find((entry) => entry.name === extensionName);
  assert.notEqual(listed, undefined);

  const reloadResult = runCli(["--json", "extension", "reload", extensionName], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(reloadResult.status, 0);
  const reloadPayload = parseJson(reloadResult.stdout);
  assert.equal(reloadPayload.ok, true);
  assert.equal(reloadPayload.reloaded, true);
  assert.equal(reloadPayload.extension.name, extensionName);
  assert.equal(reloadPayload.fallback.strategy, "registry-only");

  const uninstallResult = runCli(["--json", "extension", "uninstall", listed.id], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(uninstallResult.status, 0);
  const uninstallPayload = parseJson(uninstallResult.stdout);
  assert.equal(uninstallPayload.ok, true);
  assert.equal(uninstallPayload.removed, true);
  assert.equal(uninstallPayload.missing, false);
  assert.equal(uninstallPayload.extension.id, listed.id);
  assert.equal(uninstallPayload.extension.name, extensionName);

  const uninstallMissingResult = runCli(["--json", "extension", "uninstall", listed.id], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(uninstallMissingResult.status, 0);
  const uninstallMissingPayload = parseJson(uninstallMissingResult.stdout);
  assert.equal(uninstallMissingPayload.ok, true);
  assert.equal(uninstallMissingPayload.removed, false);
  assert.equal(uninstallMissingPayload.missing, true);
  assert.equal(uninstallMissingPayload.extension, null);

  const reloadMissingResult = runCli(["--json", "extension", "reload", listed.id], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(reloadMissingResult.status, 0);
  const reloadMissingPayload = parseJson(reloadMissingResult.stdout);
  assert.equal(reloadMissingPayload.ok, true);
  assert.equal(reloadMissingPayload.reloaded, false);
  assert.equal(reloadMissingPayload.missing, true);
  assert.equal(reloadMissingPayload.extension, null);

  const listAfterResult = runCli(["--json", "extension", "list"], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(listAfterResult.status, 0);
  const listAfterPayload = parseJson(listAfterResult.stdout);
  assert.equal(listAfterPayload.extensions.some((entry) => entry.id === listed.id), false);
});

test("extension lifecycle strict mode returns typed unknown-extension failure", () => {
  const reloadResult = runCli(["--json", "extension", "reload", "missing-extension", "--fail-if-missing"], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(reloadResult.status, 1);
  const reloadPayload = parseJson(reloadResult.stdout);
  assert.equal(reloadPayload.code, "E_QUERY_INVALID");

  const uninstallResult = runCli(["--json", "extension", "uninstall", "missing-extension", "--fail-if-missing"], {
    SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
  });
  assert.equal(uninstallResult.status, 1);
  const uninstallPayload = parseJson(uninstallResult.stdout);
  assert.equal(uninstallPayload.code, "E_QUERY_INVALID");
});

