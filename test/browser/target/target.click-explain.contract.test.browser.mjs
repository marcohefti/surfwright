import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-click-explain-");
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
  const result = runCli(["doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target click --explain returns bounded rejection reasons without clicking", () => {
  requireBrowser();
  const html = `<title>Click Explain</title><main><button style=\"display:none\">Delete</button><button>Delete</button></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const explainResult = runCli(["target",
    "click",
    openPayload.targetId,
    "--text",
    "Delete",
    "--visible-only",
    "--explain",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(explainResult.status, 0);
  const payload = parseJson(explainResult.stdout);

  assert.equal(payload.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "actionId"), false);
  assert.equal(payload.matchCount, 2);
  assert.equal(payload.requestedIndex, null);
  assert.equal(payload.pickedIndex, 1);
  assert.equal(payload.picked.index, 1);
  assert.equal(payload.reason, null);
  assert.equal(Array.isArray(payload.rejected), true);
  assert.equal(payload.rejected.length, 1);
  assert.equal(payload.rejected[0].index, 0);
  assert.equal(payload.rejected[0].reason, "not_visible");
  assert.equal(typeof payload.rejectedTruncated, "boolean");
});

test("target click supports --within scope for deterministic disambiguation", () => {
  requireBrowser();
  const html = `
    <title>Within Click Test</title>
    <main>
      <section id="left"><button id="left-sort">Sort</button></section>
      <section id="right"><button id="right-sort">Sort</button></section>
      <p id="picked">none</p>
      <script>
        document.getElementById('left-sort').addEventListener('click', () => { document.getElementById('picked').textContent = 'left'; });
        document.getElementById('right-sort').addEventListener('click', () => { document.getElementById('picked').textContent = 'right'; });
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const scopedClick = runCli(["target",
    "click",
    openPayload.targetId,
    "--text",
    "Sort",
    "--within",
    "#right",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(scopedClick.status, 0);
  const scopedPayload = parseJson(scopedClick.stdout);
  assert.equal(scopedPayload.withinSelector, "#right");

  const verifyResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return document.querySelector('#picked').textContent",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(verifyResult.status, 0);
  const verifyPayload = parseJson(verifyResult.stdout);
  assert.equal(verifyPayload.result.value, "right");
});

test("target fill --event-mode realistic dispatches keyup-compatible events", () => {
  requireBrowser();
  const html = `
    <title>Fill Event Mode</title>
    <main>
      <input id="email" />
      <p id="keyup-counter">0</p>
      <script>
        const email = document.getElementById('email');
        const counter = document.getElementById('keyup-counter');
        if (email && counter) {
          email.addEventListener('keyup', () => {
            counter.textContent = String(Number(counter.textContent || '0') + 1);
          });
        }
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const fillResult = runCli(["target",
    "fill",
    openPayload.targetId,
    "--selector",
    "#email",
    "--value",
    "keyup@example.com",
    "--event-mode",
    "realistic",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(fillResult.status, 0);
  const fillPayload = parseJson(fillResult.stdout);
  assert.equal(fillPayload.eventMode, "realistic");
  assert.equal(Array.isArray(fillPayload.eventsDispatched), true);
  assert.equal(fillPayload.eventsDispatched.includes("keyup"), true);

  const verifyKeyupResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return Number(document.querySelector('#keyup-counter').textContent || '0')",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(verifyKeyupResult.status, 0);
  const verifyKeyupPayload = parseJson(verifyKeyupResult.stdout);
  assert.equal(Number(verifyKeyupPayload.result.value) >= 1, true);
});
