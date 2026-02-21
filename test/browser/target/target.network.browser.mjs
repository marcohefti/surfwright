import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-network-browser-");
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
  const doctor = runCli(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
}

test("target network returns deterministic JSON shape", () => {
  requireBrowser();

  const ensureResult = runCli(["session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Contract Page</title><main><h1>network ok</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const networkResult = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "network",
    openPayload.targetId,
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(networkResult.status, 0);
  const payload = parseJson(networkResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.sessionId, ensurePayload.sessionId);
});

test("target network-export writes HAR artifact metadata", () => {
  requireBrowser();

  const ensureResult = runCli(["session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Export</title><main>ok</main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const outPath = path.join(TEST_STATE_DIR, "artifacts", "capture.har");
  const exportResult = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "network-export",
    openPayload.targetId,
    "--out",
    outPath,
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(exportResult.status, 0);
  const payload = parseJson(exportResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.format, "har");
  assert.equal(typeof payload.artifact?.path, "string");
  assert.equal(payload.artifact.path, outPath);
  assert.equal(typeof payload.artifact.bytes, "number");
  assert.equal(fs.existsSync(payload.artifact.path), true);
});

test("target network begin/end returns capture handle and projected report", () => {
  requireBrowser();

  const ensureResult = runCli(["session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Capture</title><main>ok</main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const beginResult = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "network-begin",
    openPayload.targetId,
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(beginResult.status, 0);
  const beginPayload = parseJson(beginResult.stdout);
  assert.equal(beginPayload.ok, true);
  assert.equal(typeof beginPayload.captureId, "string");

  const endResult = runCli(["target", "network-end", beginPayload.captureId, "--view", "summary", "--timeout-ms", "20000"]);
  assert.equal(endResult.status, 0);
  const endPayload = parseJson(endResult.stdout);
  assert.equal(endPayload.ok, true);
  assert.equal(endPayload.captureId, beginPayload.captureId);
});
