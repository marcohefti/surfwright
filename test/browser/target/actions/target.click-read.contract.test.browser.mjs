import assert from "node:assert/strict";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-click-read-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });

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

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target click-read composes click handoff and bounded read in one command", () => {
  requireBrowser();
  const ensureResult = runCli(["session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Click Read Contract Test</title>
    <main id="main">Home</main>
    <a id="pricing" href="#pricing" onclick="document.getElementById('main').textContent='Pricing Details';">Pricing</a>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
  const openPayload = parseJson(openResult.stdout);

  const clickRead = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "click-read",
    openPayload.targetId,
    "--text",
    "Pricing",
    "--wait-for-text",
    "Pricing Details",
    "--read-selector",
    "#main",
    "--chunk-size",
    "200",
    "--chunk",
    "1",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(clickRead.status, 0, clickRead.stdout || clickRead.stderr);
  const payload = parseJson(clickRead.stdout);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.sessionId, "string");
  assert.equal(typeof payload.targetId, "string");
  assert.equal(typeof payload.click.actionId, "string");
  assert.equal(payload.click.query, "Pricing");
  assert.equal(payload.read.scope.selector, "#main");
  assert.equal(typeof payload.read.text, "string");
  assert.equal(payload.read.text.includes("Pricing Details"), true);
});
