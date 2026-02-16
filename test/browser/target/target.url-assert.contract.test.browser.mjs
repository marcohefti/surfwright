import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-url-assert-"));

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
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("target url-assert returns deterministic shape and typed failures", () => {
  requireBrowser();
  const openResult = runCli(["--json", "open", "http://example.com", "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  const targetId = openPayload.targetId;
  assert.equal(typeof targetId, "string");
  assert.equal(targetId.length > 0, true);

  const assertHostResult = runCli(["--json", "target", "url-assert", targetId, "--host", "example.com", "--timeout-ms", "8000"]);
  assert.equal(assertHostResult.status, 0);
  const assertHostPayload = parseJson(assertHostResult.stdout);
  assert.equal(assertHostPayload.ok, true);
  assert.equal(assertHostPayload.assert.host, "example.com");
  assert.equal(assertHostPayload.assert.origin, null);
  assert.equal(assertHostPayload.assert.pathPrefix, null);
  assert.equal(assertHostPayload.assert.urlPrefix, null);

  const assertAllResult = runCli([
    "--json",
    "target",
    "url-assert",
    targetId,
    "--origin",
    "https://example.com/",
    "--path-prefix",
    "/",
    "--url-prefix",
    "https://example.com/",
    "--timeout-ms",
    "8000",
  ]);
  assert.equal(assertAllResult.status, 0);
  const assertAllPayload = parseJson(assertAllResult.stdout);
  assert.equal(assertAllPayload.ok, true);
  assert.equal(assertAllPayload.url, "https://example.com/");

  const assertInvalidResult = runCli(["--json", "target", "url-assert", targetId, "--host", "nope.example", "--timeout-ms", "8000"]);
  assert.equal(assertInvalidResult.status, 1);
  const assertInvalidPayload = parseJson(assertInvalidResult.stdout);
  assert.equal(assertInvalidPayload.ok, false);
  assert.equal(assertInvalidPayload.code, "E_ASSERT_FAILED");

  const assertMissingResult = runCli(["--json", "target", "url-assert", targetId, "--timeout-ms", "8000"]);
  assert.equal(assertMissingResult.status, 1);
  const assertMissingPayload = parseJson(assertMissingResult.stdout);
  assert.equal(assertMissingPayload.ok, false);
  assert.equal(assertMissingPayload.code, "E_QUERY_INVALID");
});
