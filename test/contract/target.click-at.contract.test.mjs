import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-click-at-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

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

let hasBrowserCache;
function hasBrowser() {
  if (process.env.SURFWRIGHT_TEST_BROWSER !== "1") {
    return false;
  }
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function cleanupManagedBrowsers() {
  try {
    const statePath = stateFilePath();
    if (!fs.existsSync(statePath)) {
      return;
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    for (const session of Object.values(state?.sessions ?? {})) {
      if (!session || typeof session !== "object" || session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore already-dead process
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

process.on("exit", () => {
  cleanupManagedBrowsers();
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("target click-at returns deterministic coordinate click shape", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Click At Contract Test</title>
    <main style="height:200px" onclick="window.__clickAt = {x: event.clientX, y: event.clientY}">
      click area
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const clickAt = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click-at",
    openPayload.targetId,
    "--x",
    "24",
    "--y",
    "37",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(clickAt.status, 0);
  const clickAtPayload = parseJson(clickAt.stdout);
  assert.equal(clickAtPayload.ok, true);
  assert.equal(clickAtPayload.sessionId, ensurePayload.sessionId);
  assert.equal(clickAtPayload.targetId, openPayload.targetId);
  assert.deepEqual(clickAtPayload.point, { x: 24, y: 37 });
  assert.equal(clickAtPayload.button, "left");
  assert.equal(clickAtPayload.clickCount, 1);
  assert.equal(typeof clickAtPayload.timingMs.total, "number");

  const verifyClickAt = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return window.__clickAt",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(verifyClickAt.status, 0);
  assert.deepEqual(parseJson(verifyClickAt.stdout).result.value, { x: 24, y: 37 });

  const invalidClickAt = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click-at",
    openPayload.targetId,
    "--x",
    "12",
    "--y",
    "8",
    "--button",
    "invalid",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(invalidClickAt.status, 1);
  assert.equal(parseJson(invalidClickAt.stdout).code, "E_QUERY_INVALID");
});

test("target form-fill shorthand --field is discoverable and typed", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Form Fill Shorthand</title>
    <form>
      <input id="email" />
      <input id="password" type="password" />
      <input id="agree" type="checkbox" />
      <select id="role"><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
    </form>
  `;
  const openResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "open",
    `data:text/html,${encodeURIComponent(html)}`,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const shorthandResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "form-fill",
    openPayload.targetId,
    "--field",
    "#email=third@example.com",
    "--field",
    "#password=short",
    "--field",
    "#agree=false",
    "--field",
    "#role=viewer",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(shorthandResult.status, 0);
  const shorthandPayload = parseJson(shorthandResult.stdout);
  assert.equal(shorthandPayload.ok, true);
  assert.equal(shorthandPayload.count, 4);

  const verifyResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return {email: document.querySelector('#email').value, password: document.querySelector('#password').value, agree: document.querySelector('#agree').checked, role: document.querySelector('#role').value}",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(verifyResult.status, 0);
  assert.deepEqual(parseJson(verifyResult.stdout).result.value, {
    email: "third@example.com",
    password: "short",
    agree: false,
    role: "viewer",
  });

  const invalidField = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "form-fill",
    openPayload.targetId,
    "--field",
    "bad-format",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(invalidField.status, 1);
  assert.equal(parseJson(invalidField.stdout).code, "E_QUERY_INVALID");
});
