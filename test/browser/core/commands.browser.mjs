import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-commands-browser-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

function runCli(args) {
  return runCliSync(args);
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
    "profile",
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
    "profile",
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
    "blockType",
    "download",
    "waitUntil",
    "reuseMode",
    "reusedTarget",
    "timingMs",
  ]);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.sessionId, ensurePayload.sessionId);
  assert.equal(openPayload.sessionSource, "explicit");
  assert.equal(openPayload.browserMode, ensurePayload.browserMode);
  assert.equal(typeof openPayload.blockType, "string");
});
