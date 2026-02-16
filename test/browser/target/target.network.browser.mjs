import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-network-browser-"));

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

test("target network returns deterministic JSON shape", () => {
  requireBrowser();

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Contract Page</title><main><h1>network ok</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const networkResult = runCli([
    "--json",
    "--session",
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

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Export</title><main>ok</main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const exportResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "network-export",
    openPayload.targetId,
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(exportResult.status, 0);
  const payload = parseJson(exportResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.format, "har");
  assert.equal(typeof payload.path, "string");
});

test("target network begin/end returns capture handle and projected report", () => {
  requireBrowser();

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Network Capture</title><main>ok</main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const beginResult = runCli([
    "--json",
    "--session",
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

  const endResult = runCli(["--json", "target", "network-end", beginPayload.captureId, "--view", "summary", "--timeout-ms", "20000"]);
  assert.equal(endResult.status, 0);
  const endPayload = parseJson(endResult.stdout);
  assert.equal(endPayload.ok, true);
  assert.equal(endPayload.captureId, beginPayload.captureId);
});

