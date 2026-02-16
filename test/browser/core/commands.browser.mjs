import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-commands-browser-"));

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

function requireBrowser() {
  const doctor = runCli(["--json", "doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("session ensure + open success returns contract shape", () => {
  requireBrowser();

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);
  assert.deepEqual(Object.keys(ensurePayload), [
    "ok",
    "sessionId",
    "kind",
    "cdpOrigin",
    "browserMode",
    "active",
    "created",
    "restarted",
  ]);
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.kind, "managed");
  assert.equal(ensurePayload.browserMode, "headless");
  assert.equal(ensurePayload.active, true);

  const html = `<title>Contract Test Page</title><main><h1>ok heading</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  assert.deepEqual(Object.keys(openPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "browserMode",
    "targetId",
    "actionId",
    "requestedUrl",
    "finalUrl",
    "wasRedirected",
    "redirectChain",
    "redirectChainTruncated",
    "url",
    "status",
    "title",
    "timingMs",
  ]);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.sessionId, ensurePayload.sessionId);
  assert.equal(openPayload.sessionSource, "explicit");
  assert.equal(openPayload.browserMode, ensurePayload.browserMode);
});

