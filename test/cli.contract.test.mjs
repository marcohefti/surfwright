import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-cli-contract-"));

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

test("open invalid URL returns typed compact JSON failure", () => {
  const result = runCli(["--json", "open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.trim().startsWith('{"ok":false,'));
  const payload = parseJson(result.stdout);
  assert.deepEqual(Object.keys(payload), ["ok", "code", "message"]);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_URL_INVALID");
  assert.equal(typeof payload.message, "string");
});

test("--pretty switches to multiline JSON", () => {
  const result = runCli(["--json", "--pretty", "open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("\n  \"ok\": false"));
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test("session attach requires explicit valid CDP origin", () => {
  const result = runCli(["--json", "session", "attach", "--cdp", "not-a-url"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_CDP_INVALID");
});

test("session attach accepts ws:// CDP endpoint format (returns typed unreachable if offline)", () => {
  const result = runCli([
    "--json",
    "session",
    "attach",
    "--cdp",
    "ws://127.0.0.1:9/devtools/browser/fake",
    "--timeout-ms",
    "300",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_CDP_UNREACHABLE");
});

test("browser-mode rejects invalid values (typed)", () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--browser-mode", "bogus"]);
  assert.equal(ensureResult.status, 1);
  const ensurePayload = parseJson(ensureResult.stdout);
  assert.equal(ensurePayload.ok, false);
  assert.equal(ensurePayload.code, "E_QUERY_INVALID");
  assert.equal(ensurePayload.message, "browser-mode must be one of: headless, headed");

  const openResult = runCli(["--json", "open", "https://example.com", "--browser-mode", "bogus"]);
  assert.equal(openResult.status, 1);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, false);
  assert.equal(openPayload.code, "E_QUERY_INVALID");
  assert.equal(openPayload.message, "browser-mode must be one of: headless, headed");
});

test("target eval validates script size before session resolution", () => {
  const oversizedExpression = "x".repeat(5000);
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--expression",
    oversizedExpression,
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_EVAL_SCRIPT_TOO_LARGE");
});

test("target eval accepts --js alias", () => {
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--js",
    "1 + 1",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("target find validates href-path-prefix before session resolution", () => {
  const findResult = runCli([
    "--json",
    "target",
    "find",
    "ABCDEF123456",
    "--text",
    "Repo",
    "--href-path-prefix",
    "marcohefti/",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(findResult.status, 1);
  const findPayload = parseJson(findResult.stdout);
  assert.equal(findPayload.ok, false);
  assert.equal(findPayload.code, "E_QUERY_INVALID");
  assert.equal(findPayload.message, "href-path-prefix must start with '/'");
});
