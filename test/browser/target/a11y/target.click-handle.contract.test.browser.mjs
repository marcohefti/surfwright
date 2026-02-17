import assert from "node:assert/strict";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-click-handle-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });

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

test("target click --handle clicks a snapshot-provided element handle", () => {
  requireBrowser();
  const html = `
    <title>Click Handle Contract</title>
    <main>
      <button id="cta">Open Blog</button>
      <div id="out"></div>
      <script>
        const cta = document.getElementById('cta');
        cta.addEventListener('click', () => {
          document.title = 'Clicked via Handle';
          document.getElementById('out').textContent = 'handled';
          location.hash = 'handled';
        });
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "8000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const snapResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "snapshot",
    openPayload.targetId,
    "--mode",
    "a11y",
    "--max-ax-rows",
    "200",
    "--timeout-ms",
    "8000",
  ]);
  assert.equal(snapResult.status, 0);
  const snapPayload = parseJson(snapResult.stdout);
  assert.equal(snapPayload.ok, true);
  assert.equal(snapPayload.mode, "a11y");
  assert.equal(typeof snapPayload.a11y, "object");
  assert.equal(Array.isArray(snapPayload.a11y.rows), true);

  const row = snapPayload.a11y.rows.find((entry) => entry.role === "button" && /open blog/i.test(entry.name) && typeof entry.handle === "string");
  assert.notEqual(row, undefined, "Expected a11y.rows to include a button with a handle");

  const clickResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--handle",
    row.handle,
    "--wait-for-text",
    "handled",
    "--timeout-ms",
    "8000",
  ]);
  assert.equal(clickResult.status, 0);
  const clickPayload = parseJson(clickResult.stdout);
  assert.equal(clickPayload.ok, true);
  assert.equal(clickPayload.mode, "handle");
  assert.equal(typeof clickPayload.clicked, "object");
  assert.equal(clickPayload.clicked.handle, row.handle);
  assert.equal(clickPayload.title, "Clicked via Handle");
});
