import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-click-"));

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
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object") {
        continue;
      }
      if (session.kind !== "managed") {
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

test("target click returns deterministic shape for selector/text modes", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Click Contract Test</title>
    <main>
      <button id="cta">Open Blog</button>
      <a id="blog-link" href="#blog">Blog</a>
      <script>
        const cta = document.getElementById('cta');
        if (cta) {
          cta.addEventListener('click', () => {
            document.title = 'Clicked CTA';
            location.hash = 'cta';
          });
        }
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const selectorClick = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "#cta",
    "--visible-only",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(selectorClick.status, 0);
  const selectorPayload = parseJson(selectorClick.stdout);
  assert.deepEqual(Object.keys(selectorPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "actionId",
    "mode",
    "selector",
    "contains",
    "visibleOnly",
    "query",
    "clicked",
    "url",
    "title",
    "wait",
    "snapshot",
    "timingMs",
  ]);
  assert.equal(selectorPayload.ok, true);
  assert.equal(selectorPayload.sessionSource, "explicit");
  assert.equal(selectorPayload.mode, "selector");
  assert.equal(selectorPayload.selector, "#cta");
  assert.equal(selectorPayload.query, "#cta");
  assert.equal(selectorPayload.visibleOnly, true);
  assert.equal(typeof selectorPayload.actionId, "string");
  assert.equal(typeof selectorPayload.clicked, "object");
  assert.equal(typeof selectorPayload.clicked.text, "string");
  assert.equal(selectorPayload.wait, null);
  assert.equal(selectorPayload.snapshot, null);
  assert.equal(typeof selectorPayload.timingMs.total, "number");

  const textClick = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Blog",
    "--wait-for-text",
    "Blog",
    "--snapshot",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(textClick.status, 0);
  const textPayload = parseJson(textClick.stdout);
  assert.equal(textPayload.ok, true);
  assert.equal(textPayload.sessionSource, "explicit");
  assert.equal(textPayload.mode, "text");
  assert.equal(textPayload.query, "Blog");
  assert.equal(typeof textPayload.clicked.selectorHint, "string");
  assert.equal(textPayload.clicked.selectorHint.includes("#blog-link"), true);
  assert.equal(textPayload.wait.mode, "text");
  assert.equal(textPayload.wait.value, "Blog");
  assert.equal(typeof textPayload.snapshot.textPreview, "string");
});

test("target click returns typed query failure when no match exists", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Click Missing Test</title><main><button id="exists">Exists</button></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const clickResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "#missing",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(clickResult.status, 1);
  const clickPayload = parseJson(clickResult.stdout);
  assert.equal(clickPayload.ok, false);
  assert.equal(clickPayload.code, "E_QUERY_INVALID");
});
