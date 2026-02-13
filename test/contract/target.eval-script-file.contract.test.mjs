import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-eval-script-file-"));

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

test("target eval accepts --script-file option", () => {
  const scriptPath = path.join(TEST_STATE_DIR, "eval-script.js");
  fs.writeFileSync(scriptPath, "return 1 + 1;", "utf8");
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--script-file",
    scriptPath,
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("target eval validates script-file size before session resolution", () => {
  const scriptPath = path.join(TEST_STATE_DIR, "eval-oversized-script.js");
  fs.writeFileSync(scriptPath, "x".repeat(70 * 1024), "utf8");
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--script-file",
    scriptPath,
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_EVAL_SCRIPT_TOO_LARGE");
});

test("target eval rejects combining --script-file with inline expression", () => {
  const scriptPath = path.join(TEST_STATE_DIR, "eval-mixed-script.js");
  fs.writeFileSync(scriptPath, "return 2 + 2;", "utf8");
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--script-file",
    scriptPath,
    "--expression",
    "1 + 1",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_QUERY_INVALID");
});
