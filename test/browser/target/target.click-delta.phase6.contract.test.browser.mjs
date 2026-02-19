import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-click-delta-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return runCliSync(args);
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

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target click --delta returns bounded evidence-based delta", () => {
  requireBrowser();
  const html = `<!doctype html>
    <html>
      <head><meta charset="utf-8"><title>Delta Modal</title></head>
      <body>
        <button id="launch" aria-controls="demo-modal" aria-expanded="false">Launch demo modal</button>
        <div id="demo-modal" aria-hidden="true" style="display:none">
          <p>Modal content</p>
          <button id="close" aria-label="Close">Close</button>
        </div>
        <script>
          const btn = document.getElementById('launch');
          const modal = document.getElementById('demo-modal');
          btn.addEventListener('click', () => {
            btn.setAttribute('aria-expanded','true');
            modal.style.display = 'block';
            modal.setAttribute('role','dialog');
            modal.setAttribute('aria-modal','true');
            modal.setAttribute('aria-hidden','false');
            document.getElementById('close').focus();
          });
        </script>
      </body>
    </html>`;
  const url = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const clickResult = runCli([
    "--json",
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Launch demo modal",
    "--visible-only",
    "--wait-for-selector",
    "[aria-modal=\"true\"]",
    "--delta",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(clickResult.status, 0);
  const payload = parseJson(clickResult.stdout);

  assert.equal(payload.ok, true);
  assert.deepEqual(Object.keys(payload), [
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
    "matchCount",
    "pickedIndex",
    "clicked",
    "url",
    "title",
    "wait",
    "snapshot",
    "delta",
    "handoff",
    "timingMs",
  ]);

  assert.equal(typeof payload.delta, "object");
  assert.equal(typeof payload.delta.before.url, "string");
  assert.equal(typeof payload.delta.after.url, "string");
  assert.equal(typeof payload.delta.before.title, "string");
  assert.equal(typeof payload.delta.after.title, "string");

  assert.equal(typeof payload.delta.before.focus, "object");
  assert.equal(typeof payload.delta.after.focus, "object");
  assert.ok(payload.delta.before.focus.selectorHint === null || typeof payload.delta.before.focus.selectorHint === "string");
  assert.ok(payload.delta.after.focus.selectorHint === null || typeof payload.delta.after.focus.selectorHint === "string");
  assert.ok(payload.delta.after.focus.text === null || typeof payload.delta.after.focus.text === "string");
  assert.equal(typeof payload.delta.after.focus.textTruncated, "boolean");

  assert.equal(typeof payload.delta.before.roleCounts, "object");
  assert.equal(typeof payload.delta.after.roleCounts, "object");
  assert.equal(typeof payload.delta.before.roleCounts.dialog, "number");
  assert.equal(typeof payload.delta.after.roleCounts.dialog, "number");
  assert.ok(payload.delta.after.roleCounts.dialog >= 1);

  assert.equal(typeof payload.delta.clickedAria, "object");
  assert.equal(typeof payload.delta.clickedAria.detachedAfter, "boolean");
  assert.equal(Array.isArray(payload.delta.clickedAria.attributes), true);
  assert.deepEqual(
    payload.delta.clickedAria.attributes.map((entry) => entry.name),
    [
      "aria-expanded",
      "aria-controls",
      "aria-hidden",
      "aria-modal",
      "aria-pressed",
      "aria-selected",
      "aria-checked",
      "aria-disabled",
    ],
  );
  for (const entry of payload.delta.clickedAria.attributes) {
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.before === null || typeof entry.before === "string");
    assert.ok(entry.after === null || typeof entry.after === "string");
  }

  assert.equal(payload.handoff.sameTarget, true);
  assert.equal(payload.handoff.openedTargetId, null);
  assert.equal(payload.handoff.openedUrl, null);
  assert.equal(payload.handoff.openedTitle, null);
});
