import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-dot-alias-"));

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

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("dot-command aliases route to runtime/target commands", () => {
  const listResult = runCli(["--json", "session.list"]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(Array.isArray(listPayload.sessions), true);

  const pruneResult = runCli(["--json", "target.prune"]);
  assert.equal(pruneResult.status, 0);
  const prunePayload = parseJson(pruneResult.stdout);
  assert.equal(prunePayload.ok, true);
  assert.equal(typeof prunePayload.removed, "number");

  const reconcileResult = runCli(["--json", "state.reconcile", "--timeout-ms", "200"]);
  assert.equal(reconcileResult.status, 0);
  const reconcilePayload = parseJson(reconcileResult.stdout);
  assert.equal(reconcilePayload.ok, true);
  assert.equal(typeof reconcilePayload.sessions.removed, "number");

  const evalResult = runCli(["--json", "target.eval", "DEADBEEF", "--expression", "1 + 1"]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("dot-command alias supports network subcommands", () => {
  const result = runCli(["--json", "target.network-query", "--preset", "summary"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");

  const traceResult = runCli(["--json", "target.trace.insight"]);
  assert.equal(traceResult.status, 1);
  const tracePayload = parseJson(traceResult.stdout);
  assert.equal(tracePayload.ok, false);
  assert.equal(tracePayload.code, "E_QUERY_INVALID");

  const extensionList = runCli(["--json", "extension.list"]);
  assert.equal(extensionList.status, 0);
  const extensionPayload = parseJson(extensionList.stdout);
  assert.equal(extensionPayload.ok, true);
  assert.equal(Array.isArray(extensionPayload.extensions), true);
});
