import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-select-upload-");
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

test("target upload --submit-selector and target select-option return deterministic shapes", () => {
  requireBrowser();
  const ensureResult = runCli(["session", "fresh", "--timeout-ms", "8000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const fixturePath = path.join(TEST_STATE_DIR, "upload-submit-fixture.txt");
  fs.writeFileSync(fixturePath, "hello upload submit");
  const html = [
    "<title>Select Upload Contract Test</title>",
    "<main>",
    '<input id="file-input" type="file" />',
    '<button id="upload-submit" onclick="const i=document.getElementById(\'file-input\');const f=i.files&&i.files[0]?i.files[0].name:\'none\';document.getElementById(\'upload-status\').textContent=`uploaded:${i.files.length}:${f}`">Submit Upload</button>',
    '<div id="upload-status">uploaded:0</div>',
    '<select id="role"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="owner">Owner</option></select>',
    "</main>",
  ].join("");
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const uploadSubmit = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "upload",
    openPayload.targetId,
    "--selector",
    "#file-input",
    "--file",
    fixturePath,
    "--submit-selector",
    "#upload-submit",
    "--expect-uploaded-filename",
    "upload-submit-fixture.txt",
    "--wait-for-result",
    "--result-selector",
    "#upload-status",
    "--result-filename-regex",
    "upload-submit-fixture\\.txt",
    "--wait-for-text",
    "uploaded:1",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(uploadSubmit.status, 0);
  const uploadSubmitPayload = parseJson(uploadSubmit.stdout);
  assert.equal(uploadSubmitPayload.submitted, true);
  assert.equal(uploadSubmitPayload.uploadedFilename, "upload-submit-fixture.txt");
  assert.equal(uploadSubmitPayload.uploadVerified, true);
  assert.equal(uploadSubmitPayload.resultVerification?.satisfied, true);
  assert.equal(uploadSubmitPayload.submitSelector, "#upload-submit");
  assert.equal(uploadSubmitPayload.wait.mode, "text");

  const selectByValue = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "select-option",
    openPayload.targetId,
    "--selector",
    "#role",
    "--value",
    "editor",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(selectByValue.status, 0);
  const selectByValuePayload = parseJson(selectByValue.stdout);
  assert.equal(selectByValuePayload.selectedBy, "value");
  assert.equal(selectByValuePayload.selectedValue, "editor");
  assert.equal(selectByValuePayload.selectedText, "Editor");
  assert.equal(selectByValuePayload.selectedIndex, 1);

  const selectByIndex = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "select-option",
    openPayload.targetId,
    "--selector",
    "#role",
    "--option-index",
    "0",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(selectByIndex.status, 0);
  assert.equal(parseJson(selectByIndex.stdout).selectedValue, "viewer");
});

test("target click --proof-check-state reports checkbox state transitions", () => {
  requireBrowser();
  const ensureResult = runCli(["session", "fresh", "--timeout-ms", "8000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Click Check State</title>
    <main>
      <label><input id="agree" type="checkbox" /> Agree</label>
    </main>
  `;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const clickResult = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "#agree",
    "--proof",
    "--proof-check-state",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(clickResult.status, 0);
  const payload = parseJson(clickResult.stdout);
  assert.equal(typeof payload.proof, "object");
  assert.equal(typeof payload.proof.checkState, "object");
  assert.equal(payload.proof.checkState.before.checked, false);
  assert.equal(payload.proof.checkState.after.checked, true);
  assert.equal(payload.proof.checkState.changed, true);
});

test("target upload maps post-action wait timeout to typed E_WAIT_TIMEOUT", () => {
  requireBrowser();
  const ensureResult = runCli(["session", "fresh", "--timeout-ms", "8000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const fixturePath = path.join(TEST_STATE_DIR, "upload-timeout-fixture.txt");
  fs.writeFileSync(fixturePath, "hello upload timeout");
  const html = [
    "<title>Upload Wait Timeout</title>",
    "<main>",
    '<input id="file-input" type="file" />',
    '<button id="upload-submit">Submit Upload</button>',
    '<div id="upload-status">ready</div>',
    "</main>",
  ].join("");
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const uploadResult = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "upload",
    openPayload.targetId,
    "--selector",
    "#file-input",
    "--file",
    fixturePath,
    "--submit-selector",
    "#upload-submit",
    "--wait-for-selector",
    "#never-appears",
    "--wait-timeout-ms",
    "400",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(uploadResult.status, 1);
  const payload = parseJson(uploadResult.stdout);
  assert.equal(payload.code, "E_WAIT_TIMEOUT");
});

test("target count --count-only returns compact count shape", () => {
  requireBrowser();
  const ensureResult = runCli(["session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Count Only</title>
    <main>
      <div class="item">A</div>
      <div class="item">B</div>
      <div class="item">C</div>
    </main>
  `;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const countResult = runCli(["--session",
    ensurePayload.sessionId,
    "target",
    "count",
    openPayload.targetId,
    "--selector",
    ".item",
    "--count-only",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(countResult.status, 0);
  const payload = parseJson(countResult.stdout);
  assert.deepEqual(Object.keys(payload), ["ok", "count"]);
  assert.equal(payload.ok, true);
  assert.equal(payload.count, 3);
});
